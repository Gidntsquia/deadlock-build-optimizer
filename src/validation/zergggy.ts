// Held-out validation against Zergggy's (account 35187362) real Infernus matches.
// This module is the ONLY code that reads public/data/zergggy/*. It runs after builds are generated
// and never feeds back into the generator.
import type { Build, Item } from '../types';
import { j } from '../data/load';

export interface ZergggyPurchases { account_id: number; hero_id: number; matches: { match_id: number; won: boolean; duration_s: number; items: { item_id: number; game_time_s: number; sold_time_s: number }[] }[] }

/** Loads the held-out snapshot. Only this module reads public/data/zergggy/. */
export const loadZergggy = () => j<ZergggyPurchases>('zergggy/purchases.json');

export const CORE_THRESHOLD = 0.3;   // item must appear in >=30% of (win-weighted) sampled matches
export const WIN_WEIGHT = 1.5;       // a won match counts 1.5x, a lost match 1x
export const OVERLAP_WEIGHT = 0.7;   // agreement = 0.7*overlap(F1) + 0.3*order concordance
export const ORDER_WEIGHT = 0.3;

export interface CoreItem { item: Item; frequency: number; medianBuyTimeS: number; matches: number }
export interface CoreSet { core: CoreItem[]; experiments: CoreItem[]; matches: number; wins: number }

export function computeCoreSet(data: ZergggyPurchases, items: Item[]): CoreSet {
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
  return { core: all.filter((c) => c.frequency >= CORE_THRESHOLD), experiments: all.filter((c) => c.frequency < CORE_THRESHOLD), matches: data.matches.length, wins: data.matches.filter((m) => m.won).length };
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
  // order concordance: fraction of shared-item pairs whose relative order matches Zergggy's median buy times
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
