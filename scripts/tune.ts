// Tunes the generator's scoring weights and limits (PARAMS in src/generator/stats.ts) to maximise the
// mean panel agreement across all heroes. Coordinate descent over a fixed grid per parameter; prints
// the baseline, every accepted step, and the final parameter set. Run: npx tsx scripts/tune.ts
// The panel is the only signal, so the resulting numbers are in-sample for that panel.
import { readFileSync } from 'node:fs';
import { generateBuilds } from '../src/generator';
import { PARAMS } from '../src/generator/stats';
import { computeCoreSet, panelAgreementAcrossBuilds } from '../src/validation/heldout';

const read = (p: string) => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));
const items = read('items.json'), heroes = read('heroes.json'), abilities = read('abilities.json'), manifest = read('manifest.json');
const vsets: any[] = manifest.validation_sets ?? [];
const perHero = heroes.map((hero: any) => {
  const sets = vsets.filter((v) => v.hero_id === hero.id);
  return { hero, analytics: read(`analytics/${hero.id}.json`), panel: sets.map((set) => ({ set, core: computeCoreSet(read(set.file), items) })) };
}).filter((h: any) => h.panel.length);

function evaluate(): { mean: number; median: number; min: number; byHero: { hero: string; a: number }[] } {
  const byHero = perHero.map((h: any) => {
    const builds = generateBuilds({ hero: h.hero, abilities, items, analytics: h.analytics });
    const a = panelAgreementAcrossBuilds(builds, h.panel).agreement;
    return { hero: h.hero.name, a };
  });
  const s = byHero.map((x: any) => x.a).sort((x: number, y: number) => x - y);
  return { mean: s.reduce((a: number, b: number) => a + b, 0) / s.length, median: s[Math.floor(s.length / 2)], min: s[0], byHero };
}

type Getter = { name: string; get: () => number; set: (v: number) => void; grid: number[] };
const w = PARAMS.weights;
const dims: Getter[] = [
  { name: 'weights.popularity', get: () => w.popularity, set: (v) => (w.popularity = v), grid: [0.5, 0.75, 1, 1.25, 1.5, 2, 3] },
  { name: 'weights.winLift', get: () => w.winLift, set: (v) => (w.winLift = v), grid: [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3] },
  { name: 'weights.efficiency', get: () => w.efficiency, set: (v) => (w.efficiency = v), grid: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75] },
  { name: 'weights.kit', get: () => w.kit, set: (v) => (w.kit = v), grid: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75] },
  { name: 'weights.synergy', get: () => w.synergy, set: (v) => (w.synergy = v), grid: [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5] },
  { name: 'weights.active', get: () => w.active, set: (v) => (w.active = v), grid: [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] },
  { name: 'winShrinkFrac', get: () => PARAMS.winShrinkFrac, set: (v) => (PARAMS.winShrinkFrac = v), grid: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5] },
  { name: 'minUsage', get: () => PARAMS.minUsage, set: (v) => (PARAMS.minUsage = v), grid: [0.01, 0.02, 0.03, 0.05, 0.08, 0.12] },
  { name: 'maxItems', get: () => PARAMS.maxItems, set: (v) => (PARAMS.maxItems = v), grid: [12, 13, 14, 15, 16] },
  { name: 'minItems', get: () => PARAMS.minItems, set: (v) => (PARAMS.minItems = v), grid: [10, 11, 12, 13, 14, 15, 16] },
  { name: 'maxUpgradeSteps', get: () => PARAMS.maxUpgradeSteps, set: (v) => (PARAMS.maxUpgradeSteps = v), grid: [0, 1, 2, 3, 4, 5, 6] },
  { name: 'slotCap', get: () => PARAMS.slotCap, set: (v) => (PARAMS.slotCap = v), grid: [4, 5, 6, 7, 8] },
  { name: 'maxActives', get: () => PARAMS.maxActives, set: (v) => (PARAMS.maxActives = v), grid: [1, 2, 3, 4, 5] },
  { name: 'tierMin[1]', get: () => PARAMS.tierMin[1], set: (v) => (PARAMS.tierMin[1] = v), grid: [0, 1, 2, 3, 4] },
  { name: 'tierMin[2]', get: () => PARAMS.tierMin[2], set: (v) => (PARAMS.tierMin[2] = v), grid: [0, 1, 2, 3, 4] },
  { name: 'pairMinMatches', get: () => PARAMS.pairMinMatches, set: (v) => (PARAMS.pairMinMatches = v), grid: [5, 10, 20, 50, 100, 200] },
];

const fmt = (e: ReturnType<typeof evaluate>) => `mean ${(e.mean * 100).toFixed(2)}%  median ${(e.median * 100).toFixed(1)}%  min ${(e.min * 100).toFixed(1)}%`;
let best = evaluate();
console.log(`baseline: ${fmt(best)}`);
const valid = () => PARAMS.minItems <= PARAMS.maxItems;
for (let pass = 1; pass <= 6; pass++) {
  let improved = false;
  for (const d of dims) {
    const start = d.get();
    let bestV = start;
    for (const v of d.grid) {
      if (v === start) continue;
      d.set(v);
      if (!valid()) continue;
      const e = evaluate();
      if (e.mean > best.mean + 1e-6) { best = e; bestV = v; }
    }
    d.set(bestV);
    if (bestV !== start) { improved = true; console.log(`pass ${pass}: ${d.name} ${start} -> ${bestV}  ${fmt(best)}`); }
  }
  if (!improved) break;
}
console.log(`\nfinal: ${fmt(best)}`);
console.log(JSON.stringify(PARAMS, null, 2));
console.log(best.byHero.sort((x, y) => x.a - y.a).map((h) => `${h.hero} ${(h.a * 100).toFixed(0)}%`).join(', '));
