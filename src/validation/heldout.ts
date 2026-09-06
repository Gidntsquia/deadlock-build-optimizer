// Held-out validation against real matches of up to 5 representative top players per hero (sets listed
// in manifest.json). This module is the ONLY code that reads public/data/validation/*. It runs after
// builds are generated and never feeds back into the generator.
import type { Build, Item } from '../types';
import { j, type ValidationSetRef } from '../data/load';

export type HeldoutSet = ValidationSetRef;
export interface HeldoutPurchases { account_id: number; player: string; hero_id: number; hero: string; total_hero_matches?: number; matchmaking_hero_matches?: number; matches: { match_id: number; won: boolean; duration_s: number; items: { item_id: number; game_time_s: number; sold_time_s: number }[] }[] }

/** Loads one held-out snapshot. Only this module reads public/data/validation/. */
export const loadHeldout = (set: HeldoutSet) => j<HeldoutPurchases>(set.file);

export const CORE_THRESHOLD = 0.3;   // item must appear in >=30% of (win-weighted) sampled matches
export const WIN_WEIGHT = 1.5;       // a won match counts 1.5x, a lost match 1x
export const OVERLAP_WEIGHT = 0.7;   // agreement = 0.7*overlap(F1) + 0.3*order concordance
export const ORDER_WEIGHT = 0.3;

export interface CoreItem { item: Item; frequency: number; medianBuyTimeS: number; matches: number }
export interface CoreSet { player: string; hero: string; core: CoreItem[]; experiments: CoreItem[]; matches: number; wins: number }

export function computeCoreSet(data: HeldoutPurchases, items: Item[]): CoreSet {
  const catalog = new Map(items.map((i) => [i.id, i]));
  let totalW = 0;
  const acc = new Map<number, { w: number; times: number[]; n: number }>();
  for (const m of data.matches) {
    const w = m.won ? WIN_WEIGHT : 1;
    totalW += w;
    const seen = new Map<number, number>();
    for (const p of m.items) {
      if (!catalog.has(p.item_id)) continue; // abilities / non-shop entries
      const t = seen.get(p.item_id);
      if (t === undefined || p.game_time_s < t) seen.set(p.item_id, p.game_time_s);
    }
    for (const [id, t] of seen) {
      const a = acc.get(id) ?? { w: 0, times: [], n: 0 };
      a.w += w; a.times.push(t); a.n++;
      acc.set(id, a);
    }
  }
  const all: CoreItem[] = [...acc].map(([id, a]) => {
    const s = [...a.times].sort((x, y) => x - y);
    return { item: catalog.get(id)!, frequency: a.w / totalW, medianBuyTimeS: s[Math.floor(s.length / 2)], matches: a.n };
  }).sort((x, y) => y.frequency - x.frequency || x.item.id - y.item.id);
  return { player: data.player, hero: data.hero, core: all.filter((c) => c.frequency >= CORE_THRESHOLD), experiments: all.filter((c) => c.frequency < CORE_THRESHOLD), matches: data.matches.length, wins: data.matches.filter((m) => m.won).length };
}

export interface BuildValidation {
  buildKey: string; agreement: number; overlap: number; order: number;
  precision: number; recall: number; sharedCount: number;
  badges: Record<number, boolean>; // item id -> is core
  missingCore: CoreItem[];
}

export function validateBuild(build: Build, core: CoreSet): BuildValidation {
  const coreById = new Map(core.core.map((c) => [c.item.id, c]));
  const badges: Record<number, boolean> = {};
  const shared: { order: number; t: number }[] = [];
  for (const b of build.items) {
    const c = coreById.get(b.item.id);
    badges[b.item.id] = !!c;
    if (c) shared.push({ order: b.order, t: c.medianBuyTimeS });
  }
  const precision = build.items.length ? shared.length / build.items.length : 0;
  const recall = core.core.length ? shared.length / core.core.length : 0;
  const overlap = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  // order concordance: fraction of shared-item pairs whose relative order matches the player's median buy times
  let conc = 0, pairs = 0;
  for (let i = 0; i < shared.length; i++) for (let j = i + 1; j < shared.length; j++) {
    pairs++;
    const a = shared[i], b = shared[j];
    if (Math.sign(a.order - b.order) === Math.sign(a.t - b.t) || a.t === b.t) conc++;
  }
  const order = pairs ? conc / pairs : 0;
  const agreement = OVERLAP_WEIGHT * overlap + ORDER_WEIGHT * order;
  const inBuild = new Set(build.items.map((b) => b.item.id));
  return { buildKey: build.key, agreement, overlap, order, precision, recall, sharedCount: shared.length, badges, missingCore: core.core.filter((c) => !inBuild.has(c.item.id)) };
}

// ---- panel of representative players ------------------------------------------------------------

export interface PlayerValidation { set: HeldoutSet; core: CoreSet; validation: BuildValidation }
export interface PanelValidation {
  players: PlayerValidation[];
  agreement: number;                       // selection-score-weighted mean of per-player agreement
  consensusBadges: Record<number, number>; // item id -> number of reps whose core set contains it
  missingConsensus: { item: Item; reps: number; frequency: number }[]; // core for a majority of reps, absent from the build
}

/** Number of reps an item must be core for to count as panel consensus (majority, ceil(reps/2)). */
export const consensusThreshold = (reps: number) => Math.ceil(reps / 2);

export function validateAgainstPanel(build: Build, panel: { set: HeldoutSet; core: CoreSet }[]): PanelValidation {
  const players: PlayerValidation[] = panel.map((p) => ({ set: p.set, core: p.core, validation: validateBuild(build, p.core) }));
  const weights = players.map((p) => (p.set.selection?.score ?? 0) > 0 ? p.set.selection!.score : NaN);
  const allWeighted = weights.length > 0 && weights.every((w) => Number.isFinite(w));
  const w = allWeighted ? weights : players.map(() => 1);
  const totalW = w.reduce((a, b) => a + b, 0);
  const agreement = totalW ? players.reduce((a, p, i) => a + p.validation.agreement * w[i], 0) / totalW : 0;

  const consensusBadges: Record<number, number> = {};
  const freq = new Map<number, { item: Item; reps: number; sum: number }>();
  for (const p of players) for (const c of p.core.core) {
    consensusBadges[c.item.id] = (consensusBadges[c.item.id] ?? 0) + 1;
    const f = freq.get(c.item.id) ?? { item: c.item, reps: 0, sum: 0 };
    f.reps++; f.sum += c.frequency; freq.set(c.item.id, f);
  }
  for (const b of build.items) consensusBadges[b.item.id] ??= 0;
  const inBuild = new Set(build.items.map((b) => b.item.id));
  const need = consensusThreshold(players.length);
  const missingConsensus = [...freq.values()]
    .filter((f) => f.reps >= need && !inBuild.has(f.item.id))
    .map((f) => ({ item: f.item, reps: f.reps, frequency: f.sum / f.reps }))
    .sort((x, y) => y.reps - x.reps || y.frequency - x.frequency || x.item.id - y.item.id);
  return { players, agreement, consensusBadges, missingConsensus };
}

/**
 * Panel agreement for a hero with several builds: each rep is scored against the build that fits them
 * best (a rep who plays the hero's alternative style is compared with that style's build), then the
 * per-rep scores are combined with the same selection-score weights as validateAgainstPanel.
 */
export function panelAgreementAcrossBuilds(builds: Build[], panel: { set: HeldoutSet; core: CoreSet }[]): { agreement: number; perRep: { player: string; buildKey: string; agreement: number }[] } {
  if (!builds.length || !panel.length) return { agreement: 0, perRep: [] };
  const vals = builds.map((b) => validateAgainstPanel(b, panel));
  const perRep = panel.map((p, i) => {
    let best = vals[0].players[i].validation.agreement, key = builds[0].key;
    for (let k = 1; k < vals.length; k++) { const a = vals[k].players[i].validation.agreement; if (a > best) { best = a; key = builds[k].key; } }
    return { player: p.set.player, buildKey: key, agreement: best };
  });
  const weights = panel.map((p) => (p.set.selection?.score ?? 0) > 0 ? p.set.selection!.score : NaN);
  const w = weights.every((x) => Number.isFinite(x)) ? weights : panel.map(() => 1);
  const totalW = w.reduce((a, b) => a + b, 0);
  return { agreement: totalW ? perRep.reduce((a, r, i) => a + r.agreement * w[i], 0) / totalW : 0, perRep };
}
