// Headless sanity check: generator on every hero + Infernus validation + determinism. Run: npm test
import fs from 'node:fs';
import { generateBuilds } from '../src/generator/generate.ts';
import { computeCoreSet, validateBuild } from '../src/validation/validate.ts';
import { userInsight, DEFAULT_BUDGET } from '../src/personalize.ts';
const rd = (p) => JSON.parse(fs.readFileSync(new URL('../public/data/' + p, import.meta.url)));
const items = rd('items.json'), heroes = rd('heroes.json');
const ins = userInsight(rd('user-history.json'), 1);
console.log(ins?.text, 'budget', ins?.budget);
const budget = ins?.budget ?? DEFAULT_BUDGET;
const name = (id) => items.find((i) => i.id === id)?.name;
let bad = 0;
for (const h of heroes) {
  const a = rd(`analytics/${h.id}.json`);
  const b1 = generateBuilds(h, items, a, { budget }), b2 = generateBuilds(h, items, a, { budget });
  if (JSON.stringify(b1) !== JSON.stringify(b2)) { console.log('NONDETERMINISTIC', h.name); bad++; }
  for (const b of b1) if (b.items.length < 12 || b.ability_steps.length < 12 || new Set(b.ability_steps.map(s => s.ability_name)).size !== 4) { console.log('BAD', h.name, b.id, b.items.length, b.ability_steps.length); bad++; }
}
console.log('heroes', heroes.length, 'problems', bad);
const inf = heroes.find((h) => h.id === 1);
const builds = generateBuilds(inf, items, rd('analytics/1.json'), { budget });
const core = computeCoreSet(rd('validation/zergggy-infernus-purchases.json'), new Set(items.map((i) => i.id)));
console.log('core:', core.coreIds.map(name).join(', '));
for (const b of builds) {
  const v = validateBuild(b, core);
  console.log(`\n${b.name} cost=${b.total_cost} agreement=${(v.agreement * 100).toFixed(0)}% overlap=${(v.overlap*100).toFixed(0)} order=${(v.order*100).toFixed(0)}`);
  for (const i of b.items) console.log(' ', i.phase.padEnd(5), String(i.running_total).padStart(6), name(i.item_id), v.per_item.get(i.item_id).core ? '[CORE]' : '');
  console.log('  abilities:', b.ability_steps.map((s) => s.ability_name[0] + s.rank).join(' '), b.unlock_order.join('>'));
}
process.exit(bad ? 1 : 0);
