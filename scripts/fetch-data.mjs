// Data pipeline: snapshots every remote input the app needs into public/data/.
// After one successful run the app and the generator work fully offline.
//
// Outputs
//   public/data/items.json                 item catalog (all upgrade items)
//   public/data/heroes.json                active heroes with base stats + growth
//   public/data/abilities.json             abilities of active heroes (names, upgrades)
//   public/data/analytics/<hero_id>.json   item-stats, ability-order-stats, item-permutation-stats
//   public/data/validation/<account>-<hero>.json  a top player's ~30 most recent matches on one hero with
//                                          per-match purchases                     (VALIDATION ONLY)
//   public/data/img/{items,heroes,abilities}/  webp images so the app needs no network at all
//   public/data/brawl-config.json          Street Brawl mode constants (round budgets, draft tiers/weights)
//   public/data/analytics/brawl/<hero_id>.json  Street Brawl item-stats, pair stats, and item-stats vs every enemy hero
//   public/data/validation/brawl-<account>.json your Street Brawl matches with per-round picks (VALIDATION ONLY;
//                                          only when DEADLOCK_ACCOUNT_ID is set)
//   public/data/manifest.json              timestamps + counts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.deadlock-api.com';
const ASSETS = 'https://assets.deadlock-api.com';
const OUT = path.resolve('public/data');
// Optional: your own account id (the number in your deadlock-api / Steam3 profile). Only used to fetch your
// Street Brawl matches as a held-out validation set. Leave unset to skip that step.
const USER = Number(process.env.DEADLOCK_ACCOUNT_ID) || null;
// Held-out validation sets: (top player, hero). Never read by the generator.
const VALIDATION_SETS = [
  { account_id: 35187362, player: 'Zergggy', hero_id: 1, hero: 'Infernus' },
  { account_id: 87624911, player: 'Deathy', hero_id: 31, hero: 'Lash' },
  { account_id: 35187362, player: 'Zergggy', hero_id: 63, hero: 'Mina' },
  { account_id: 133544364, player: 'Yndio', hero_id: 12, hero: 'Kelvin' }, // #2 on the NA Kelvin leaderboard (/v1/leaderboard/NAmerica/12) on 2026-09-04, 2,151 Kelvin games; #1 (Chounted) has 189 and was 9-21 in the sample
];
const VALIDATION_MATCH_TARGET = 30;
const VALIDATION_ONLY = process.argv.includes('--validation-only');
// Analytics window: last 30 days (live data; the window is recorded in manifest.json).
const WINDOW_DAYS = 30;
// High-rank population: average lobby badge >= 90 (Phantom and above). Chosen as the highest bracket
// where all three analytics endpoints are still well populated for every hero (Ascendant+ leaves
// ability-order sequences with <100 matches). Builds are generated from this population when it is
// large enough, so they follow what top-rank players actually buy rather than the all-rank average.
const TOP_BADGE = 90;
// `--analytics-only` refreshes only public/data/analytics/* from the existing heroes.json.
const ANALYTICS_ONLY = process.argv.includes('--analytics-only');
// `--brawl` refreshes only the Street Brawl snapshot (brawl-config.json, analytics/brawl/*, validation/brawl-*).
const BRAWL_ONLY = process.argv.includes('--brawl') || process.argv.includes('--brawl-user-only');
// `--brawl-user-only` skips brawl-config / per-hero analytics and refreshes only the user's brawl matches.
const BRAWL_USER_ONLY = process.argv.includes('--brawl-user-only');
const MAX_WAIT_MS = 30 * 60 * 1000;
// Street Brawl analytics: the API has no rank filter for this mode (400 "Cannot filter by average badge"),
// so there is one all-rank population. Enemy-filtered item-stats are fetched for every hero as the counter term.
const BRAWL_GAME_MODE = 'street_brawl';
const BRAWL_GAME_MODE_ID = 4; // game_mode value in match-history / match metadata
let MIN_TS = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
// Rate limit is 200 req / 60 s -> ~350 ms between requests keeps us well under.
const SLEEP_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        // retry-after can be an hour on the match-metadata endpoint; cap it and let the caller skip the row
        // match metadata is limited to a few calls per hour per IP: honour its retry-after up to MAX_WAIT_MS there
        const maxWait = url.includes('/metadata') ? MAX_WAIT_MS : 60000;
        const wait = Math.min(maxWait, Number(res.headers.get('retry-after') || 0) * 1000 || 2000 * (i + 1));
        console.warn(`  ${res.status} on ${url} – waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const j = await res.json();
      await sleep(SLEEP_MS);
      return j;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// Downloads an image once into public/data/img/<dir>/<id>.webp and returns the app-relative path.
async function saveImage(url, dir, id, suffix = '') {
  if (!url) return undefined;
  const rel = `img/${dir}/${id}${suffix}.webp`;
  const f = path.join(OUT, rel);
  await mkdir(path.dirname(f), { recursive: true });
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status}`);
    await writeFile(f, Buffer.from(await res.arrayBuffer()));
    await sleep(40);
    return rel;
  } catch (e) {
    console.warn(`  image failed ${url}: ${e.message}`);
    return undefined;
  }
}

const save = async (rel, data) => {
  const f = path.join(OUT, rel);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(data));
  console.log(`wrote ${rel}`);
};

// Keep only fields the app needs; the SVG-heavy description blobs are kept
// because the item card renders their text.
function slimItem(it) {
  const props = {};
  for (const [k, v] of Object.entries(it.properties || {})) {
    props[k] = { value: v.value, label: v.label, postfix: v.postfix, prefix: v.prefix, css_class: v.css_class };
  }
  return {
    id: it.id, class_name: it.class_name, name: it.name, cost: it.cost ?? 0,
    item_tier: it.item_tier, item_slot_type: it.item_slot_type,
    shopable: !!it.shopable, disabled: !!it.disabled, is_active_item: !!it.is_active_item,
    activation: it.activation, component_items: it.component_items || [],
    shop_image_webp: it.shop_image_webp || it.image_webp, image_webp: it.image_webp,
    description: it.description || {}, tooltip_sections: it.tooltip_sections || [],
    properties: props,
  };
}

function slimHero(h) {
  return {
    id: h.id, name: h.name, class_name: h.class_name,
    description: h.description, images: { small: h.images?.icon_image_small_webp, card: h.images?.icon_hero_card_webp },
    starting_stats: Object.fromEntries(Object.entries(h.starting_stats || {}).map(([k, v]) => [k, v.value])),
    standard_level_up_upgrades: h.standard_level_up_upgrades || {},
    level_info: h.level_info || {},
    abilities: [h.items?.signature1, h.items?.signature2, h.items?.signature3, h.items?.signature4].filter(Boolean),
    gun_tag: h.gun_tag, tags: h.tags,
  };
}

function slimAbility(a) {
  return {
    id: a.id, class_name: a.class_name, name: a.name, hero: a.hero, image_webp: a.image_webp,
    ability_type: a.ability_type, description: a.description?.desc || '',
    upgrades: (a.upgrades || []).map((u) => (u.property_upgrades || []).map((p) => ({ name: p.name, bonus: String(p.bonus) }))),
    properties: Object.fromEntries(
      Object.entries(a.properties || {})
        .filter(([, v]) => v && v.value !== undefined)
        .map(([k, v]) => [k, { value: v.value, scale: v.scale_function?.specific_stat_scale_type || v.scale_function?.scaling_stats || null }]),
    ),
  };
}

async function fetchPopulation(heroId, extra = '') {
  const q = `hero_id=${heroId}&min_unix_timestamp=${MIN_TS}${extra}`;
  const [item_stats, ability_order_stats, permutation_stats] = await Promise.all([
    getJson(`${API}/v1/analytics/item-stats?${q}`),
    getJson(`${API}/v1/analytics/ability-order-stats?${q}&min_matches=5`),
    getJson(`${API}/v1/analytics/item-permutation-stats?${q}&comb_size=2`),
  ]);
  // Ability sequences and pair stats are very large (10k+ rows); keep the most-played rows.
  const abilitySeqs = [...ability_order_stats].sort((a, b) => b.matches - a.matches).slice(0, 400);
  const pairs = [...permutation_stats].sort((a, b) => b.matches - a.matches).slice(0, 600);
  return { item_stats, ability_order_stats: abilitySeqs, permutation_stats: pairs };
}

async function fetchAnalytics(heroes, manifest) {
  console.log(`4/5 per-hero analytics (${heroes.length} heroes, all ranks + badge>=${TOP_BADGE})`);
  for (const h of heroes) {
    const all = await fetchPopulation(h.id);
    const top = await fetchPopulation(h.id, `&min_average_badge=${TOP_BADGE}`);
    const topMatches = Math.max(0, ...top.item_stats.map((s) => s.matches));
    console.log(`   ${h.name}: top-rank max item matches ${topMatches}`);
    await save(`analytics/${h.id}.json`, { hero_id: h.id, ...all, top: { min_average_badge: TOP_BADGE, ...top } });
  }
  manifest.counts.analytics_heroes = heroes.length;
  manifest.top_min_average_badge = TOP_BADGE;
}

async function fetchValidation(manifest) {
  console.log('5/5 held-out top-player matches (validation only)');
  manifest.validation_sets = [];
  const histories = new Map();
  for (const v of VALIDATION_SETS) {
    if (!histories.has(v.account_id)) histories.set(v.account_id, await getJson(`${API}/v1/players/${v.account_id}/match-history`));
    const hist = histories.get(v.account_id);
    const onHero = hist.filter((m) => m.hero_id === v.hero_id);
    const real = onHero.filter((m) => (m.match_mode === 1 || m.match_mode === 2) && m.game_mode === 1).sort((a, b) => b.start_time - a.start_time);
    const purchases = [];
    for (const m of real) {
      if (purchases.length >= VALIDATION_MATCH_TARGET) break;
      try {
        const meta = await getJson(`${API}/v1/matches/${m.match_id}/metadata`);
        const mi = meta.match_info;
        const p = (mi.players || []).find((x) => x.account_id === v.account_id);
        if (!p) continue;
        purchases.push({
          match_id: m.match_id, start_time: mi.start_time, duration_s: mi.duration_s,
          match_mode: mi.match_mode, game_mode: mi.game_mode,
          won: p.team === mi.winning_team, net_worth: p.net_worth,
          items: (p.items || []).map((it) => ({ item_id: it.item_id, game_time_s: it.game_time_s, sold_time_s: it.sold_time_s })),
        });
      } catch (e) { console.warn(`  skip match ${m.match_id}: ${e.message}`); }
    }
    const file = `validation/${v.account_id}-${v.hero_id}.json`;
    await save(file, { ...v, total_hero_matches: onHero.length, matchmaking_hero_matches: real.length, matches: purchases });
    manifest.validation_sets.push({ ...v, file, matches: purchases.length });
  }
  manifest.counts.validation_sets = VALIDATION_SETS.length;
  delete manifest.counts.zergggy_matches_with_purchases;
}

// One row per item, slimmed to what the counter term needs.
const slimStat = (s) => ({ item_id: s.item_id, wins: s.wins, matches: s.matches });

async function fetchBrawl(heroes, manifest) {
  if (!BRAWL_USER_ONLY) await fetchBrawlAnalytics(heroes);
  await fetchBrawlUser(heroes, manifest);
}

async function fetchBrawlAnalytics(heroes) {
  console.log(`brawl 1/3 mode config`);
  const generic = await getJson(`${ASSETS}/v2/generic-data`);
  await save('brawl-config.json', { fetched_at: new Date().toISOString(), ...generic.street_brawl });
  console.log(`brawl 2/3 per-hero Street Brawl analytics (${heroes.length} heroes x ${heroes.length} enemies)`);
  for (const h of heroes) {
    const q = `hero_id=${h.id}&game_mode=${BRAWL_GAME_MODE}&min_unix_timestamp=${MIN_TS}`;
    const item_stats = await getJson(`${API}/v1/analytics/item-stats?${q}`);
    const perm = await getJson(`${API}/v1/analytics/item-permutation-stats?${q}&comb_size=2`);
    const permutation_stats = [...perm].sort((a, b) => b.matches - a.matches).slice(0, 600);
    const vs = {};
    for (const e of heroes) {
      if (e.id === h.id) continue;
      try { vs[e.id] = (await getJson(`${API}/v1/analytics/item-stats?${q}&enemy_hero_ids=${e.id}`)).map(slimStat); }
      catch (err) { console.warn(`  vs ${e.name} failed: ${err.message}`); }
    }
    const maxM = Math.max(0, ...item_stats.map((s) => s.matches));
    console.log(`   ${h.name}: max item matches ${maxM}, ${item_stats.length} items, ${Object.keys(vs).length} enemies`);
    await save(`analytics/brawl/${h.id}.json`, { hero_id: h.id, game_mode: BRAWL_GAME_MODE, item_stats, permutation_stats, vs });
  }
}

// Metadata for old matches often 503s; tries are kept low so one dead match does not stall the run.
async function fetchBrawlUser(heroes, manifest) {
  if (!USER) { console.log('brawl 3/3 skipped: set DEADLOCK_ACCOUNT_ID to fetch your Street Brawl matches for validation'); return; }
  console.log('brawl 3/3 your Street Brawl matches (validation only)');
  const hist = await getJson(`${API}/v1/players/${USER}/match-history`);
  const brawl = hist.filter((m) => m.game_mode === BRAWL_GAME_MODE_ID).sort((a, b) => b.start_time - a.start_time);
  // the metadata endpoint is throttled to roughly one call a minute; keep what earlier runs fetched and add the rest
  const file = `validation/brawl-${USER}.json`;
  let matches = [];
  try { matches = JSON.parse(await readFile(path.join(OUT, file), 'utf8')).matches || []; } catch { /* first run */ }
  const have = new Set(matches.map((m) => m.match_id));
  const todo = brawl.filter((m) => !have.has(m.match_id));
  console.log(`   ${brawl.length} brawl matches in history, ${matches.length} already saved, ${todo.length} to fetch`);
  for (const m of todo) {
    try {
      const meta = await getJson(`${API}/v1/matches/${m.match_id}/metadata`, 6);
      const mi = meta.match_info;
      const p = (mi.players || []).find((x) => x.account_id === USER);
      if (!p) continue;
      matches.push({
        match_id: m.match_id, start_time: mi.start_time, duration_s: mi.duration_s, hero_id: p.hero_id, team: p.team,
        won: p.team === mi.winning_team, rounds: mi.street_brawl_rounds || [],
        players: (mi.players || []).map((x) => ({ team: x.team, hero_id: x.hero_id })),
        items: (p.items || []).map((it) => ({ item_id: it.item_id, game_time_s: it.game_time_s, sold_time_s: it.sold_time_s })),
      });
      if (matches.length % 5 === 0) await save(file, { account_id: USER, game_mode: BRAWL_GAME_MODE_ID, matches });
    } catch (e) { console.warn(`  skip match ${m.match_id}: ${e.message}`); }
  }
  matches.sort((a, b) => b.start_time - a.start_time);
  await save(file, { account_id: USER, game_mode: BRAWL_GAME_MODE_ID, matches });
  manifest.brawl = { fetched_at: new Date().toISOString(), game_mode: BRAWL_GAME_MODE, heroes: heroes.length, user_matches: matches.length, user_file: file };
}

async function main() {
  if (BRAWL_ONLY) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    MIN_TS = manifest.min_unix_timestamp;
    await fetchBrawl(heroes, manifest);
    await save('manifest.json', manifest);
    return;
  }
  await mkdir(OUT, { recursive: true });
  if (VALIDATION_ONLY) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    await fetchValidation(manifest);
    await save('manifest.json', manifest);
    return;
  }
  if (ANALYTICS_ONLY) {
    const manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'));
    const heroes = JSON.parse(await readFile(path.join(OUT, 'heroes.json'), 'utf8'));
    MIN_TS = manifest.min_unix_timestamp; // keep the same window as the rest of the snapshot
    manifest.analytics_fetched_at = new Date().toISOString();
    await fetchAnalytics(heroes, manifest);
    await save('manifest.json', manifest);
    return;
  }
  const manifest = { fetched_at: new Date().toISOString(), min_unix_timestamp: MIN_TS, window_days: WINDOW_DAYS, counts: {} };

  console.log('1/5 item catalog');
  const items = (await getJson(`${ASSETS}/v2/items/by-type/upgrade`)).map(slimItem);
  console.log(`   downloading ${items.length} item images`);
  for (const it of items) {
    it.remote_shop_image = it.shop_image_webp;
    const local = await saveImage(it.shop_image_webp, 'items', it.id);
    if (local) { it.shop_image_webp = local; it.image_webp = local; }
  }
  await save('items.json', items);
  manifest.counts.items = items.length;
  manifest.counts.shopable_items = items.filter((i) => i.shopable && !i.disabled).length;

  console.log('2/5 heroes');
  const heroesRaw = await getJson(`${ASSETS}/v2/heroes`);
  const active = heroesRaw.filter((h) => h.player_selectable && !h.disabled && !h.in_development);
  const heroes = active.map(slimHero);
  for (const h of heroes) {
    const l = await saveImage(h.images.small, 'heroes', h.id); if (l) h.images.small = l;
    // card art is what the Street Brawl draft screen shows in the top bar; the recogniser matches portraits against it
    const c = await saveImage(h.images.card, 'heroes', h.id, '-card'); if (c) h.images.card = c;
  }
  await save('heroes.json', heroes);
  manifest.counts.heroes = heroes.length;

  console.log('3/5 abilities');
  const abilitiesRaw = await getJson(`${ASSETS}/v2/items/by-type/ability`);
  const activeIds = new Set(active.map((h) => h.id));
  const abilities = abilitiesRaw.filter((a) => activeIds.has(a.hero)).map(slimAbility);
  const sigNames = new Set(heroes.flatMap((h) => h.abilities));
  for (const a of abilities) if (sigNames.has(a.class_name)) { const l = await saveImage(a.image_webp, 'abilities', a.id); if (l) a.image_webp = l; }
  await save('abilities.json', abilities);
  manifest.counts.abilities = abilities.length;

  await fetchAnalytics(heroes, manifest);

  await fetchValidation(manifest);
  await fetchBrawl(heroes, manifest);

  await save('manifest.json', manifest);
  console.log('done', manifest.counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
