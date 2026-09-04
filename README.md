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
| `analytics/<hero_id>.json` | `/v1/analytics/item-stats`, `ability-order-stats` (top 400 by matches), `item-permutation-stats` (pairs, top 600) | **generator only** |
| `user/history.json` | `/v1/players/267836488/match-history`, standard mode only | personalization |
| `zergggy/matches.json`, `zergggy/purchases.json` | match history + `/v1/matches/{id}/metadata` for his 30 most recent Infernus matchmaking games | **validation only** |
| `img/…` | webp images for items, heroes, signature abilities | UI (no network needed) |

* Analytics window: last 30 days (`min_unix_timestamp`), recorded in `manifest.json`. Live data changes daily.
* "Real matchmaking" = `match_mode` 1 (Unranked) or 2 (Ranked) and `game_mode` 1 (Normal); private lobbies, bot, hero-labs and street-brawl games are dropped.
* Rate limit is 200 req/min; the script sleeps 350 ms between calls and honours `retry-after` on 429.
* The catalog has 251 items of which 173 are currently `shopable` (the other 78 are disabled/legacy). The
  generator only considers shopable, non-disabled items with a cost.

## Build generator (`src/generator/`)

Deterministic, pure function of (hero assets, item catalog, aggregate analytics). It never reads per-player
data; `npm run verify` greps the module for any Zergggy reference and checks two runs give identical output.

Three named archetypes are produced for every hero (`stats.ts` → `ARCHETYPES`): **Gun Carry**,
**Spirit Burn**, **Hybrid Bruiser**. Each archetype is a table of per-stat multipliers and a slot bias.

### Scoring function

For each candidate item *i* (shopable, cost > 0, relative usage ≥ 3 %):

```
score(i) = 1.0 · sqrt(pop)            pop     = matches_i / matches of the hero's most-bought item
         + 1.0 · winLift               winLift = (shrunkWR_i − heroMeanWR) × 10
         + 0.8 · eff / max(eff)        eff     = Σ_stat |value| · UNIT_VALUE[stat] · archetypeMult[stat] / cost
         + 0.8 · kit / max(kit)        kit     = Σ_stat |value| · UNIT_VALUE[stat] · kitMult[stat]       / cost
         + 0.1 · [is active item]
         , × slotBias[archetype][slot]
         + 0.5 · synergy               synergy = mean pair win-lift (×10) with items already chosen (permutation-stats)
```

* `shrunkWR = (wins + K·mean) / (matches + K)` with `K = max(200, 5 % of the top item's matches)`
  (Bayesian shrinkage; rare items regress to the hero mean instead of dominating on noisy win rates).
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
  3 tier-2 items are forced in, at most 5 items per slot type, at most 3 active items, 14 items total
  (minimum 12). An item is never picked together with its own component/upgrade.
* Selection is greedy: repeatedly take the highest-scoring admissible item (ties → lower item id), then sort
  the chosen set by average buy time (ties → cost, id) and accumulate the running soul total.

### Ability order

From `ability-order-stats`: sequences restricted to the hero's 4 signature abilities, scored by
`shrunkWR × ln(1 + matches)`; the top sequence is used (same for all archetypes). Each entry is decoded as
`unlock` (first appearance) then `T1/T2/T3` upgrade tiers. Names and icons come from the abilities asset.

## Zergggy validation (`src/validation/zergggy.ts`) – held-out

Runs after generation; the only module that reads `public/data/zergggy/`.

* **Core set**: items bought in ≥ 30 % of his 30 sampled matches, with wins weighted 1.5× and losses 1×.
  Items under 30 % are his experiments and are excluded.
* **Agreement** = 0.7 × overlap + 0.3 × order.
  Overlap = F1 of the build's item set vs. the core set (precision × recall harmonic mean).
  Order = fraction of shared-item pairs whose order in the build matches the order of his median buy times.
* The UI shows a `core` / `not core` badge on every item, the percentage, and which core items were missed.
  It is a report card for the generator, not an input; no weight was tuned on it.

## Personalization

The user's (account `267836488`) standard-mode history gives median match length and median final net
worth (on the selected hero when ≥10 games, otherwise overall). Items whose running total exceeds that net
worth are tagged **stretch**: buy them only if the game runs long.

## Judgment calls

* Three archetypes instead of two, so heroes whose kit is neither gun- nor spirit-heavy still get a sensible option.
* Usage floor of 3 % and shrinkage prior: the first draft picked 0–1 %-usage items purely on inflated win
  rates. This was fixed on data-quality grounds (selection bias), before looking at agreement scores.
* Popularity is relative to the hero's single most-bought item because the API does not return the hero's
  total match count.
* Same ability sequence for all archetypes: ability-order stats are not split by item build.
* Permutation stats trimmed to the 600 most-played pairs and ability sequences to the top 400 per hero to
  keep the snapshot at ~16 MB.
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
