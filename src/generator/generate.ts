// Deterministic build generator. Pure function of (hero, catalog, aggregate analytics, options).
// It receives only aggregate analytics (item-stats, ability-order-stats, permutation-stats) —
// nothing else about individual players. See README "Scoring function".
import type {
  AbilityStep, Build, BuildItem, GeneratorOptions, Hero, HeroAnalytics, Item, ItemStat, Phase, SlotType,
} from '../types.ts';
import { kitProfile, type KitProfile } from './kit.ts';

// ---------------------------------------------------------------- weights (documented in README)
export const WEIGHTS = {
  winRate: 0.3,
  usage: 0.4,
  statValue: 0.1,
  synergy: 0.1,
  utility: 0.05,
  pairLift: 0.1, // marginal bonus from permutation stats, added during greedy selection
  smoothingK: 200, // Bayesian prior strength (matches) for win rates
  winRateRange: 0.08, // ±8 points vs hero baseline maps to the full 0..1 range
  usageSaturation: 0.5, // pick rate at which the usage score saturates
  minPickRate: 0.004, // items picked in <0.4% of hero matches are ignored
  minPairMatches: 100,
};

export const TIER_QUOTAS: Record<number, number> = { 1: 2, 2: 3, 3: 2, 4: 2 };
export const MAX_TIER4 = 3;
export const MAX_ACTIVES = 3;
export const BUILD_SIZE = 12;
export const PHASE_LIMITS = { early: 6400, mid: 20000 }; // cumulative soul thresholds

// Worth per property unit for the "stat value per soul" term. Values are only compared within a slot type
// (percentile rank), so relative — not absolute — magnitudes matter.
export const STAT_WORTH: Record<string, number> = {
  BaseAttackDamagePercent: 1, BonusFireRate: 1, BonusClipSizePercent: 0.4, BonusBulletSpeedPercent: 0.2,
  BonusAttackRangePercent: 0.2, BulletLifestealPercent: 0.8, NonPlayerBonusWeaponPower: 0.3,
  CloseRangeBonusWeaponPower: 0.5, LongRangeBonusWeaponPower: 0.5, BonusMeleeDamagePercent: 0.1,
  TechPower: 1.2, SpiritPower: 1.2, BonusSpirit: 1, CooldownReduction: 1.5, AbilityLifestealPercentHero: 0.8,
  TechRangeMultiplier: 0.3, TechRadiusMultiplier: 0.3, BonusAbilityDurationPercent: 0.4, BonusAbilityCharges: 6,
  BonusHealth: 0.02, OutOfCombatHealthRegen: 0.3, BonusHealthRegen: 2, BulletResist: 0.6, TechResist: 0.6,
  BonusMoveSpeed: 2, BonusSprintSpeed: 0.5, StaminaCooldownReduction: 0.3, CombatBarrier: 0.02,
  StatusResistancePercent: 0.4, BulletArmorReduction: 0.6, MagicResistReduction: 0.6, TechPowerReduction: 0.3,
};

export interface ScoredItem {
  item: Item;
  stat: ItemStat;
  score: number; // archetype-independent base, 0..1
  winRate: number;
  pickRate: number;
  statValue: number; // percentile 0..1 within slot type
  synergy: number;
  utility: number;
  reasons: string[];
}

export interface Archetype {
  id: string;
  name: string;
  tagline: string;
  slotWeight: Record<SlotType, number>;
  slotCap: Record<SlotType, number>;
  /** ability-order preference: +1 prefers spirit-scaling abilities early, -1 prefers non-spirit */
  abilityBias: number;
}

export const ARCHETYPE: Archetype = {
  id: 'top', name: 'Top-player build', tagline: 'What high-rank players buy and win with on this hero.',
  slotWeight: { weapon: 1, vitality: 1, spirit: 1 }, slotCap: { weapon: 6, vitality: 6, spirit: 6 }, abilityBias: 0,
};

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const num = (v: unknown) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export function statWorth(item: Item): number {
  let w = 0;
  for (const [k, p] of Object.entries(item.properties)) {
    const worth = STAT_WORTH[k];
    if (worth) w += worth * Math.abs(num(p.value));
  }
  return w;
}

function hasPassive(item: Item): boolean {
  return item.tooltip_sections.some((s) => s.section_type === 'passive') || item.activation === 'passive';
}

/** Win rate / pick rate / value / synergy / utility for every eligible item (archetype independent). */
export function scoreItems(hero: Hero, catalog: Item[], analytics: HeroAnalytics, kit: KitProfile): ScoredItem[] {
  const stats = analytics.item_stats;
  // Denominator for pick rate: the most-bought item's match count (≈ every match); baseline WR from full hero totals.
  const heroMatches = Math.max(1, ...stats.map((s) => s.matches));
  const baseWr = analytics.hero_wins / analytics.hero_matches;
  const byId = new Map(stats.map((s) => [s.item_id, s]));

  // stat value per 1000 souls, percentile ranked within slot type
  const vps = new Map<number, number>();
  for (const it of catalog) vps.set(it.id, (statWorth(it) / it.cost) * 1000);
  const rankIn = new Map<number, number>();
  for (const slot of ['weapon', 'vitality', 'spirit'] as SlotType[]) {
    const group = catalog.filter((i) => i.item_slot_type === slot).sort((a, b) => vps.get(a.id)! - vps.get(b.id)! || a.id - b.id);
    group.forEach((it, idx) => rankIn.set(it.id, group.length > 1 ? idx / (group.length - 1) : 0.5));
  }

  const out: ScoredItem[] = [];
  for (const item of catalog) {
    if (item.heroes.length && !item.heroes.includes(hero.id)) continue;
    const stat = byId.get(item.id);
    if (!stat) continue;
    const pickRate = stat.matches / heroMatches;
    if (pickRate < WEIGHTS.minPickRate) continue;
    const smoothed = (stat.wins + WEIGHTS.smoothingK * baseWr) / (stat.matches + WEIGHTS.smoothingK);
    const wrScore = clamp(0.5 + (smoothed - baseWr) / (2 * WEIGHTS.winRateRange));
    const usage = clamp(pickRate / WEIGHTS.usageSaturation);
    const statValue = rankIn.get(item.id) ?? 0;

    let synergy = kit.synergy[item.item_slot_type];
    const reasons: string[] = [];
    if (item.properties.BonusFireRate && num(item.properties.BonusFireRate.value) > 0 && kit.bulletProc > 0) {
      synergy = clamp(synergy + 0.3 * kit.bulletProc);
      reasons.push('fire rate feeds bullet-triggered kit');
    }
    if ((item.properties.TechPower || item.properties.SpiritPower) && kit.spirit >= 0.3) reasons.push('spirit scaling on abilities');
    const utility = item.is_active_item ? 1 : hasPassive(item) ? 0.5 : 0;
    if (item.is_active_item) reasons.push('active ability');
    else if (hasPassive(item)) reasons.push('passive effect');
    if (wrScore >= 0.6) reasons.push(`win rate ${(smoothed * 100).toFixed(1)}% (+${((smoothed - baseWr) * 100).toFixed(1)} vs hero)`);
    if (usage >= 0.6) reasons.push(`high pick rate ${(pickRate * 100).toFixed(0)}%`);

    const score =
      WEIGHTS.winRate * wrScore + WEIGHTS.usage * usage + WEIGHTS.statValue * statValue +
      WEIGHTS.synergy * synergy + WEIGHTS.utility * utility;
    out.push({ item, stat, score, winRate: smoothed, pickRate, statValue, synergy, utility, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.item.id - b.item.id);
}

/** Pair win-rate lift from permutation stats: smoothed pair WR minus mean of the two smoothed solo WRs. */
function pairLifts(analytics: HeroAnalytics, scored: ScoredItem[]): Map<string, number> {
  const wr = new Map(scored.map((s) => [s.item.id, s.winRate]));
  const baseWr = analytics.hero_wins / analytics.hero_matches;
  const m = new Map<string, number>();
  for (const p of analytics.permutation_stats) {
    if (p.item_ids.length !== 2 || p.matches < WEIGHTS.minPairMatches) continue;
    const [a, b] = p.item_ids;
    if (!wr.has(a) || !wr.has(b)) continue;
    const pair = (p.wins + WEIGHTS.smoothingK * baseWr) / (p.matches + WEIGHTS.smoothingK);
    const lift = pair - (wr.get(a)! + wr.get(b)!) / 2;
    m.set(`${Math.min(a, b)}:${Math.max(a, b)}`, lift);
  }
  return m;
}

function selectItems(arch: Archetype, scored: ScoredItem[], lifts: Map<string, number>, budget: number): ScoredItem[] {
  const chosen: ScoredItem[] = [];
  const slotCount: Record<SlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
  const need: Record<number, number> = { ...TIER_QUOTAS };
  let spent = 0;
  let actives = 0;
  let tier4 = 0;

  const marginal = (c: ScoredItem) => {
    let lift = 0;
    for (const s of chosen) lift += lifts.get(`${Math.min(s.item.id, c.item.id)}:${Math.max(s.item.id, c.item.id)}`) ?? 0;
    const pair = chosen.length ? clamp(0.5 + lift / chosen.length / 0.06) : 0.5;
    return arch.slotWeight[c.item.item_slot_type] * (c.score + WEIGHTS.pairLift * pair);
  };

  while (chosen.length < BUILD_SIZE) {
    const slotsLeft = BUILD_SIZE - chosen.length;
    const needTotal = Object.values(need).reduce((a, b) => a + Math.max(0, b), 0);
    const reserve = (exceptTier: number) =>
      Object.entries(need).reduce((s, [t, n]) => s + Math.max(0, n - (Number(t) === exceptTier ? 1 : 0)) * 800 * 2 ** (Number(t) - 1), 0);
    let best: ScoredItem | null = null;
    let bestVal = -Infinity;
    for (const c of scored) {
      if (chosen.includes(c)) continue;
      const it = c.item;
      if (slotCount[it.item_slot_type] >= arch.slotCap[it.item_slot_type]) continue;
      if (it.item_tier === 4 && tier4 >= MAX_TIER4) continue;
      if (it.is_active_item && actives >= MAX_ACTIVES) continue;
      // quota feasibility: if every remaining slot is owed to a tier, only those tiers qualify
      if (needTotal >= slotsLeft && !(need[it.item_tier] > 0)) continue;
      if (spent + it.cost + reserve(it.item_tier) > budget) continue;
      const v = marginal(c);
      if (v > bestVal + 1e-12) {
        best = c;
        bestVal = v;
      }
    }
    if (!best) break;
    chosen.push(best);
    spent += best.item.cost;
    slotCount[best.item.item_slot_type]++;
    if (best.item.item_tier === 4) tier4++;
    if (best.item.is_active_item) actives++;
    if (need[best.item.item_tier] > 0) need[best.item.item_tier]--;
  }
  return chosen;
}

function orderAndPhase(chosen: ScoredItem[], budget: number): BuildItem[] {
  // Buy order: aggregate average purchase time, ties by tier then id.
  const ordered = [...chosen].sort(
    (a, b) => a.stat.avg_buy_time_s - b.stat.avg_buy_time_s || a.item.item_tier - b.item.item_tier || a.item.id - b.item.id,
  );
  let total = 0;
  return ordered.map((s) => {
    total += s.item.cost;
    const phase: Phase = total <= PHASE_LIMITS.early ? 'early' : total <= PHASE_LIMITS.mid ? 'mid' : 'late';
    return {
      item_id: s.item.id, phase, cost: s.item.cost, running_total: total, score: Math.round(s.score * 1000) / 1000,
      win_rate: s.winRate, pick_rate: s.pickRate, reasons: s.reasons,
    };
  });
}

function abilityOrder(hero: Hero, analytics: HeroAnalytics, arch: Archetype, kit: KitProfile) {
  const seqs = analytics.ability_order_stats.filter((s) => s.abilities.length >= 12);
  const heroMatches = analytics.hero_matches || 1;
  const baseWr = analytics.hero_wins / heroMatches;
  // per-ability spirit share of the hero's damage scaling
  const spiritShare = new Map<number, number>();
  for (const ab of hero.abilities) {
    let t = 0;
    for (const p of Object.values(ab.properties)) if (/tech_damage/.test(p.scale_function?.class_name ?? '')) t += p.scale_function?.stat_scale ?? 0.5;
    spiritShare.set(ab.id, clamp(t / 1.5));
  }
  const minMatches = Math.max(30, heroMatches * 0.002);
  let best: { seq: number[]; score: number; wins: number; matches: number } | null = null;
  for (const s of seqs) {
    if (s.matches < minMatches) continue;
    const wr = (s.wins + 300 * baseWr) / (s.matches + 300);
    let aff = 0;
    const n = Math.min(8, s.abilities.length);
    for (let i = 0; i < n; i++) aff += ((spiritShare.get(s.abilities[i]) ?? 0) - 0.5) * (1 - i / n);
    const score = wr + 0.01 * arch.abilityBias * aff * Math.max(0.3, kit.spirit);
    if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && s.matches > best.matches)) {
      best = { seq: s.abilities, score, wins: s.wins, matches: s.matches };
    }
  }
  const names = new Map(hero.abilities.map((a) => [a.id, a.name]));
  const steps: AbilityStep[] = [];
  const ranks = new Map<number, number>();
  (best?.seq ?? []).forEach((id, i) => {
    const r = (ranks.get(id) ?? 0) + 1;
    ranks.set(id, r);
    steps.push({ step: i + 1, ability_id: id, ability_name: names.get(id) ?? String(id), rank: r });
  });
  const unlock = steps.filter((s) => s.rank === 1).map((s) => s.ability_name);
  return { steps, unlock, wr: best ? best.wins / best.matches : 0, matches: best?.matches ?? 0 };
}

export function generateBuild(hero: Hero, catalog: Item[], analytics: HeroAnalytics, options: GeneratorOptions): Build {
  const kit = kitProfile(hero);
  const scored = scoreItems(hero, catalog, analytics, kit);
  const lifts = pairLifts(analytics, scored);
  const chosen = selectItems(ARCHETYPE, scored, lifts, options.budget);
  const items = orderAndPhase(chosen, options.budget);
  const ab = abilityOrder(hero, analytics, ARCHETYPE, kit);
  return {
    id: ARCHETYPE.id, name: ARCHETYPE.name, tagline: ARCHETYPE.tagline, hero_id: hero.id, items,
    total_cost: items.length ? items[items.length - 1].running_total : 0, budget: options.budget,
    ability_steps: ab.steps, unlock_order: ab.unlock, ability_win_rate: ab.wr, ability_matches: ab.matches,
  };
}
