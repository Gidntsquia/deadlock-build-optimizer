// Data pipeline: snapshots every remote input the app needs into public/data/.
// After one successful run the app and the generator work fully offline.
//
// Outputs
//   public/data/items.json                 item catalog (all upgrade items)
//   public/data/heroes.json                active heroes with base stats + growth
//   public/data/abilities.json             abilities of active heroes (names, upgrades)
//   public/data/analytics/<hero_id>.json   item-stats, ability-order-stats, item-permutation-stats
//   public/data/user/history.json          the user's standard-mode match summary (personalization)
//   public/data/zergggy/matches.json       Zergggy's Infernus match list        (VALIDATION ONLY)
//   public/data/zergggy/purchases.json     per-match item purchases (~30 matches) (VALIDATION ONLY)
//   public/data/img/{items,heroes,abilities}/  webp images so the app needs no network at all
//   public/data/manifest.json              timestamps + counts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.deadlock-api.com';
const ASSETS = 'https://assets.deadlock-api.com';
const OUT = path.resolve('public/data');
const ZERGGGY = 35187362;
const USER = 267836488;
const INFERNUS = 1;
const ZERGGGY_MATCH_TARGET = 30;
// Analytics window: last 30 days (live data; the window is recorded in manifest.json).
const WINDOW_DAYS = 30;
// High-rank population: average lobby badge >= 90 (Phantom and above). Chosen as the highest bracket
// where all three analytics endpoints are still well populated for every hero (Ascendant+ leaves
// ability-order sequences with <100 matches). Builds are generated from this population when it is
// large enough, so they follow what top-rank players actually buy rather than the all-rank average.
const TOP_BADGE = 90;
// `--analytics-only` refreshes only public/data/analytics/* from the existing heroes.json.
const ANALYTICS_ONLY = process.argv.includes('--analytics-only');
let MIN_TS = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
// Rate limit is 200 req / 60 s -> ~350 ms between requests keeps us well under.
const SLEEP_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after') || 0) * 1000 || 2000 * (i + 1);
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
async function saveImage(url, dir, id) {
  if (!url) return undefined;
  const rel = `img/${dir}/${id}.webp`;
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
  console.log(`4/6 per-hero analytics (${heroes.length} heroes, all ranks + badge>=${TOP_BADGE})`);
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

async function main() {
  await mkdir(OUT, { recursive: true });
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

  console.log('1/6 item catalog');
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

  console.log('2/6 heroes');
  const heroesRaw = await getJson(`${ASSETS}/v2/heroes`);
  const active = heroesRaw.filter((h) => h.player_selectable && !h.disabled && !h.in_development);
  const heroes = active.map(slimHero);
  for (const h of heroes) { const l = await saveImage(h.images.small, 'heroes', h.id); if (l) h.images.small = l; }
  await save('heroes.json', heroes);
  manifest.counts.heroes = heroes.length;

  console.log('3/6 abilities');
  const abilitiesRaw = await getJson(`${ASSETS}/v2/items/by-type/ability`);
  const activeIds = new Set(active.map((h) => h.id));
  const abilities = abilitiesRaw.filter((a) => activeIds.has(a.hero)).map(slimAbility);
  const sigNames = new Set(heroes.flatMap((h) => h.abilities));
  for (const a of abilities) if (sigNames.has(a.class_name)) { const l = await saveImage(a.image_webp, 'abilities', a.id); if (l) a.image_webp = l; }
  await save('abilities.json', abilities);
  manifest.counts.abilities = abilities.length;

  await fetchAnalytics(heroes, manifest);

  console.log('5/6 user history (personalization)');
  const userHist = await getJson(`${API}/v1/players/${USER}/match-history`);
  // Standard mode = Unranked(1)/Ranked(2) matchmaking in the normal game mode(1).
  const std = userHist.filter((m) => (m.match_mode === 1 || m.match_mode === 2) && m.game_mode === 1);
  await save('user/history.json', {
    account_id: USER,
    matches: std.map((m) => ({ match_id: m.match_id, hero_id: m.hero_id, start_time: m.start_time, match_duration_s: m.match_duration_s, match_result: m.match_result, player_team: m.player_team, net_worth: m.net_worth })),
  });
  manifest.counts.user_matches = std.length;

  console.log('6/6 Zergggy Infernus matches (validation only)');
  const zHist = await getJson(`${API}/v1/players/${ZERGGGY}/match-history`);
  const zInf = zHist.filter((m) => m.hero_id === INFERNUS);
  const zReal = zInf.filter((m) => (m.match_mode === 1 || m.match_mode === 2) && m.game_mode === 1)
    .sort((a, b) => b.start_time - a.start_time);
  await save('zergggy/matches.json', { account_id: ZERGGGY, hero_id: INFERNUS, total_infernus_matches: zInf.length, matches: zReal });
  const purchases = [];
  for (const m of zReal) {
    if (purchases.length >= ZERGGGY_MATCH_TARGET) break;
    try {
      const meta = await getJson(`${API}/v1/matches/${m.match_id}/metadata`);
      const mi = meta.match_info;
      const p = (mi.players || []).find((x) => x.account_id === ZERGGGY);
      if (!p) continue;
      purchases.push({
        match_id: m.match_id, start_time: mi.start_time, duration_s: mi.duration_s,
        match_mode: mi.match_mode, game_mode: mi.game_mode,
        won: p.team === mi.winning_team, net_worth: p.net_worth,
        items: (p.items || []).map((it) => ({ item_id: it.item_id, game_time_s: it.game_time_s, sold_time_s: it.sold_time_s })),
      });
    } catch (e) {
      console.warn(`  skip match ${m.match_id}: ${e.message}`);
    }
  }
  await save('zergggy/purchases.json', { account_id: ZERGGGY, hero_id: INFERNUS, matches: purchases });
  manifest.counts.zergggy_matches_with_purchases = purchases.length;

  await save('manifest.json', manifest);
  console.log('done', manifest.counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
