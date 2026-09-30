// Held-out validation. This is the ONLY module that reads the Zergggy snapshot.
// It runs after the builds exist and never feeds back into the generator.
import type { Build } from '../types.ts';

export const ZERG_PURCHASES_FILE = 'data/validation/zergggy-infernus-purchases.json';
export const CORE_THRESHOLD = 0.3; // weighted share of sampled matches an item must appear in
export const WIN_WEIGHT = 1.5; // a match he won counts 1.5x, a loss 1x
export const MIN_HOLD_S = 300; // a purchase sold again within 5 min is a refund/mis-buy, not a real pick
export const OVERLAP_WEIGHT = 0.7;
export const ORDER_WEIGHT = 0.3;

export interface ZergMatch {
  match_id: number;
  won: boolean;
  items: { item_id: number; t: number; sold: number }[];
}
export interface ZergSnapshot { account_id: number; matches: ZergMatch[] }

export interface CoreItem {
  item_id: number;
  weighted_share: number; // 0..1
  raw_matches: number;
  median_buy_time_s: number;
  core: boolean;
}
export interface CoreSet {
  matches: number;
  items: Map<number, CoreItem>;
  coreIds: number[];
}

export async function loadZergSnapshot(base: string): Promise<ZergSnapshot> {
  const res = await fetch(`${base}${ZERG_PURCHASES_FILE}`);
  if (!res.ok) throw new Error(`validation snapshot missing (${res.status})`);
  return res.json();
}

export function computeCoreSet(snap: ZergSnapshot, validItemIds: Set<number>): CoreSet {
  const weights = snap.matches.map((m) => (m.won ? WIN_WEIGHT : 1));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const acc = new Map<number, { w: number; n: number; times: number[] }>();
  snap.matches.forEach((m, i) => {
    const first = new Map<number, number>();
    for (const it of m.items) {
      if (!validItemIds.has(it.item_id)) continue;
      const held = it.sold === 0 || it.sold - it.t >= MIN_HOLD_S;
      if (!held) continue;
      if (!first.has(it.item_id)) first.set(it.item_id, it.t);
    }
    for (const [id, t] of first) {
      const a = acc.get(id) ?? { w: 0, n: 0, times: [] };
      a.w += weights[i];
      a.n++;
      a.times.push(t);
      acc.set(id, a);
    }
  });
  const items = new Map<number, CoreItem>();
  for (const [id, a] of acc) {
    const ts = a.times.sort((x, y) => x - y);
    items.set(id, {
      item_id: id, weighted_share: a.w / totalW, raw_matches: a.n,
      median_buy_time_s: ts[Math.floor(ts.length / 2)], core: a.w / totalW >= CORE_THRESHOLD,
    });
  }
  const coreIds = [...items.values()].filter((i) => i.core).map((i) => i.item_id).sort((a, b) => a - b);
  return { matches: snap.matches.length, items, coreIds };
}

export interface BuildValidation {
  build_id: string;
  agreement: number; // 0..1
  overlap: number; // F1 between build items and core set
  order: number; // pairwise buy-order agreement on shared items
  shared: number[];
  missed_core: number[];
  per_item: Map<number, { core: boolean; share: number }>;
}

export function validateBuild(build: Build, core: CoreSet): BuildValidation {
  const ids = build.items.map((i) => i.item_id);
  const coreSet = new Set(core.coreIds);
  const shared = ids.filter((id) => coreSet.has(id));
  const overlap = ids.length + core.coreIds.length ? (2 * shared.length) / (ids.length + core.coreIds.length) : 0;

  // order agreement: fraction of shared-item pairs whose relative order matches his median buy order
  let agree = 0;
  let pairs = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const ta = core.items.get(shared[i])!.median_buy_time_s;
      const tb = core.items.get(shared[j])!.median_buy_time_s;
      if (ta === tb) continue;
      pairs++;
      if (ta < tb) agree++; // build order is shared[i] before shared[j]
    }
  }
  const order = pairs ? agree / pairs : 0;
  const agreement = OVERLAP_WEIGHT * overlap + ORDER_WEIGHT * order;
  const per_item = new Map<number, { core: boolean; share: number }>();
  for (const id of ids) {
    const c = core.items.get(id);
    per_item.set(id, { core: !!c?.core, share: c?.weighted_share ?? 0 });
  }
  return {
    build_id: build.id, agreement, overlap, order, shared,
    missed_core: core.coreIds.filter((id) => !ids.includes(id)), per_item,
  };
}
