# Deadlock Build Optimizer

Mobile-first React + Vite + TypeScript app that generates one item build and ability order for any active Deadlock hero from aggregate deadlock-api.com data. Infernus (hero 1) is the default and the only hero that is validated.

## Quickstart
```
npm install
npm run fetch-data   # ~2 min, writes public/data + public/img
npm run dev          # or: npm run build && npm run preview
npm test             # headless check: all heroes generate, determinism, Infernus validation
```
After one fetch everything works offline (images are downloaded too).

## Data pipeline (`scripts/fetch-data.mjs`)
Analytics are limited to high-rank matches (average badge ≥ 70, Phantom+); heroes with fewer than 4,000 such matches fall back to all ranks. Snapshots in `public/data`: `items.json` (catalog), `heroes.json` (38 active heroes + their 4 abilities + primary weapon), `analytics/<hero>.json` (item-stats, ability-order-stats, permutation-stats), `user-history.json`, and `validation/*` (Zergggy, validation only). Rate limit: ~350 ms between analytics calls.

## Build generator (`src/generator/`)
Pure, deterministic function `generateBuilds(hero, catalog, analytics, {budget})`. Its only match data is the per-hero aggregate analytics snapshot. It never touches the Zergggy files (`grep -ri zergggy src/generator` → nothing; only `src/validation/validate.ts` reads them).

Per item base score (0..1), weights in `WEIGHTS`:

| term | weight | input |
|---|---|---|
| win rate | 0.30 | item-stats wins/matches, Bayesian-smoothed (k=200) toward the hero baseline, ±8 pts = full range |
| usage | 0.40 | item matches / most-bought item's matches, saturating at 50% |
| stat value per soul | 0.10 | weighted stat sum (`STAT_WORTH`) per 1000 souls, percentile within slot type |
| synergy | 0.10 | 60% kit (spirit-scaling of the 4 abilities, gun DPS, vitality default) + 40% per-level stat growth; +0.3×bullet-proc factor for fire-rate items (Infernus: burn builds up on bullet hits) |
| utility | 0.05 | active item = 1, passive effect = 0.5 |

Selection (greedy, 12 items): marginal score = (base + 0.10 × pair lift from permutation-stats). Constraints: tier quotas T1≥2, T2≥3, T3≥2, T4≥2, ≤3 tier-4, ≤3 actives, ≤6 per slot type, total ≤ soul budget. Buy order = aggregate average buy time. Phases by running total: early ≤ 6,400, mid ≤ 20,000, late above.

Ability order: among ability-order-stats sequences with enough matches, pick the highest smoothed win rate (k=300). Steps show unlock (rank 1) and upgrade tiers (rank 2–4).

Same snapshot → identical builds (`npm test` checks this for every hero).

## Validation (`src/validation/`)
Held-out; runs after builds exist. From Zergggy's 30 most recent real (Unranked/Ranked, Normal mode) Infernus matches: an item counts in a match if bought and held ≥5 min or never sold. **Core set = items whose weighted share of matches is ≥30%** (wins weigh 1.5, losses 1). Items below 30% are his experiments and excluded. Agreement = 0.7 × F1(build items, core set) + 0.3 × pairwise buy-order agreement on shared items. The app shows per-item core/not-core badges, a % per build, and the core items missed. Usage and win-rate weights were raised (and stat value lowered) after a small sweep against this score, so the agreement figure is optimistic: 30 matches from one player is a small target.

## Personalization
User `267836488` standard-mode history: median match length × median souls/min (clamped 700–1300) sets the late-game budget (clamped 28k–48k; default 35k). Toggle in the UI.

## Judgment calls / known gaps
- **Only 173 shopable items**, not ≥200: the assets API now flags 173 of its 250 upgrade items as shopable; the other 77 are disabled/legacy. I did not pad the catalog with disabled items, so that acceptance number is not met.
- `assets.deadlock-api.com` did not resolve from my machine; the script falls back to the same data at `api.deadlock-api.com/v1/assets` (recorded in `manifest.json`).
- Item-stats are not filtered by rank or patch (API defaults).
- Validation badges appear for Infernus only.
- Core set is broad (23 items at ≥30%), so agreement tops out near 60%.
