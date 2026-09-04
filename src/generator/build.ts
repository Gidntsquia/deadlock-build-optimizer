// Deterministic build generator. Inputs: item catalog, hero + ability assets, and the AGGREGATE
// analytics snapshot for the hero (item-stats, ability-order-stats, item-permutation-stats).
// It never reads any per-player data.
import type { Ability, AnalyticsPopulation, Build, BuildItem, BuildPopulation, Hero, HeroAnalytics, Item, ItemStat, Phase, SlotType } from '../types';
import { ARCHETYPES, MAX_ACTIVES, MAX_ITEMS, MAX_UPGRADE_STEPS, MIN_ITEMS, MIN_TOP_ITEM_MATCHES, MIN_TOP_SEQ_MATCHES, PHASE_TIME_S, SLOT_CAP, TIER_MIN, UNIT_VALUE, WEIGHTS, WIN_SHRINK_FRAC, MIN_USAGE, type Archetype } from './stats';
import { kitProfile } from './kit';
import { pickAbilityOrder } from './abilities';

export interface GeneratorInput { hero: Hero; abilities: Ability[]; items: Item[]; analytics: HeroAnalytics }

const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^-\d.]/g, '')); return Number.isFinite(n) ? n : 0; };

/** Soul-equivalent value of an item's stat lines under a set of per-stat multipliers. */
export function statValue(item: Item, mult: Record<string, number>): number {
  let v = 0;
  for (const [k, p] of Object.entries(item.properties)) {
    const unit = UNIT_VALUE[k];
    if (!unit) continue;
    v += Math.abs(num(p.value)) * unit * (mult[k] ?? 1);
  }
  return v;
}

interface Scored { item: Item; stat: ItemStat; pop: number; winLift: number; eff: number; kit: number; base: number }

/**
 * Picks the aggregate population to generate from. The high-rank population is preferred because
 * the app's goal is a build that top players would recognise; it is only used when the sample is
 * big enough for win rates and buy times to be stable. Ability sequences are chosen separately
 * because they are much sparser than item stats.
 */
export function choosePopulation(analytics: HeroAnalytics): { items: AnalyticsPopulation; abilities: AnalyticsPopulation; info: BuildPopulation } {
  const all: AnalyticsPopulation = analytics;
  const top = analytics.top;
  const topItemMatches = top ? Math.max(0, ...top.item_stats.map((s) => s.matches)) : 0;
  const topSeqMatches = top ? Math.max(0, ...top.ability_order_stats.map((s) => s.matches)) : 0;
  const useTop = !!top && topItemMatches >= MIN_TOP_ITEM_MATCHES;
  const useTopSeq = !!top && topSeqMatches >= MIN_TOP_SEQ_MATCHES;
  return {
    items: useTop ? top! : all,
    abilities: useTopSeq ? top! : all,
    info: {
      kind: useTop ? 'top' : 'all', minBadge: useTop ? top!.min_average_badge : null,
      matches: useTop ? topItemMatches : Math.max(0, ...all.item_stats.map((s) => s.matches)),
      abilitySequenceKind: useTopSeq ? 'top' : 'all',
    },
  };
}

export function generateBuilds(input: GeneratorInput): Build[] {
  return ARCHETYPES.map((a) => generateBuild(input, a));
}

export function generateBuild(input: GeneratorInput, arch: Archetype): Build {
  const { hero, abilities, items } = input;
  const pop = choosePopulation(input.analytics);
  const analytics = pop.items;
  const catalog = new Map(items.filter((i) => i.shopable && !i.disabled && i.cost > 0).map((i) => [i.id, i]));
  const kit = kitProfile(hero, abilities);
  const allStats = analytics.item_stats.filter((s) => catalog.has(s.item_id) && s.matches > 0);
  const maxMatches = Math.max(1, ...allStats.map((s) => s.matches));
  const stats = allStats.filter((s) => s.matches / maxMatches >= MIN_USAGE);
  const K = Math.max(200, WIN_SHRINK_FRAC * maxMatches);
  const totalW = stats.reduce((a, s) => a + s.wins, 0), totalM = stats.reduce((a, s) => a + s.matches, 0);
  const meanWR = totalM ? totalW / totalM : 0.5;

  // 1) per-item base score
  const rawEff: number[] = [], rawKit: number[] = [];
  const pre = stats.map((s) => {
    const item = catalog.get(s.item_id)!;
    const eff = statValue(item, arch.statMult) / item.cost;
    const k = statValue(item, kit) / item.cost;
    rawEff.push(eff); rawKit.push(k);
    return { item, stat: s, eff, kit: k };
  });
  // Items whose value is an effect the stat table does not price (e.g. Mystic Burst, Healbane) have
  // statValue 0. That is "unknown", not "worthless": give them the median value of priced items so the
  // stat terms neither reward nor penalise them and popularity / win rate decide.
  const median = (xs: number[]) => { const s = xs.filter((x) => x > 0).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const effMed = median(rawEff), kitMed = median(rawKit);
  for (const p of pre) { if (p.eff === 0) p.eff = effMed; if (p.kit === 0) p.kit = kitMed; }
  const effMax = Math.max(1e-9, ...pre.map((p) => p.eff)), kitMax = Math.max(1e-9, ...pre.map((p) => p.kit));
  const scored: Scored[] = pre.map(({ item, stat, eff, kit: k }) => {
    const pop = stat.matches / maxMatches;
    const shrunk = (stat.wins + K * meanWR) / (stat.matches + K);
    // Sample-size shrinkage does not remove selection bias: a late luxury item bought in 5% of games is
    // bought in games that are already being won, and that bias does not shrink with more matches.
    // The win rate is only an unbiased estimate of the item's effect when nearly everyone buys it, so
    // the lift is credited in proportion to usage (100% usage: full lift; 5% usage: 5% of it).
    const winLift = (shrunk - meanWR) * 10 * pop;
    const base =
      WEIGHTS.popularity * Math.sqrt(pop) + WEIGHTS.winLift * winLift +
      WEIGHTS.efficiency * (eff / effMax) + WEIGHTS.kit * (k / kitMax) +
      (item.is_active_item ? WEIGHTS.active : 0);
    return { item, stat, pop, winLift, eff: eff / effMax, kit: k / kitMax, base: base * arch.slotBias[item.item_slot_type] };
  });

  // 2) pair synergy lookup
  const pair = new Map<string, number>();
  for (const p of analytics.permutation_stats) {
    if (p.item_ids.length !== 2 || p.matches < 20) continue;
    const lift = (p.wins / p.matches - meanWR) * 10;
    const [a, b] = p.item_ids;
    pair.set(`${a}:${b}`, lift); pair.set(`${b}:${a}`, lift);
  }

  // 3) greedy selection under slot / tier / active caps.
  // Upgrade chains: an item and the item it upgrades into may BOTH be in the build (buy the
  // component early, upgrade later, as the in-game shop does). The upgrade takes over the
  // component's slot and only its incremental cost is paid. Slot and item caps count "final"
  // items only: a component that is later upgraded does not use a slot of its own.
  const chosen: { s: Scored; score: number; reasons: string[] }[] = [];
  const slotCount: Record<SlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
  const tierCount: Record<number, number> = {};
  let actives = 0, finals = 0;
  const has = (id: number) => chosen.some((c) => c.s.item.id === id);
  // component class -> the chosen upgrade that consumes it (a component can only be upgraded once)
  const consumed = new Map<string, string>();
  const chosenClasses = () => new Set(chosen.map((c) => c.s.item.class_name));
  // returns the [component, upgrade] pair this item would form with an already chosen item, if any
  const chainPair = (it: Item): [string, string] | null => {
    const have = chosenClasses();
    const upgradeOfIt = chosen.find((c) => c.s.item.component_items.includes(it.class_name) && !consumed.has(it.class_name) && ![...consumed.values()].includes(c.s.item.class_name));
    if (upgradeOfIt) return [it.class_name, upgradeOfIt.s.item.class_name];
    const comp = it.component_items.find((c) => have.has(c) && !consumed.has(c));
    return comp ? [comp, it.class_name] : null;
  };

  const tierShortfall = () => Object.entries(TIER_MIN).filter(([t, min]) => (tierCount[+t] ?? 0) < min).map(([t]) => +t);

  while (finals < MAX_ITEMS && chosen.length < MAX_ITEMS + MAX_UPGRADE_STEPS) {
    const need = tierShortfall();
    const forcedTier = finals >= MAX_ITEMS - need.length * 2 ? need : []; // fill cheap tiers before we run out of room
    let best: { s: Scored; score: number; reasons: string[]; inChain: boolean; chain: [string, string] | null } | null = null;
    for (const s of scored) {
      const it = s.item;
      if (has(it.id)) continue;
      // part of an upgrade chain already in the build: shares that slot instead of taking a new one
      const chain = chainPair(it);
      const inChain = !!chain;
      if (!inChain && slotCount[it.item_slot_type] >= SLOT_CAP) continue;
      if (it.is_active_item && actives >= MAX_ACTIVES) continue;
      if (forcedTier.length && !forcedTier.includes(it.item_tier)) continue;
      let syn = 0, n = 0;
      for (const c of chosen) { const l = pair.get(`${it.id}:${c.s.item.id}`); if (l !== undefined) { syn += l; n++; } }
      syn = n ? syn / n : 0;
      const score = s.base + WEIGHTS.synergy * syn;
      if (!best || score > best.score || (score === best.score && it.id < best.s.item.id)) {
        const reasons: string[] = [];
        if (s.pop > 0.5) reasons.push(`bought in ${(s.stat.matches / maxMatches * 100).toFixed(0)}% of ${hero.name} games (relative)`);
        if (s.winLift > 0.1) reasons.push(`+${(s.winLift * 10).toFixed(1)}% win rate vs hero average`);
        if (s.eff > 0.6) reasons.push('high stat value per soul for this archetype');
        if (s.kit > 0.6) reasons.push(`scales ${hero.name}'s kit`);
        if (syn > 0.2) reasons.push('wins more alongside items already in the build');
        best = { s, score, reasons, inChain, chain };
      }
    }
    if (!best) break;
    chosen.push(best);
    const it = best.s.item;
    if (best.chain) consumed.set(best.chain[0], best.chain[1]); else { slotCount[it.item_slot_type]++; finals++; }
    tierCount[it.item_tier] = (tierCount[it.item_tier] ?? 0) + 1;
    if (it.is_active_item) actives++;
  }
  if (chosen.length < MIN_ITEMS) {
    // relax slot caps: take best remaining by score
    for (const s of scored.sort((a, b) => b.base - a.base || a.item.id - b.item.id)) {
      if (chosen.length >= MIN_ITEMS) break;
      if (!has(s.item.id)) chosen.push({ s, score: s.base, reasons: ['filler: best remaining score'] });
    }
  }

  // 4) buy order = the hero's average purchase time from the aggregate stats, tie-break cost then id.
  // A component is always listed before the item that upgrades from it.
  chosen.sort((a, b) => a.s.stat.avg_buy_time_s - b.s.stat.avg_buy_time_s || a.s.item.cost - b.s.item.cost || a.s.item.id - b.s.item.id);
  for (let i = 0; i < chosen.length; i++) {
    const compClass = [...consumed].find(([, up]) => up === chosen[i].s.item.class_name)?.[0];
    const j = compClass ? chosen.findIndex((c, k) => k > i && c.s.item.class_name === compClass) : -1;
    if (j > i) { const [comp] = chosen.splice(j, 1); chosen.splice(i, 0, comp); }
  }
  let running = 0;
  const byClass = new Map(chosen.map((c) => [c.s.item.class_name, c.s.item]));
  const buildItems: BuildItem[] = chosen.map((c, i) => {
    const compClass = [...consumed].find(([, up]) => up === c.s.item.class_name)?.[0];
    const upgradesFrom = compClass ? byClass.get(compClass) : undefined;
    const paidCost = c.s.item.cost - (upgradesFrom?.cost ?? 0);
    running += paidCost;
    const t = c.s.stat.avg_buy_time_s;
    const phase: Phase = t < PHASE_TIME_S.early ? 'early' : t < PHASE_TIME_S.mid ? 'mid' : 'late';
    const reasons = upgradesFrom ? [`upgrades ${upgradesFrom.name} already in the build; pays only the ${paidCost} soul difference`, ...c.reasons] : c.reasons;
    return { item: c.s.item, phase, order: i + 1, runningTotal: running, paidCost, upgradesFrom, score: c.score, reasons, usageRate: c.s.pop, winRate: c.s.stat.wins / c.s.stat.matches, avgBuyTimeS: t };
  });
  // guarantee every phase has at least one item (fallback: split by thirds)
  const phases = new Set(buildItems.map((b) => b.phase));
  if (phases.size < 3) buildItems.forEach((b, i) => { b.phase = i < buildItems.length / 3 ? 'early' : i < (2 * buildItems.length) / 3 ? 'mid' : 'late'; });

  const ab = pickAbilityOrder(hero, abilities, pop.abilities.ability_order_stats);
  return {
    key: arch.key, name: arch.name, tagline: arch.tagline, heroId: hero.id,
    items: buildItems, totalCost: running,
    abilityOrder: ab.steps, abilityOrderSupport: ab.support,
    population: pop.info,
  };
}
