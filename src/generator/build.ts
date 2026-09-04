// Deterministic build generator. Inputs: item catalog, hero + ability assets, and the AGGREGATE
// analytics snapshot for the hero (item-stats, ability-order-stats, item-permutation-stats).
// It never reads any per-player data.
import type { Ability, Build, BuildItem, Hero, HeroAnalytics, Item, ItemStat, Phase, SlotType } from '../types';
import { ARCHETYPES, MAX_ACTIVES, MAX_ITEMS, MIN_ITEMS, PHASE_TIME_S, SLOT_CAP, TIER_MIN, UNIT_VALUE, WEIGHTS, WIN_SHRINK_FRAC, MIN_USAGE, type Archetype } from './stats';
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

export function generateBuilds(input: GeneratorInput): Build[] {
  return ARCHETYPES.map((a) => generateBuild(input, a));
}

export function generateBuild(input: GeneratorInput, arch: Archetype): Build {
  const { hero, abilities, items, analytics } = input;
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
  const effMax = Math.max(1e-9, ...rawEff), kitMax = Math.max(1e-9, ...rawKit);
  const scored: Scored[] = pre.map(({ item, stat, eff, kit: k }) => {
    const pop = stat.matches / maxMatches;
    const shrunk = (stat.wins + K * meanWR) / (stat.matches + K);
    const winLift = (shrunk - meanWR) * 10;
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

  // 3) greedy selection under slot / tier / active caps
  const chosen: { s: Scored; score: number; reasons: string[] }[] = [];
  const slotCount: Record<SlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
  const tierCount: Record<number, number> = {};
  let actives = 0;
  const has = (id: number) => chosen.some((c) => c.s.item.id === id);
  const componentOf = new Set<string>();
  const byClass = new Map(items.map((i) => [i.class_name, i.id]));

  const tierShortfall = () => Object.entries(TIER_MIN).filter(([t, min]) => (tierCount[+t] ?? 0) < min).map(([t]) => +t);

  while (chosen.length < MAX_ITEMS) {
    const need = tierShortfall();
    const forcedTier = chosen.length >= MAX_ITEMS - need.length * 2 ? need : []; // fill cheap tiers before we run out of room
    let best: { s: Scored; score: number; reasons: string[] } | null = null;
    for (const s of scored) {
      const it = s.item;
      if (has(it.id)) continue;
      if (slotCount[it.item_slot_type] >= SLOT_CAP) continue;
      if (it.is_active_item && actives >= MAX_ACTIVES) continue;
      if (forcedTier.length && !forcedTier.includes(it.item_tier)) continue;
      // never take an item together with one of its own components (it replaces it)
      if (it.component_items.some((c) => has(byClass.get(c) ?? -1))) continue;
      if (componentOf.has(it.class_name)) continue;
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
        best = { s, score, reasons };
      }
    }
    if (!best) break;
    chosen.push(best);
    const it = best.s.item;
    slotCount[it.item_slot_type]++;
    tierCount[it.item_tier] = (tierCount[it.item_tier] ?? 0) + 1;
    if (it.is_active_item) actives++;
    for (const c of it.component_items) componentOf.add(c);
    // items that upgrade INTO an already chosen item are also excluded
    for (const o of items) if (o.component_items.includes(it.class_name)) componentOf.add(o.class_name);
  }
  if (chosen.length < MIN_ITEMS) {
    // relax slot caps: take best remaining by score
    for (const s of scored.sort((a, b) => b.base - a.base || a.item.id - b.item.id)) {
      if (chosen.length >= MIN_ITEMS) break;
      if (!has(s.item.id)) chosen.push({ s, score: s.base, reasons: ['filler: best remaining score'] });
    }
  }

  // 4) buy order = the hero's average purchase time from the aggregate stats, tie-break cost then id
  chosen.sort((a, b) => a.s.stat.avg_buy_time_s - b.s.stat.avg_buy_time_s || a.s.item.cost - b.s.item.cost || a.s.item.id - b.s.item.id);
  let running = 0;
  const buildItems: BuildItem[] = chosen.map((c, i) => {
    running += c.s.item.cost;
    const t = c.s.stat.avg_buy_time_s;
    const phase: Phase = t < PHASE_TIME_S.early ? 'early' : t < PHASE_TIME_S.mid ? 'mid' : 'late';
    return { item: c.s.item, phase, order: i + 1, runningTotal: running, score: c.score, reasons: c.reasons, usageRate: c.s.pop, winRate: c.s.stat.wins / c.s.stat.matches, avgBuyTimeS: t };
  });
  // guarantee every phase has at least one item (fallback: split by thirds)
  const phases = new Set(buildItems.map((b) => b.phase));
  if (phases.size < 3) buildItems.forEach((b, i) => { b.phase = i < buildItems.length / 3 ? 'early' : i < (2 * buildItems.length) / 3 ? 'mid' : 'late'; });

  const ab = pickAbilityOrder(hero, abilities, analytics.ability_order_stats);
  return {
    key: arch.key, name: arch.name, tagline: arch.tagline, heroId: hero.id,
    items: buildItems, totalCost: running,
    abilityOrder: ab.steps, abilityOrderSupport: ab.support,
  };
}
