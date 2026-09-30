// Downloads every snapshot the app needs into public/data and public/img.
// Usage: npm run fetch-data   (env: SKIP_IMAGES=1 to skip image downloads)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const IMG = path.join(ROOT, 'public', 'img');

const API = 'https://api.deadlock-api.com';
const ASSETS = 'https://assets.deadlock-api.com';
const ZERGGGY = 35187362;
const USER = 267836488;
const MIN_BADGE = 70; // Phantom+ average badge
const MIN_SLICE_MATCHES = 4000;
const SLEEP_MS = 350; // analytics limit is 200 req/min per IP; this stays under ~170/min
const ZERG_MATCHES = 30;
const REAL_MATCH_MODES = new Set([1, 4]); // 1 = Unranked, 4 = Ranked (2 private lobby, 3 bots, 7 hero labs excluded)
const REAL_GAME_MODES = new Set([1]); // 1 = Normal (4 = Street Brawl excluded)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function getJson(url, { retries = 5, timeout = 90000 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') || 5) * 1000 + i * 2000;
        log(`  429, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries || /HTTP 4(?!29)/.test(String(e))) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * (i + 1));
    }
  }
}

// The assets host is the documented source; the API host serves the same data under /v1/assets
// and is used when the assets host is unreachable.
let assetsSource = null;
async function getAsset(v2Path, v1Path) {
  if (assetsSource !== 'api') {
    try {
      const d = await getJson(`${ASSETS}${v2Path}`, { retries: 1, timeout: 30000 });
      assetsSource = 'assets';
      return d;
    } catch (e) {
      if (assetsSource === null) log(`assets host unavailable (${e.message}); using ${API}/v1/assets`);
      assetsSource = 'api';
    }
  }
  return getJson(`${API}${v1Path}`);
}

async function writeJson(rel, obj) {
  const file = path.join(DATA, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj));
  log(`wrote ${rel} (${(JSON.stringify(obj).length / 1024).toFixed(0)} KB)`);
}

async function download(url, rel) {
  if (!url || process.env.SKIP_IMAGES) return null;
  const file = path.join(IMG, rel);
  try {
    const st = await fs.stat(file);
    if (st.size > 0) return `img/${rel}`;
  } catch {}
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
      return `img/${rel}`;
    } catch (e) {
      if (i === 2) {
        log(`  image failed ${url}: ${e.message}`);
        return null;
      }
      await sleep(500);
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    }),
  );
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const manifest = { fetched_at: new Date().toISOString() };

  // ---- item catalog ----
  log('Item catalog…');
  const upgrades = await getAsset('/v2/items/by-type/upgrade', '/v1/assets/items/by-type/upgrade');
  const shopable = upgrades.filter((i) => i.shopable && i.cost > 0 && i.item_tier != null && !i.disabled);
  log(`  ${upgrades.length} upgrade items, ${shopable.length} shopable`);
  await pool(shopable, 8, async (it) => {
    const local = await download(it.shop_image_webp || it.image_webp, `items/${it.id}.webp`);
    it.image_local = local;
  });
  const catalog = shopable.map((i) => ({
    id: i.id, class_name: i.class_name, name: i.name, cost: i.cost, item_tier: i.item_tier,
    item_slot_type: i.item_slot_type, is_active_item: !!i.is_active_item, activation: i.activation ?? null,
    heroes: i.heroes ?? [], description: i.description ?? null, properties: i.properties,
    tooltip_sections: i.tooltip_sections ?? [], upgrades: i.upgrades ?? [], image: i.image_local,
    image_url: i.shop_image_webp || i.image_webp,
  }));
  await writeJson('items.json', catalog);
  manifest.items = catalog.length;

  // ---- heroes + abilities ----
  log('Heroes…');
  const heroesAll = await getAsset('/v2/heroes', '/v1/assets/heroes');
  const active = heroesAll.filter((h) => h.player_selectable && !h.disabled && !h.in_development);
  const abilityList = await getAsset('/v2/items/by-type/ability', '/v1/assets/items/by-type/ability');
  const byClass = new Map(abilityList.map((a) => [a.class_name, a]));
  const heroes = [];
  for (const h of active) {
    const sigs = ['signature1', 'signature2', 'signature3', 'signature4'].map((k) => byClass.get(h.items[k]));
    if (sigs.some((s) => !s)) {
      log(`  skip ${h.name}: missing ability data`);
      continue;
    }
    const abilities = [];
    for (const a of sigs) {
      abilities.push({
        id: a.id, class_name: a.class_name, name: a.name, description: a.description ?? null,
        properties: a.properties, upgrades: a.upgrades ?? [], ability_type: a.ability_type ?? null,
        image: await download(a.image_webp || a.image, `abilities/${a.id}.webp`),
      });
    }
    let weapon = null;
    try {
      const w = await getAsset(`/v2/items/${h.items.weapon_primary}`, `/v1/assets/items/${h.items.weapon_primary}`);
      weapon = w.weapon_info ?? null;
    } catch (e) {
      log(`  weapon lookup failed for ${h.name}: ${e.message}`);
    }
    const card = await download(h.images?.icon_hero_card_webp || h.images?.icon_image_small_webp, `heroes/${h.id}.webp`);
    heroes.push({
      id: h.id, name: h.name, class_name: h.class_name, tags: h.tags ?? [], gun_tag: h.gun_tag ?? null,
      description: h.description ?? null, image: card, starting_stats: h.starting_stats,
      standard_level_up_upgrades: h.standard_level_up_upgrades, scaling_stats: h.scaling_stats ?? null,
      weapon, abilities,
    });
    await sleep(120);
  }
  await writeJson('heroes.json', heroes);
  manifest.heroes = heroes.length;
  manifest.assets_source = assetsSource === 'api' ? `${API}/v1/assets` : `${ASSETS}/v2`;

  // ---- per-hero analytics ----
  log('Analytics…');
  for (const h of heroes) {
    // Top-player slice: only matches whose average rank badge >= MIN_BADGE. Falls back to all ranks for thin heroes.
    let q = `hero_id=${h.id}&min_average_badge=${MIN_BADGE}`;
    let itemStats = await getJson(`${API}/v1/analytics/item-stats?${q}`);
    await sleep(SLEEP_MS);
    let abilityOrder = await getJson(`${API}/v1/analytics/ability-order-stats?${q}`);
    await sleep(SLEEP_MS);
    let slice = `badge>=${MIN_BADGE}`;
    if (abilityOrder.reduce((t, r) => t + r.matches, 0) < MIN_SLICE_MATCHES) {
      q = `hero_id=${h.id}`;
      itemStats = await getJson(`${API}/v1/analytics/item-stats?${q}`);
      await sleep(SLEEP_MS);
      abilityOrder = await getJson(`${API}/v1/analytics/ability-order-stats?${q}`);
      await sleep(SLEEP_MS);
      slice = 'all ranks';
      log(`  ${h.name}: too few top-rank matches, using all ranks`);
    }
    let perms = [];
    try {
      perms = await getJson(`${API}/v1/analytics/item-permutation-stats?${q}&comb_size=2&min_matches=100`);
    } catch (e) {
      log(`  permutation stats failed for ${h.name}: ${e.message}`);
    }
    await sleep(SLEEP_MS);
    // totals over ALL sequences (the snapshot keeps only the top 300) → hero baseline win rate
    const heroMatches = abilityOrder.reduce((t, r) => t + r.matches, 0);
    const heroWins = abilityOrder.reduce((t, r) => t + r.wins, 0);
    abilityOrder.sort((a, b) => b.matches - a.matches);
    perms.sort((a, b) => b.matches - a.matches);
    await writeJson(`analytics/${h.id}.json`, {
      hero_id: h.id, slice, hero_matches: heroMatches, hero_wins: heroWins,
      item_stats: itemStats.filter((r) => r.matches > 0).map((r) => ({
        item_id: r.item_id, wins: r.wins, losses: r.losses, matches: r.matches, players: r.players,
        avg_buy_time_s: r.avg_buy_time_s, avg_sell_time_s: r.avg_sell_time_s,
      })),
      ability_order_stats: abilityOrder.slice(0, 300).map((r) => ({
        abilities: r.abilities, wins: r.wins, losses: r.losses, matches: r.matches,
      })),
      permutation_stats: perms.slice(0, 1500).map((r) => ({ item_ids: r.item_ids, wins: r.wins, losses: r.losses, matches: r.matches })),
    });
  }

  // ---- Zergggy (validation only) ----
  log('Zergggy Infernus matches (validation only)…');
  const hist = await getJson(`${API}/v1/players/${ZERGGGY}/match-history`);
  const inf = hist.filter((m) => m.hero_id === 1);
  const real = inf
    .filter((m) => REAL_MATCH_MODES.has(m.match_mode) && REAL_GAME_MODES.has(m.game_mode))
    .sort((a, b) => b.start_time - a.start_time);
  const slimMatch = (m) => ({
    match_id: m.match_id, start_time: m.start_time, match_mode: m.match_mode, game_mode: m.game_mode,
    duration_s: m.match_duration_s, won: m.match_result === m.player_team, kills: m.player_kills,
    deaths: m.player_deaths, assists: m.player_assists, net_worth: m.net_worth,
  });
  const purchases = [];
  for (const m of real) {
    if (purchases.length >= ZERG_MATCHES) break;
    try {
      const meta = await getJson(`${API}/v1/matches/${m.match_id}/metadata`);
      const p = meta.match_info.players.find((x) => x.account_id === ZERGGGY);
      if (!p) continue;
      purchases.push({
        ...slimMatch(m),
        items: p.items.map((it) => ({ item_id: it.item_id, t: it.game_time_s, sold: it.sold_time_s })),
      });
    } catch (e) {
      log(`  skip match ${m.match_id}: ${e.message}`);
    }
    await sleep(SLEEP_MS * 2);
  }
  await writeJson('validation/zergggy-infernus-matches.json', {
    account_id: ZERGGGY, total_history: hist.length, infernus_total: inf.length, real_matchmaking: real.length,
    matches: real.slice(0, purchases.length + 5).map(slimMatch),
  });
  await writeJson('validation/zergggy-infernus-purchases.json', { account_id: ZERGGGY, matches: purchases });
  manifest.zergggy_matches = purchases.length;

  // ---- user history (personalisation) ----
  log('User history…');
  const uh = await getJson(`${API}/v1/players/${USER}/match-history`);
  const std = uh.filter((m) => REAL_MATCH_MODES.has(m.match_mode) && REAL_GAME_MODES.has(m.game_mode) && m.match_duration_s > 300);
  await writeJson('user-history.json', {
    account_id: USER, total: uh.length,
    matches: std.map((m) => ({
      match_id: m.match_id, hero_id: m.hero_id, start_time: m.start_time, duration_s: m.match_duration_s,
      net_worth: m.net_worth, won: m.match_result === m.player_team,
    })),
  });

  await writeJson('manifest.json', manifest);
  log('Done.', manifest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
