// Verifies the acceptance criteria that can be checked without a browser.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generateBuilds } from '../src/generator';
import { computeCoreSet, validateBuild } from '../src/validation/zergggy';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
let fails = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

const items = read('items.json'), heroes = read('heroes.json'), abilities = read('abilities.json'), manifest = read('manifest.json');
check('item catalog has >=200 items', items.length >= 200, `${items.length} items, ${items.filter((i: any) => i.shopable && !i.disabled).length} currently shopable`);
check('analytics snapshot for every active hero', heroes.every((h: any) => existsSync(`public/data/analytics/${h.id}.json`)), `${heroes.length} heroes`);
const z = read('zergggy/purchases.json');
check('>=20 Zergggy Infernus matches with purchases', z.matches.length >= 20 && z.matches.every((m: any) => m.items.length > 0), `${z.matches.length} matches`);
check('Zergggy matches are matchmaking only', z.matches.every((m: any) => [1, 2].includes(m.match_mode) && m.game_mode === 1));

// generator must not reference the Zergggy snapshot
const gen = readdirSync('src/generator').map((f) => readFileSync(`src/generator/${f}`, 'utf8')).join('\n');
check('generator has no Zergggy reference', !/zergggy|35187362/i.test(gen));
check('only validation module reads zergggy snapshot', execSync("grep -rl 'zergggy/' src || true").toString().trim().split('\n').filter(Boolean).every((f) => f.startsWith('src/validation/')), 'files referencing the snapshot path: ' + execSync("grep -rl 'zergggy/' src || true").toString().trim().replace(/\n/g, ', '));

// every hero generates >=2 builds, >=12 items each, 3 phases, running totals, 4 real abilities
const infAbilities = new Set(['Napalm', 'Flame Dash', 'Afterburn', 'Concussive Combustion']);
for (const hero of heroes) {
  const analytics = read(`analytics/${hero.id}.json`);
  let ok = true; const why: string[] = [];
  try {
    const builds = generateBuilds({ hero, abilities, items, analytics });
    if (builds.length < 2) { ok = false; why.push('<2 builds'); }
    for (const b of builds) {
      if (b.items.length < 12) { ok = false; why.push(`${b.name}: ${b.items.length} items`); }
      if (new Set(b.items.map((i) => i.phase)).size !== 3) { ok = false; why.push(`${b.name}: phases`); }
      let run = 0; for (const i of b.items) { run += i.item.cost; if (i.runningTotal !== run || !i.item.shop_image_webp) { ok = false; why.push(`${b.name}: totals/image`); break; } }
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

// validation report
const hero = heroes.find((h: any) => h.id === 1);
const builds = generateBuilds({ hero, abilities, items, analytics: read('analytics/1.json') });
const core = computeCoreSet(z, items);
for (const bld of builds) {
  const v = validateBuild(bld, core);
  check(`${bld.name}: every item has a core badge + agreement %`, bld.items.every((i) => typeof v.badges[i.item.id] === 'boolean') && v.agreement >= 0 && v.agreement <= 1, `${(v.agreement * 100).toFixed(0)}%`);
}
console.log(`\nsnapshot fetched ${manifest.fetched_at}; ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
