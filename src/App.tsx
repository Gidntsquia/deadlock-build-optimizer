import { useEffect, useMemo, useState } from 'react';
import type { Ability, Build, Hero, HeroAnalytics, Item } from './types';
import { img, loadAnalytics, loadCore, loadUser, type Manifest } from './data/load';
import { generateBuilds } from './generator';
import { computeCoreSet, loadZergggy, validateBuild, type CoreSet, type ZergggyPurchases } from './validation/zergggy';
import { personalInsight, type UserHistory } from './personal';
import { BuildView } from './components/BuildView';

const INFERNUS = 1;

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [zergggy, setZergggy] = useState<ZergggyPurchases | null>(null);
  const [user, setUser] = useState<UserHistory | null>(null);
  const [heroId, setHeroId] = useState(INFERNUS);
  const [analytics, setAnalytics] = useState<HeroAnalytics | null>(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCore().then(([i, h, a, m]) => { setItems(i); setHeroes(h); setAbilities(a); setManifest(m); }).catch((e) => setError(String(e)));
    loadZergggy().then(setZergggy).catch(() => setZergggy(null));
    loadUser().then(setUser).catch(() => setUser(null));
  }, []);
  useEffect(() => { setAnalytics(null); loadAnalytics(heroId).then(setAnalytics).catch((e) => setError(String(e))); }, [heroId]);

  const hero = heroes.find((h) => h.id === heroId);
  const builds: Build[] = useMemo(() => (hero && analytics && items.length ? generateBuilds({ hero, abilities, items, analytics }) : []), [hero, abilities, items, analytics]);
  const core: CoreSet | null = useMemo(() => (zergggy && items.length ? computeCoreSet(zergggy, items) : null), [zergggy, items]);
  const validations = useMemo(() => (core && heroId === INFERNUS ? builds.map((b) => validateBuild(b, core)) : []), [builds, core, heroId]);
  const insight = useMemo(() => (user ? personalInsight(user, heroId) : null), [user, heroId]);
  const build = builds[Math.min(tab, builds.length - 1)];

  if (error) return <div className="error">{error}</div>;
  if (!hero) return <div className="loading">Loading snapshots…</div>;

  return (
    <>
      <header className="app-header">
        <img src={img(hero.images.small)} alt="" />
        <div>
          <h1>{hero.name} builds</h1>
          <div className="sub">Deadlock Build Optimizer, {manifest?.window_days}-day data fetched {manifest?.fetched_at.slice(0, 10)}</div>
        </div>
      </header>
      <div className="hero-strip" role="tablist" aria-label="Hero">
        {heroes.map((h) => (
          <button key={h.id} className={`hero-chip ${h.id === heroId ? 'active' : ''}`} onClick={() => { setHeroId(h.id); setTab(0); }} role="tab" aria-selected={h.id === heroId}>
            <img src={img(h.images.small)} alt="" loading="lazy" /><span>{h.name}</span>
          </button>
        ))}
      </div>
      <select className="hero-select" value={heroId} onChange={(e) => { setHeroId(Number(e.target.value)); setTab(0); }} aria-label="Select hero">
        {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      {!analytics && <div className="loading">Generating builds…</div>}
      {builds.length > 0 && (
        <>
          <div className="tabs">{builds.map((b, i) => <button key={b.key} className={`tab ${i === tab ? 'active' : ''}`} onClick={() => setTab(i)}>{b.name}</button>)}</div>
          {build && <BuildView key={`${heroId}-${build.key}`} build={build} validation={validations[tab] ?? null} core={heroId === INFERNUS ? core : null} insight={insight} heroName={hero.name} />}
        </>
      )}
      <footer>Data: deadlock-api.com (aggregate analytics, assets). Builds are generated deterministically from the local snapshot; see README for the scoring function.</footer>
    </>
  );
}
