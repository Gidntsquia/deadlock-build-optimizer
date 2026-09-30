import { useEffect, useMemo, useState } from 'react';
import type { Build, Hero, HeroAnalytics, Item } from './types.ts';
import { loadAnalytics, loadHeroes, loadItems, loadManifest, loadUserHistory, BASE } from './data.ts';
import { generateBuilds } from './generator/generate.ts';
import { computeCoreSet, loadZergSnapshot, validateBuild, type CoreSet } from './validation/validate.ts';
import { DEFAULT_BUDGET, userInsight, type UserHistory } from './personalize.ts';
import { HeroPicker } from './components/HeroPicker.tsx';
import { BuildView } from './components/BuildView.tsx';
import { ItemCard } from './components/ItemCard.tsx';

const INFERNUS = 1;

export default function App() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [heroes, setHeroes] = useState<Hero[] | null>(null);
  const [history, setHistory] = useState<UserHistory | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [heroId, setHeroId] = useState(INFERNUS);
  const [analytics, setAnalytics] = useState<HeroAnalytics | null>(null);
  const [core, setCore] = useState<CoreSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personal, setPersonal] = useState(true);
  const [buildId, setBuildId] = useState('gun');
  const [openItem, setOpenItem] = useState<{ item: Item; build: Build } | null>(null);

  useEffect(() => {
    Promise.all([loadItems(), loadHeroes(), loadUserHistory(), loadManifest()])
      .then(([i, h, u, m]) => {
        setItems(i);
        setHeroes(h);
        setHistory(u);
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
  const insight = useMemo(() => userInsight(history, heroId), [history, heroId]);
  const budget = personal && insight ? insight.budget : DEFAULT_BUDGET;

  const builds = useMemo(() => {
    if (!hero || !items || !analytics || analytics.hero_id !== hero.id) return null;
    return generateBuilds(hero, items, analytics, { budget });
  }, [hero, items, analytics, budget]);

  const build = builds?.find((b) => b.id === buildId) ?? builds?.[0] ?? null;
  const validations = useMemo(
    () => (heroId === INFERNUS && core && builds ? new Map(builds.map((b) => [b.id, validateBuild(b, core)])) : null),
    [heroId, core, builds],
  );

  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!items || !heroes) return <main className="page"><p className="muted">Loading snapshots…</p></main>;

  return (
    <main className="page">
      <header className="top">
        <h1>Deadlock Build Optimizer</h1>
        {hero && <HeroPicker heroes={heroes} current={hero} onPick={(id) => { setHeroId(id); setBuildId('gun'); }} />}
        {fetchedAt && <p className="muted small">Data snapshot: {fetchedAt.slice(0, 10)}</p>}
      </header>

      {insight && (
        <section className="insight" aria-label="Personal insight">
          <p>{insight.text}{insight.hero_matches > 0 && ` You have ${insight.hero_matches} ${hero?.name} matches (${Math.round((insight.hero_win_rate ?? 0) * 100)}% wins).`}</p>
          <label className="toggle">
            <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
            <span>Use my match length for the budget</span>
          </label>
        </section>
      )}

      {!builds || !build || !hero ? (
        <p className="muted">Generating builds…</p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Builds">
            {builds.map((b) => (
              <button key={b.id} role="tab" aria-selected={b.id === build.id} className={b.id === build.id ? 'tab on' : 'tab'} onClick={() => setBuildId(b.id)}>
                <span>{b.name}</span>
                {validations?.get(b.id) && <small>{Math.round(validations.get(b.id)!.agreement * 100)}%</small>}
              </button>
            ))}
          </div>
          <BuildView
            build={build} hero={hero} items={items} validation={validations?.get(build.id) ?? null}
            core={heroId === INFERNUS ? core : null} onOpen={(item) => setOpenItem({ item, build })}
          />
        </>
      )}
      {openItem && (
        <ItemCard
          item={openItem.item} build={openItem.build}
          validation={validations?.get(openItem.build.id) ?? null} onClose={() => setOpenItem(null)}
        />
      )}
    </main>
  );
}
