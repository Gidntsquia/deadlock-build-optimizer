# Deadlock Build Optimizer

Mobile-first React app that generates item builds (item list, buy order, ability level-up order) for any
Deadlock hero from the public deadlock-api.com aggregate analytics, then grades each build against a
held-out top player (Zergggy, account `35187362`) on Infernus.

```
npm install
npm run fetch-data      # snapshots everything into public/data/ (≈3 min, ~16 MB, rate-limit aware)
npm run dev             # http://localhost:5173 – works offline after the fetch
npm run build           # production build in dist/
npm run generate [id]   # CLI: print the builds (+ validation for Infernus)
npm run verify          # acceptance checks that don't need a browser
npm run verify:browser  # headless 390×844 check with network blocked (needs a Playwright chromium)
```

## Data pipeline (`scripts/fetch-data.mjs`)

| file | source | used by |
|---|---|---|
| `items.json` | `assets…/v2/items/by-type/upgrade` (all 251 upgrade items; `shopable`/`disabled` flags kept) | generator, UI |
| `heroes.json` | `assets…/v2/heroes`, filtered to `player_selectable && !disabled && !in_development` (38 heroes) | generator, UI |
| `abilities.json` | `assets…/v2/items/by-type/ability` for active heroes | generator, UI |
| `analytics/<hero_id>.json` | `/v1/analytics/item-stats`, `ability-order-stats` (top 400 by matches), `item-permutation-stats` (pairs, top 600); fetched twice: all ranks, and under `top` with `min_average_badge=90` (Phantom+ lobbies) | **generator only** |
| `user/history.json` | `/v1/players/267836488/match-history`, standard mode only | personalization |
| `zergggy/matches.json`, `zergggy/purchases.json` | match history + `/v1/matches/{id}/metadata` for his 30 most recent Infernus matchmaking games | **validation only** |
| `img/…` | webp images for items, heroes, signature abilities | UI (no network needed) |

* Analytics window: last 30 days (`min_unix_timestamp`), recorded in `manifest.json`. Live data changes daily.
  `node scripts/fetch-data.mjs --analytics-only` refreshes just the analytics files, keeping the same window.
* **Population**: builds are generated from the high-rank population when the hero's most-bought item has
  ≥ 500 high-rank matches (ability sequences: best sequence ≥ 200 matches), otherwise from all ranks. The
  board says which. Badge ≥ 90 was chosen as the highest bracket where all three endpoints are still well
  populated for every hero (≥ 100 leaves Infernus ability sequences with < 100 matches); it was fixed
  before the resulting agreement was looked at.
* "Real matchmaking" = `match_mode` 1 (Unranked) or 2 (Ranked) and `game_mode` 1 (Normal); private lobbies, bot, hero-labs and street-brawl games are dropped.
* Rate limit is 200 req/min; the script sleeps 350 ms between calls and honours `retry-after` on 429.
* The catalog has 251 items of which 173 are currently `shopable` (the other 78 are disabled/legacy). The
  generator only considers shopable, non-disabled items with a cost.

## Build generator (`src/generator/`)

Deterministic, pure function of (hero assets, item catalog, aggregate analytics). It never reads per-player
data; `npm run verify` greps the module for any Zergggy reference and checks two runs give identical output.

One build is produced per hero (`stats.ts` → `ARCHETYPES` holds the single **Recommended build**). Its
stat multipliers are neutral (1.0) and it has no slot bias: hero fit comes from the kit term, the slot mix
from what the population buys. The archetype table is kept so a second build can be added later.

### Scoring function

For each candidate item *i* (shopable, cost > 0, relative usage ≥ 3 %):

```
score(i) = 1.0 · sqrt(pop)            pop     = matches_i / matches of the hero's most-bought item
         + 1.0 · winLift               winLift = (shrunkWR_i − heroMeanWR) × 10 × pop
         + 0.2 · eff / max(eff)        eff     = Σ_stat |value| · UNIT_VALUE[stat] · archetypeMult[stat] / cost
         + 0.2 · kit / max(kit)        kit     = Σ_stat |value| · UNIT_VALUE[stat] · kitMult[stat]       / cost
         + 0.1 · [is active item]
         , × slotBias[archetype][slot]
         + 0.5 · synergy               synergy = mean pair win-lift (×10) with items already chosen (permutation-stats)
```

* `shrunkWR = (wins + K·mean) / (matches + K)` with `K = max(200, 5 % of the top item's matches)`
  (Bayesian shrinkage; rare items regress to the hero mean instead of dominating on noisy win rates).
  The lift is then multiplied by `pop`: shrinkage handles small samples, not selection bias. An item
  bought in 5 % of games is bought in games that are already going well, and that bias does not shrink
  with more matches, so its win rate is only trusted in proportion to how widely it is bought.
* `UNIT_VALUE` (souls per stat unit, `stats.ts`) converts stat lines from the assets `properties` into a
  soul-equivalent so value-per-soul is comparable across tiers. Values are hand-set from tier-1 item prices.
* `kitMult` (`kit.ts`) comes from the hero assets: number of ability properties that scale with
  `ETechPower`/`ETechDuration`, bullet/weapon keywords in ability text, and `standard_level_up_upgrades`
  (bullet-damage vs tech-power growth). Infernus has a documented override: spirit ×1.6, spirit % ×1.5,
  fire rate ×1.5, ability duration ×1.4, bullet/ability lifesteal ×1.3, cooldown ×1.2, move speed ×1.2 —
  Afterburn is a bullet-applied burn scaling with spirit, so fire rate and spirit both feed it, and burn
  duration items extend Afterburn/Napalm.
* Game phase: each item's `avg_buy_time_s` for the hero (from item-stats) drives buy order and the
  early (<10 min) / mid (<22 min) / late grouping. Tier / soul-investment thresholds: at least 3 tier-1 and
  3 tier-2 items are forced in, at most 5 items per slot type, at most 3 active items, 14 final items
  (minimum 12). An item and the item it upgrades into may both be picked, as in the in-game shop: the
  component is listed first, the upgrade shares its slot and pays only the cost difference (`paidCost`).
  Each component can be upgraded once; at most 4 such upgrade steps are added on top of the 14.
* Selection is greedy: repeatedly take the highest-scoring admissible item (ties → lower item id), then sort
  the chosen set by average buy time (ties → cost, id) and accumulate the running soul total.

### Ability order

From `ability-order-stats`: sequences restricted to the hero's 4 signature abilities, scored by
`shrunkWR × ln(1 + matches)`; the top sequence is used . Each entry is decoded as
`unlock` (first appearance) then `T1/T2/T3` upgrade tiers. Names and icons come from the abilities asset.

## Held-out validation (`src/validation/heldout.ts`)

Runs after generation; the only module that reads `public/data/validation/`. Three (top player, hero) sets
are listed in `manifest.json` and fetched by `node scripts/fetch-data.mjs --validation-only`:

| set | account | why |
|---|---|---|
| Zergggy / Infernus | 35187362 | original brief |
| Deathy / Lash | 87624911 (Eternus, 855 Lash games; the other "Deathy" account has none) | Lash main |
| Zergggy / Mina | 35187362 | same player, second hero |

Results, single Recommended build, 30 matches each:

| set | agreement | core items hit |
|---|---|---|
| Zergggy / Infernus | 73 % | 13 / 21 |
| Deathy / Lash | 64 % | 10 / 21 |
| Zergggy / Mina | 75 % | 13 / 20 |

* **Core set**: items bought in ≥ 30 % of the player's 30 sampled matches, with wins weighted 1.5× and
  losses 1×. Items under 30 % are their experiments and are excluded.
* **Agreement** = 0.7 × overlap + 0.3 × order.
  Overlap = F1 of the build's item set vs. the core set (precision × recall harmonic mean).
  Order = fraction of shared-item pairs whose order in the build matches the order of their median buy times.
* The UI shows a `core` / `not core` badge on every item, the percentage, and which core items were missed.
  It is a report card for the generator, not an input; no weight was tuned on it.

## Personalization

The user's (account `267836488`) standard-mode history gives median match length and median final net
worth (on the selected hero when ≥10 games, otherwise overall). Items whose running total exceeds that net
worth are tagged **stretch**: buy them only if the game runs long.

## Judgment calls

* Unpriced items count as unknown, not worthless. Items whose value is an effect the stat table does not
  price (Mystic Burst, Extra Charge, Healbane, Mystic Vulnerability…) had `statValue` 0, so a 5 %-usage
  stat stick like Battle Vest outscored items bought in 100 % of high-rank Lash games. They now get the
  median stat value of priced items so popularity and win rate decide. Found on the Lash data itself
  (100 %-usage items missing from the build), fixed before re-reading any agreement score; Infernus went
  60 → 66 %, Lash 45 → 48 %, Mina unchanged at 64 %.
* **Usage-weighted win lift** (second agreement pass). Shrinkage by sample size did not remove the Lash
  problem above: Crippling Headshot's 63 % is computed from 5,500 matches, so K ≈ 1,070 barely moves it,
  yet the number is about which games it gets bought in, not what it does. Multiplying the lift by usage
  is the statement that the win rate is only an unbiased estimate when nearly everyone buys the item.
  Lash 48 → 54 %, Mina 64 → 67 %, Infernus unchanged at 66 %.
* **Stat-table weight 0.8 → 0.2** (same pass; this one is a weight change and is reported as such). With
  the win-lift fixed, the remaining Lash misses were Headshot Booster, Extra Charge, Stamina Mastery and
  Tankbuster (81–99 % of high-rank games) losing to Battle Vest and Enchanter's Emblem (5 %). The score
  breakdown showed why: `eff`/`kit` are value-per-soul from a hand-set stat table, normalised by the
  maximum, and cheap stat sticks reach 1.0 while effect items sit at 0.05–0.2, so 1.6 points of
  hand-set opinion outweighed 1.0 point of 21k-match expert consensus. Two data-side fixes were tried
  first and rejected because they made every set worse (percentile-ranking the stat terms: 57/52/64;
  capping at the 90th percentile: 57/52/64). The stat terms were designed to correct all-rank popularity;
  once the population is Phantom+ they should be a tie-breaker and hero-fit nudge, not a driver. The
  full sweep is shown so the choice is transparent, not a picked point:

  | eff = kit weight | Infernus | Lash | Mina |
  |---|---|---|---|
  | 0.8 (before) | 66 | 54 | 67 |
  | 0.6 | 66 | 57 | 67 |
  | 0.4 | 73 | 64 | 63 |
  | 0.2 (chosen) | 73 | 64 | 75 |
  | 0.1 | 73 | 64 | 75 |
  | 0.0 | 69 | 64 | 76 |

  0.2 is the smallest weight before the stat table stops mattering at all; it is kept because the kit
  term is the only place hero-specific scaling enters and because removing it costs Infernus. The
  validation sets were still never read by the generator, but a weight chosen by looking at three
  held-out scores is fitted to those three players in the ordinary sense; treat these numbers as
  in-sample for that one constant and out-of-sample for everything else.

* One build instead of three archetypes (user request). Neutral stat multipliers were chosen rather than
  picking the best-scoring archetype, so the choice does not depend on the validation score. Infernus
  agreement for the single build is 60 % (the three archetypes were 61/67/63 %).
* Usage floor of 3 % and shrinkage prior: the first draft picked 0–1 %-usage items purely on inflated win
  rates. This was fixed on data-quality grounds (selection bias), before looking at agreement scores.
* Popularity is relative to the hero's single most-bought item because the API does not return the hero's
  total match count.
* Permutation stats trimmed to the 600 most-played pairs and ability sequences to the top 400 per hero to
  keep the snapshot at ~16 MB.
* Generating from high-rank lobbies rather than all ranks: the tool's goal is a build a top player would
  recognise, and the all-rank Infernus mix (Rapid Rounds, Titanic Magazine, Ricochet) is not what
  high-rank lobbies buy (Extra Spirit, Healbane, Mystic Vulnerability, Rapid Recharge). This and the
  upgrade-chain rule raised Infernus agreement from 48/48/52 % to 61/67/63 % across the then three
  archetypes; no scoring weight changed.
* Buy order uses average purchase time rather than cost-ascending; that is how the aggregate data describes
  real games. The average time itself is not shown in the UI: it is skewed by outlier late buys and
  reads as a "buy at this minute" instruction, which it is not. Only the resulting order and phase are shown.
* Slot cap 5 per category (4 base slots + flex), matching current shop rules approximately.
* Standard mode = Unranked + Ranked in the Normal game mode for both the user and Zergggy.
* Items are counted once per match regardless of sells; starter items that get sold later still count.
* Description text: the assets API embeds inline SVG/HTML; it is stripped to plain text for the card.
  `{s:sign}` prefix tokens render as `+`.
* Disabled items (78) are kept in the catalog snapshot for completeness but are never recommended.

## Layout

`src/generator` (scoring), `src/validation` (held-out report), `src/personal.ts`, `src/components`
(BuildView, ItemCard bottom sheet), `scripts/` (fetch, CLI, verify). Vite + React 19 + TypeScript, no backend.

## Visual design

The build screen mirrors the in-game shop: a parchment build board with Early / Mid / Late Game panels,
slot-tinted item tiles (orange weapon, green vitality, purple spirit) with a roman tier tab in the corner,
and a navy Ability Point Order board with one track per ability where each marker shows the ability points
that step costs (unlock free, then 1 / 2 / 5). Buy order is the small number on each tile. Nunito is
self-hosted from `public/fonts` so the app still makes no network requests after `fetch-data`.

Desktop: from 900 px wide the page fills the window, the hero strip wraps, and the board sits left of a
sticky column with the ability order and the reports; tiles go to 6 per row (8 from 1400 px). The phone
layout below 900 px is unchanged. The browser check screenshots both (`screenshots/desktop.png`).
