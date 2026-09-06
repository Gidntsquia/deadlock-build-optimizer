// CLI: generate builds from the local snapshot and (optionally) validate against the held-out top player for that hero (if any).
// Usage: npm run generate [-- <hero_id>] [--json]
import { readFileSync } from 'node:fs';
import { generateBuilds } from '../src/generator';
import { computeCoreSet, validateBuild } from '../src/validation/heldout';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
const args = process.argv.slice(2);
const heroId = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const asJson = args.includes('--json');

const items = read('items.json'), heroes = read('heroes.json'), abilities = read('abilities.json');
const hero = heroes.find((h: any) => h.id === heroId);
if (!hero) throw new Error(`hero ${heroId} not in snapshot`);
const analytics = read(`analytics/${heroId}.json`);
const builds = generateBuilds({ hero, abilities, items, analytics });

if (asJson) {
  console.log(JSON.stringify(builds.map((b) => ({ key: b.key, items: b.items.map((i) => [i.item.id, i.phase, i.runningTotal]), abilities: b.abilityOrder.map((s) => [s.ability.id, s.kind]) }))));
  process.exit(0);
}
const fmt = (s: number) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
let core = null as ReturnType<typeof computeCoreSet> | null;
const vset = read('manifest.json').validation_sets?.find((v: any) => v.hero_id === heroId);
if (vset) core = computeCoreSet(read(vset.file), items);
console.log(`# ${hero.name} — ${builds.length} builds.`);
const pop = builds[0]?.population;
if (pop) console.log(`population: ${pop.kind === 'top' ? `high-rank lobbies (avg badge >= ${pop.minBadge})` : 'all ranks'}, ${pop.matches.toLocaleString()} matches on the most-bought item; ability sequences from ${pop.abilitySequenceKind === 'top' ? 'high-rank' : 'all-rank'} data`);
for (const b of builds) {
  const v = core ? validateBuild(b, core) : null;
  console.log(`\n## ${b.name}  total ${b.totalCost}${v ? `  | agreement ${(v.agreement * 100).toFixed(0)}% (overlap ${(v.overlap * 100).toFixed(0)}%, order ${(v.order * 100).toFixed(0)}%, ${v.sharedCount}/${core!.core.length} core)` : ''}`);
  for (const i of b.items) console.log(`  ${String(i.order).padStart(2)} ${i.phase.padEnd(5)} ${i.item.name.padEnd(24)} T${i.item.item_tier} ${i.item.item_slot_type.padEnd(8)} ${String(i.paidCost).padStart(5)}${i.upgradesFrom ? '↑' : ' '}Σ${String(i.runningTotal).padStart(6)}  ${fmt(i.avgBuyTimeS)} wr${(i.winRate * 100).toFixed(1)} use${(i.usageRate * 100).toFixed(0)} sc${i.score.toFixed(2)} ${v ? (v.badges[i.item.id] ? 'CORE' : '-') : ''}`);
  console.log('  abilities: ' + b.abilityOrder.map((s) => `${s.ability.name}[${s.kind}]`).join(' > '));
}
if (core) {
  console.log(`\n# ${core.player}'s ${core.hero} core set (${core.matches} matches, ${core.wins} wins):`);
  for (const c of core.core) console.log(`  ${c.item.name.padEnd(24)} ${(c.frequency * 100).toFixed(0)}%  median buy ${fmt(c.medianBuyTimeS)}`);
  console.log(`  experiments (<30%): ${core.experiments.map((c) => `${c.item.name} ${(c.frequency * 100).toFixed(0)}%`).join(', ')}`);
}
