// Light personalization from the user's own standard-mode match history (account 267836488).
export interface UserHistory { account_id: number; matches: { match_id: number; hero_id: number; match_duration_s: number; match_result: number; player_team: number; net_worth: number }[] }

export interface PersonalInsight {
  matches: number; medianDurationS: number; medianNetWorth: number; heroMatches: number; heroWinRate: number | null;
  /** soul budget the build is judged against: the user's median final net worth on this hero (or overall) */
  budget: number;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function personalInsight(h: UserHistory, heroId: number): PersonalInsight {
  const all = h.matches;
  const hero = all.filter((m) => m.hero_id === heroId);
  const pool = hero.length >= 10 ? hero : all;
  const wins = hero.filter((m) => m.match_result === m.player_team).length;
  return {
    matches: all.length,
    medianDurationS: median(all.map((m) => m.match_duration_s)),
    medianNetWorth: median(pool.map((m) => m.net_worth)),
    heroMatches: hero.length,
    heroWinRate: hero.length ? wins / hero.length : null,
    budget: median(pool.map((m) => m.net_worth)),
  };
}
