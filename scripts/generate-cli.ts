// CLI: generate builds from the local snapshot and (optionally) validate against the held-out panel of top players for that hero (if any).
// Usage: npm run generate [-- <hero_id>] [--json]
import { readFileSync } from 'node:fs';
import { generateBuilds } from '../src/generator';
import { computeCoreSet, consensusThreshold, validateAgainstPanel } from '../src/validation/heldout';

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
const vsets: any[] = (read('manifest.json').validation_sets ?? []).filter((v: any) => v.hero_id === heroId);
const panel = vsets.map((set) => ({ set, core: computeCoreSet(read(set.file), items) }));
const need = consensusThreshold(panel.length);
console.log(`# ${hero.name} — ${builds.length} builds.`);
const pop = builds[0]?.population;
if (pop) console.log(`population: ${pop.kind === 'top' ? `high-rank lobbies (avg badge >= ${pop.minBadge})` : 'all ranks'}, ${pop.matches.toLocaleString()} matches on the most-bought item; ability sequences from ${pop.abilitySequenceKind === 'top' ? 'high-rank' : 'all-rank'} data`);
for (const b of builds) {
  const v = panel.length ? validateAgainstPanel(b, panel) : null;
  console.log(`\n## ${b.name}  total ${b.totalCost}${v ? `  | panel agreement ${(v.agreement * 100).toFixed(0)}% over ${v.players.length} player(s)` : ''}`);
  for (const i of b.items) console.log(`  ${String(i.order).padStart(2)} ${i.phase.padEnd(5)} ${i.item.name.padEnd(24)} T${i.item.item_tier} ${i.item.item_slot_type.padEnd(8)} ${String(i.paidCost).padStart(5)}${i.upgradesFrom ? '↑' : ' '}Σ${String(i.runningTotal).padStart(6)}  ${fmt(i.avgBuyTimeS)} wr${(i.winRate * 100).toFixed(1)} use${(i.usageRate * 100).toFixed(0)} sc${i.score.toFixed(2)} ${v ? ((v.consensusBadges[i.item.id] ?? 0) >= need ? `CORE ${v.consensusBadges[i.item.id]}/${v.players.length}` : `-    ${v.consensusBadges[i.item.id] ?? 0}/${v.players.length}`) : ''}`);
  console.log('  abilities: ' + b.abilityOrder.map((s) => `${s.ability.name}[${s.kind}]`).join(' > '));
  if (v) {
    console.log('  panel:  player            games(W)  lifetime  agree  core');
    for (const p of v.players) console.log(`          ${p.set.player.padEnd(16)} ${`${p.core.matches}(${p.core.wins})`.padStart(8)}  ${String(p.set.selection?.total_hero_matches ?? '-').padStart(8)}  ${`${(p.validation.agreement * 100).toFixed(0)}%`.padStart(5)}  ${p.validation.sharedCount}/${p.core.core.length}`);
    if (v.missingConsensus.length) console.log(`  missing consensus (core for >=${need}/${v.players.length}): ${v.missingConsensus.map((m) => `${m.item.name} ${m.reps}/${v.players.length} (${(m.frequency * 100).toFixed(0)}%)`).join(', ')}`);
  }
}
for (const { set, core } of panel) {
  console.log(`\n# ${core.player}'s ${core.hero} core set (${core.matches} matches, ${core.wins} wins${set.selection ? `; rank ${set.selection.rank}, ${set.selection.total_hero_matches} lifetime games, score ${set.selection.score.toFixed(2)}` : ''}):`);
  for (const c of core.core) console.log(`  ${c.item.name.padEnd(24)} ${(c.frequency * 100).toFixed(0)}%  median buy ${fmt(c.medianBuyTimeS)}`);
  console.log(`  experiments (<30%): ${core.experiments.map((c) => `${c.item.name} ${(c.frequency * 100).toFixed(0)}%`).join(', ')}`);
}
