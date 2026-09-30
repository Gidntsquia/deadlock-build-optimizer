import { useEffect, useMemo, useState } from 'react';
import type { Build, Hero, HeroAnalytics, Item } from './types.ts';
import { loadAnalytics, loadHeroes, loadItems, loadManifest, BASE } from './data.ts';
import { generateBuild } from './generator/generate.ts';
import { computeCoreSet, loadZergSnapshot, validateBuild, type CoreSet } from './validation/validate.ts';
import { DEFAULT_BUDGET } from './personalize.ts';
import { HeroPicker } from './components/HeroPicker.tsx';
import { BuildView } from './components/BuildView.tsx';
import { ItemCard } from './components/ItemCard.tsx';

const INFERNUS = 1;

export default function App() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [heroes, setHeroes] = useState<Hero[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [heroId, setHeroId] = useState(INFERNUS);
  const [analytics, setAnalytics] = useState<HeroAnalytics | null>(null);
  const [core, setCore] = useState<CoreSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<{ item: Item; build: Build } | null>(null);

  useEffect(() => {
    Promise.all([loadItems(), loadHeroes(), loadManifest()])
      .then(([i, h, m]) => {
        setItems(i);
        setHeroes(h);
        setFetchedAt(m?.fetched_at ?? null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    setAnalytics(null);
    loadAnalytics(heroId).then(setAnalytics).catch((e) => setError(String(e.message ?? e)));
  }, [heroId]);

  // Validation data is loaded separately and only used after builds exist.
  useEffect(() => {
    if (!items) return;
    loadZergSnapshot(BASE)
      .then((s) => setCore(computeCoreSet(s, new Set(items.map((i) => i.id)))))
      .catch(() => setCore(null));
  }, [items]);

  const hero = heroes?.find((h) => h.id === heroId) ?? null;
  const budget = DEFAULT_BUDGET;

  const build = useMemo(() => {
    if (!hero || !items || !analytics || analytics.hero_id !== hero.id) return null;
    return generateBuild(hero, items, analytics, { budget });
  }, [hero, items, analytics, budget]);

  const validation = useMemo(
    () => (heroId === INFERNUS && core && build ? validateBuild(build, core) : null),
    [heroId, core, build],
  );

  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!items || !heroes) return <main className="page"><p className="muted">Loading snapshots…</p></main>;

  return (
    <main className="page">
      <header className="top">
        <h1>Deadlock Build Optimizer</h1>
        {hero && <HeroPicker heroes={heroes} current={hero} onPick={(id) => { setHeroId(id); }} />}
        {fetchedAt && <p className="muted small">Data snapshot: {fetchedAt.slice(0, 10)}</p>}
      </header>

      {!build || !hero ? (
        <p className="muted">Generating build…</p>
      ) : (
        <BuildView
          build={build} hero={hero} items={items} validation={validation}
          core={heroId === INFERNUS ? core : null} onOpen={(item) => setOpenItem({ item, build })}
        />
      )}
      {openItem && (
        <ItemCard
          item={openItem.item} build={openItem.build}
          validation={validation} onClose={() => setOpenItem(null)}
        />
      )}
    </main>
  );
}
