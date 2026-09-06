// Build-style detection from CONDITIONAL aggregate item stats (deadlock-api item-stats with
// include_item_ids=<anchor>): for every candidate anchor item we know how the hero's item usage looks
// in the games where that item was bought. An anchor defines an alternative build style when the games
// built around it look materially different from the hero's population as a whole. All inputs are
// aggregate; no per-player data is involved. See the wiki "How the Build Generator Works" / "Build styles".
export const STYLE = {
  candidateShare: [0.04, 0.7], // anchors are items bought in 4%..70% of the hero's high-rank games
  minShare: 0.05,              // a style needs >=5% of games behind it to count as established
  minDisplacement: 0.3,        // >=30% (usage-weighted) of the staples (>=50% usage) fall below half their usage
  minNewCore: 2,               // >=2 items reach >=50% usage with >=1.8x lift vs the population
  newCoreLift: 1.8,
  sameStyleShare: 0.5,         // two anchors are one style when either is bought in >=50% of the other's games
  maxStyles: 2,                // at most two alternative styles (three builds) per hero
  maxAnchors: 4,               // anchors kept per style (seed + 3); the main style excludes games with any of them
};

/** usage map item_id -> matches / (matches of the most-bought item) */
export const usageOf = (stats) => { const n = Math.max(1, ...stats.map((s) => s.matches)); return { n, u: new Map(stats.map((s) => [s.item_id, s.matches / n])) }; };

/**
 * @param unconditional item stats of the population (shop items only)
 * @param conditional   { [anchorId]: item stats given the anchor was bought }
 * @returns styles, biggest first: { seed, anchors, share, displacement, newCore: item ids }
 */
export function detectStyles(unconditional, conditional, cfg = STYLE) {
  const { n: N, u } = usageOf(unconditional);
  const staples = [...u].filter(([, x]) => x >= 0.5);
  const staplesW = staples.reduce((a, [, x]) => a + x, 0) || 1;
  const profiles = new Map();
  for (const [key, rows] of Object.entries(conditional)) {
    const a = Number(key);
    if (!rows?.length) continue;
    const { n: Na, u: c } = usageOf(rows);
    const share = Na / N;
    const displacement = staples.filter(([i, x]) => i !== a && (c.get(i) ?? 0) < 0.5 * x).reduce((s, [, x]) => s + x, 0) / staplesW;
    const newCore = [...c].filter(([i, x]) => i !== a && x >= 0.5 && x / Math.max(0.01, u.get(i) ?? 0) >= cfg.newCoreLift).map(([i]) => i);
    profiles.set(a, { seed: a, share, displacement, newCore, c });
  }
  const passing = [...profiles.values()]
    .filter((p) => p.share >= cfg.minShare && p.displacement >= cfg.minDisplacement && p.newCore.length >= cfg.minNewCore)
    .sort((x, y) => y.displacement * y.share - x.displacement * x.share || x.seed - y.seed);
  const styles = [];
  for (const p of passing) {
    const home = styles.find((s) => Math.max(p.c.get(s.seed) ?? 0, profiles.get(s.seed).c.get(p.seed) ?? 0) >= cfg.sameStyleShare);
    if (home) { if (home.anchors.length < cfg.maxAnchors) home.anchors.push(p.seed); continue; }
    styles.push({ seed: p.seed, anchors: [p.seed], share: p.share, displacement: p.displacement, newCore: p.newCore });
  }
  return styles.sort((x, y) => y.share - x.share || x.seed - y.seed).slice(0, cfg.maxStyles);
}
