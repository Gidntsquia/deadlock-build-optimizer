import { useEffect, useMemo, useState } from 'react';
import type { Ability, Build, Hero, HeroAnalytics, Item } from './types';
import { img, loadAnalytics, loadCore, type Manifest } from './data/load';
import { generateBuilds } from './generator';
import { computeCoreSet, loadHeldout, validateAgainstPanel, type CoreSet, type HeldoutPurchases, type HeldoutSet } from './validation/heldout';
import { BuildView } from './components/BuildView';
import { BrawlView } from './components/BrawlView';

const INFERNUS = 1;

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [heldout, setHeldout] = useState<{ set: HeldoutSet; data: HeldoutPurchases }[]>([]);
  const [heroId, setHeroId] = useState(INFERNUS);
  const [analytics, setAnalytics] = useState<HeroAnalytics | null>(null);
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<'build' | 'brawl'>(() => (location.hash === '#brawl' ? 'brawl' : 'build'));
  useEffect(() => { history.replaceState(null, '', mode === 'brawl' ? '#brawl' : location.pathname + location.search); }, [mode]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCore().then(([i, h, a, m]) => { setItems(i); setHeroes(h); setAbilities(a); setManifest(m); }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { setAnalytics(null); loadAnalytics(heroId).then(setAnalytics).catch((e) => setError(String(e))); }, [heroId]);
  // held-out representative players for this hero (up to 5); sets that fail to load are skipped
  useEffect(() => {
    const sets = manifest?.validation_sets?.filter((v) => v.hero_id === heroId) ?? [];
    setHeldout([]);
    if (!sets.length) return;
    let live = true;
    Promise.allSettled(sets.map((set) => loadHeldout(set).then((data) => ({ set, data })))).then((rs) => {
      if (!live) return;
      setHeldout(rs.flatMap((r) => (r.status === 'fulfilled' && r.value.data.hero_id === heroId ? [r.value] : [])));
    });
    return () => { live = false; };
  }, [heroId, manifest]);

  const hero = heroes.find((h) => h.id === heroId);
  const builds: Build[] = useMemo(() => (hero && analytics && items.length ? generateBuilds({ hero, abilities, items, analytics }) : []), [hero, abilities, items, analytics]);
  const panel: { set: HeldoutSet; core: CoreSet }[] = useMemo(() => (items.length ? heldout.filter((h) => h.data.hero_id === heroId).map((h) => ({ set: h.set, core: computeCoreSet(h.data, items) })) : []), [heldout, items, heroId]);
  const validations = useMemo(() => (panel.length ? builds.map((b) => validateAgainstPanel(b, panel)) : []), [builds, panel]);
  const build = builds[Math.min(tab, builds.length - 1)];

  if (error) return <div className="error">{error}</div>;
  if (!hero) return <div className="loading">Loading snapshots…</div>;

  return (
    <>
      <header className="app-header">
        <img src={img(hero.images.small)} alt="" />
        <div>
          <h1>{hero.name} {mode === 'brawl' ? 'Street Brawl' : 'build'}</h1>
          <div className="sub">Deadlock Optimal Build Finder, {manifest?.window_days}-day data fetched {manifest?.fetched_at.slice(0, 10)}</div>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={mode === 'build'} className={mode === 'build' ? 'active' : ''} onClick={() => setMode('build')}>Build</button>
          <button role="tab" aria-selected={mode === 'brawl'} className={mode === 'brawl' ? 'active' : ''} onClick={() => setMode('brawl')}>Brawl</button>
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
      {mode === 'brawl' && <BrawlView hero={hero} heroes={heroes} items={items} abilities={abilities} onHero={setHeroId} />}
      {mode === 'build' && !analytics && <div className="loading">Generating builds…</div>}
      {mode === 'build' && builds.length > 0 && (
        <>
          {build && <BuildView key={`${heroId}-${build.key}`} build={build} panel={validations[tab] ?? null} heroName={hero.name} heroImage={img(hero.images.small)} fetchedAt={manifest?.fetched_at.slice(0, 10)} />}
        </>
      )}
      <footer>Data: deadlock-api.com (aggregate analytics, assets). Builds are generated deterministically from the local snapshot; see README for the scoring function.</footer>
    </>
  );
}
