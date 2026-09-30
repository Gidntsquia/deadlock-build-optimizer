import type { UserInsight } from './types.ts';

export interface UserHistory {
  account_id: number;
  matches: { match_id: number; hero_id: number; duration_s: number; net_worth: number; won: boolean }[];
}

export const DEFAULT_BUDGET = 35000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Late-game soul budget = user's median standard-match length × their median souls/min (clamped). */
export function userInsight(h: UserHistory | null, heroId: number): UserInsight | null {
  if (!h || h.matches.length < 5) return null;
  const durMin = median(h.matches.map((m) => m.duration_s / 60));
  const rate = clamp(median(h.matches.map((m) => m.net_worth / (m.duration_s / 60))), 700, 1300);
  const budget = clamp(Math.round((durMin * rate) / 500) * 500, 28000, 48000);
  const hm = h.matches.filter((m) => m.hero_id === heroId);
  const wr = hm.length ? hm.filter((m) => m.won).length / hm.length : null;
  const text =
    `Your median standard match runs ${durMin.toFixed(0)} min at ~${rate.toFixed(0)} souls/min, ` +
    `so the late-game budget is set to ${budget.toLocaleString()} souls.`;
  return { matches: h.matches.length, median_duration_min: durMin, souls_per_min: rate, budget, hero_matches: hm.length, hero_win_rate: wr, text };
}
