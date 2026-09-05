// Held-out check for the Street Brawl engine against real Street Brawl matches (public/data/validation/brawl-*.json).
// Offers are not recorded anywhere, only picks, so the check asks: when the player picked item X in round r,
// where does X rank among every item of its tier by the engine's score? A random picker averages 0.5;
// someone who always takes the engine's favourite of three random cards averages about 0.75.
// This module only reads validation data; nothing here feeds back into src/brawl/.
import type { Item } from '../types';
import { j } from '../data/load';
import { baseScores, pairLifts, scoreOffer, type BrawlInput } from '../brawl';

export interface BrawlHeldoutMatch {
  match_id: number; start_time: number; duration_s: number; hero_id: number; team: number; won: boolean;
  rounds: { round_duration_s: number; winning_team: number }[];
  players: { team: number; hero_id: number }[];
  items: { item_id: number; game_time_s: number; sold_time_s: number }[];
}
export interface BrawlHeldout { account_id: number; game_mode: number; matches: BrawlHeldoutMatch[] }
export const loadBrawlHeldout = (file: string) => j<BrawlHeldout>(file);

export const ROUND_GAP_S = 40; // picks more than 40 s apart belong to different buy phases

export interface PickRound { round: number; picks: Item[]; ownedBefore: number[] }

/** Groups a match's upgrade purchases into rounds by time gaps; ability unlocks are dropped. */
export function pickRounds(m: BrawlHeldoutMatch, catalog: Map<number, Item>): PickRound[] {
  const buys = m.items.filter((i) => catalog.has(i.item_id)).sort((a, b) => a.game_time_s - b.game_time_s);
  const rounds: PickRound[] = [];
  let cur: PickRound | null = null, last = -Infinity;
  const owned: { id: number; sold: number }[] = [];
  for (const b of buys) {
    if (!cur || b.game_time_s - last > ROUND_GAP_S) {
      cur = { round: rounds.length + 1, picks: [], ownedBefore: owned.filter((o) => !o.sold || o.sold > b.game_time_s).map((o) => o.id) };
      rounds.push(cur);
    }
    cur.picks.push(catalog.get(b.item_id)!);
    owned.push({ id: b.item_id, sold: b.sold_time_s });
    last = b.game_time_s;
  }
  return rounds;
}

export interface PickCheck { match_id: number; round: number; item: Item; percentile: number; popPercentile: number; poolSize: number }
export interface BrawlValidation { hero_id: number; matches: number; picks: PickCheck[]; meanPercentile: number; meanPopPercentile: number; topThird: number }

export function validateBrawlPicks(input: BrawlInput, data: BrawlHeldout): BrawlValidation {
  const catalog = new Map(input.items.filter((i) => !i.disabled && i.item_tier >= 1).map((i) => [i.id, i]));
  const pair = pairLifts(input);
  const picks: PickCheck[] = [];
  for (const m of data.matches) {
    if (m.hero_id !== input.hero.id) continue;
    const enemies = m.players.filter((p) => p.team !== m.team).map((p) => p.hero_id);
    const bases = baseScores(input, enemies);
    for (const r of pickRounds(m, catalog)) {
      for (const it of r.picks) {
        const state = { round: r.round, owned: r.ownedBefore, enemies, sets: [] };
        const pool = [...bases.values()].filter((b) => b.item.item_tier === it.item_tier && b.stat && b.item.id !== it.id);
        if (pool.length < 5 || !bases.get(it.id)?.stat) continue;
        const mine = scoreOffer(input, bases, pair, state, { itemId: it.id });
        let below = 0, popBelow = 0;
        for (const b of pool) {
          const o = scoreOffer(input, bases, pair, state, { itemId: b.item.id });
          if (o.score < mine.score) below++;
          if (o.parts.pop < mine.parts.pop) popBelow++;
        }
        picks.push({ match_id: m.match_id, round: r.round, item: it, percentile: below / pool.length, popPercentile: popBelow / pool.length, poolSize: pool.length });
      }
    }
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
  return {
    hero_id: input.hero.id, matches: data.matches.filter((m) => m.hero_id === input.hero.id).length, picks,
    meanPercentile: mean(picks.map((p) => p.percentile)), meanPopPercentile: mean(picks.map((p) => p.popPercentile)),
    topThird: picks.length ? picks.filter((p) => p.percentile >= 2 / 3).length / picks.length : 0,
  };
}
