// Verifies the acceptance criteria that can be checked without a browser.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generateBuilds } from '../src/generator';
import { computeCoreSet, validateBuild } from '../src/validation/heldout';
import { adviseDraft, baseScores } from '../src/brawl';
import { validateBrawlPicks } from '../src/validation/brawl';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
let fails = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

const items = read('items.json'), heroes = read('heroes.json'), abilities = read('abilities.json'), manifest = read('manifest.json');
check('item catalog has >=200 items', items.length >= 200, `${items.length} items, ${items.filter((i: any) => i.shopable && !i.disabled).length} currently shopable`);
check('analytics snapshot for every active hero', heroes.every((h: any) => existsSync(`public/data/analytics/${h.id}.json`)), `${heroes.length} heroes`);
const vsets: any[] = manifest.validation_sets ?? [];
check('held-out sets: Zergggy/Infernus, Deathy/Lash, Zergggy/Mina', ['35187362-1', '87624911-31', '35187362-63'].every((k) => vsets.some((v) => `${v.account_id}-${v.hero_id}` === k)), vsets.map((v) => `${v.player}/${v.hero}`).join(', '));
for (const v of vsets) {
  const z = read(v.file);
  check(`>=20 ${v.player} ${v.hero} matches with purchases`, z.matches.length >= 20 && z.matches.every((m: any) => m.items.length > 0), `${z.matches.length} matches`);
  check(`${v.player} ${v.hero} matches are matchmaking only`, z.matches.every((m: any) => [1, 2].includes(m.match_mode) && m.game_mode === 1 && z.hero_id === v.hero_id));
}

// generator must not reference any held-out player or snapshot
const gen = readdirSync('src/generator').map((f) => readFileSync(`src/generator/${f}`, 'utf8')).join('\n');
check('generator has no held-out player reference', !/zergggy|deathy|35187362|87624911|validation\//i.test(gen));
const readers = execSync("grep -rlE 'HeldoutPurchases>\\(|validation/[0-9]' src || true").toString().trim().split('\n').filter(Boolean);
check('only validation module reads held-out snapshots', readers.every((f) => f.startsWith('src/validation/')), 'files fetching the snapshot: ' + readers.join(', '));

// every hero generates a build, >=12 items each, 3 phases, running totals, 4 real abilities
const infAbilities = new Set(['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion']);
for (const hero of heroes) {
  const analytics = read(`analytics/${hero.id}.json`);
  let ok = true; const why: string[] = [];
  try {
    const builds = generateBuilds({ hero, abilities, items, analytics });
    if (builds.length < 1) { ok = false; why.push('no build'); }
    for (const b of builds) {
      if (b.items.length < 12) { ok = false; why.push(`${b.name}: ${b.items.length} items`); }
      if (new Set(b.items.map((i) => i.phase)).size !== 3) { ok = false; why.push(`${b.name}: phases`); }
      let run = 0; for (const i of b.items) { run += i.paidCost; if (i.runningTotal !== run || !i.item.shop_image_webp) { ok = false; why.push(`${b.name}: totals/image`); break; } }
      const names = new Set(b.abilityOrder.map((s) => s.ability.name));
      if (names.size !== 4 || b.abilityOrder.filter((s) => s.kind === 'unlock').length !== 4) { ok = false; why.push(`${b.name}: abilities ${[...names]}`); }
      if (hero.id === 1 && ![...names].every((n) => infAbilities.has(n))) { ok = false; why.push('infernus names'); }
    }
  } catch (e) { ok = false; why.push(String(e)); }
  check(`hero ${hero.id} ${hero.name} generates`, ok, why.join('; '));
}

// determinism
const a = execSync('npx tsx scripts/generate-cli.ts 1 --json').toString(), b = execSync('npx tsx scripts/generate-cli.ts 1 --json').toString();
check('rerun yields identical Infernus builds', a === b);

// validation report for every held-out set
for (const v of vsets) {
  const hero = heroes.find((h: any) => h.id === v.hero_id);
  const builds = generateBuilds({ hero, abilities, items, analytics: read(`analytics/${v.hero_id}.json`) });
  const core = computeCoreSet(read(v.file), items);
  for (const bld of builds) {
    const val = validateBuild(bld, core);
    check(`${v.player}/${v.hero}: every item has a core badge + agreement %`, bld.items.every((i) => typeof val.badges[i.item.id] === 'boolean') && val.agreement >= 0 && val.agreement <= 1, `${(val.agreement * 100).toFixed(0)}% (${val.sharedCount}/${core.core.length} core)`);
  }
}
// Street Brawl engine (only when the brawl snapshot exists)
if (existsSync('public/data/brawl-config.json') && existsSync('public/data/analytics/brawl/1.json')) {
  const config = read('brawl-config.json');
  check('brawl config has 5 rounds of draft tiers and budgets', config.item_draft_rounds_per_game_round?.length === 5 && config.gold_per_round?.length === 5);
  const brawlHeroes = heroes.filter((h: any) => existsSync(`public/data/analytics/brawl/${h.id}.json`));
  check('brawl analytics for every active hero', brawlHeroes.length === heroes.length, `${brawlHeroes.length}/${heroes.length}`);
  const legendaries = items.filter((i: any) => i.item_tier === 5);
  check('catalog keeps the tier-5 legendaries', legendaries.length >= 20, `${legendaries.length} (${legendaries.filter((i: any) => !i.disabled).length} enabled)`);
  const brawlSrc = readdirSync('src/brawl').map((f) => readFileSync(`src/brawl/${f}`, 'utf8')).join('\n');
  check('brawl engine reads no validation data', !/validation\/|brawl-\d/.test(brawlSrc));
  let ok = true; const why: string[] = [];
  for (const hero of brawlHeroes) {
    try {
      const input = { hero, abilities, items, analytics: read(`analytics/brawl/${hero.id}.json`), config };
      const bases = baseScores(input, [31]);
      const withData = [...bases.values()].filter((b) => b.stat);
      if (withData.length < 100) { ok = false; why.push(`${hero.name}: ${withData.length} items with data`); }
      const cards = withData.sort((a, b) => b.base - a.base).slice(0, 9).map((b) => ({ itemId: b.item.id }));
      const adv = adviseDraft(input, { round: 3, owned: [cards[8].itemId], enemies: [31, 6], sets: [cards.slice(0, 3), cards.slice(3, 6), cards.slice(6, 9)] });
      if (adv.picks.length !== 3 || adv.sets.some((s) => s.length !== 3) || adv.sets.flat().some((r) => !Number.isFinite(r.score))) { ok = false; why.push(`${hero.name}: advice shape`); }
    } catch (e) { ok = false; why.push(`${hero.name}: ${e}`); }
  }
  check('brawl engine advises every hero (>=100 items with data, 3 picks, finite scores)', ok, why.slice(0, 3).join('; '));
  const a1 = execSync('npx tsx scripts/brawl-cli.ts --hero 1 --round 2 --owned "Extra Charge" --set "Improved Spirit,Healbane,Swift Striker" --set "Superior Duration,Toxic Bullets,Warp Stone+" --json').toString();
  const a2 = execSync('npx tsx scripts/brawl-cli.ts --hero 1 --round 2 --owned "Extra Charge" --set "Improved Spirit,Healbane,Swift Striker" --set "Superior Duration,Toxic Bullets,Warp Stone+" --json').toString();
  check('rerun yields identical brawl advice', a1 === a2);
  if (existsSync('scripts/fixtures/brawl-cards/labels.json') && existsSync('public/data/brawl-icons.json')) {
    let out = '';
    try { out = execSync('npx tsx scripts/brawl-recognise.ts --fixtures', { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e: any) { out = e.stdout?.toString() ?? ''; }
    const m = out.match(/(\d+)\/(\d+) cards/);
    check('brawl recogniser reads >= 95 % of fixture cards (item, tier, rare, enhanced)', !!m && Number(m[1]) / Number(m[2]) >= 0.95, m ? m[0] : out.slice(-200));
  }
  if (existsSync('scripts/fixtures/brawl-screens/labels.json') && existsSync('public/data/brawl-icons.json')) {
    let out = '';
    try { out = execSync('npx tsx scripts/brawl-recognise.ts --screens', { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e: any) { out = e.stdout?.toString() ?? ''; }
    const m = out.match(/(\d+)\/(\d+) labels/);
    check('brawl recogniser reads >= 95 % of screen labels (round, choice, own hero, eight portraits)', !!m && Number(m[1]) / Number(m[2]) >= 0.95, m ? m[0] : out.slice(-200));
  }
  const userFile = manifest.brawl?.user_file;
  if (userFile && existsSync(`public/data/${userFile}`)) {
    const data = read(userFile);
    let n = 0, sum = 0, popSum = 0;
    for (const id of new Set<number>(data.matches.map((m: any) => m.hero_id))) {
      const hero = heroes.find((h: any) => h.id === id); if (!hero || !existsSync(`public/data/analytics/brawl/${id}.json`)) continue;
      const v = validateBrawlPicks({ hero, abilities, items, analytics: read(`analytics/brawl/${id}.json`), config }, data);
      n += v.picks.length; sum += v.meanPercentile * v.picks.length; popSum += v.meanPopPercentile * v.picks.length;
    }
    check('brawl held-out: user picks rank above the tier median by engine score', n > 0 && sum / n > 0.5, `${n} picks, engine ${(sum / n * 100).toFixed(0)}%, popularity-only ${(popSum / n * 100).toFixed(0)}% (random = 50%)`);
  }
}

console.log(`\nsnapshot fetched ${manifest.fetched_at}; ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
