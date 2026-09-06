import { img } from '../data/load';
import { useState } from 'react';
import type { Build, BuildItem, Phase } from '../types';
import type { BuildValidation, CoreSet } from '../validation/heldout';
import type { PersonalInsight } from '../personal';
import { fmtSouls, fmtTime } from '../text';
import { ItemCard } from './ItemCard';
import { ItemTile } from './ItemTile';
import { renderBuildPng } from '../export/png';

const PHASES: { key: Phase; label: string }[] = [{ key: 'early', label: 'Early Game' }, { key: 'mid', label: 'Mid Game' }, { key: 'late', label: 'Late Game' }];
// Ability points spent per step, as the in-game board labels them: unlock is free, tiers cost 1 / 2 / 5.
const AP_COST = { unlock: '', tier1: '1', tier2: '2', tier3: '5' } as const;

export function BuildView({ build, validation, core, insight, heroName, heroImage, fetchedAt }: { build: Build; validation: BuildValidation | null; core: CoreSet | null; insight: PersonalInsight | null; heroName: string; heroImage?: string; fetchedAt?: string }) {
  const [open, setOpen] = useState<BuildItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const slug = `${heroName}-${build.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sharePng = async () => {
    setBusy('png');
    try {
      const blob = await renderBuildPng(build, { heroName, heroImage, img, fetchedAt });
      const file = new File([blob], `${slug}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: `${heroName}: ${build.name}` }); return; } catch { /* cancelled: fall through to download */ } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { alert(`PNG export failed: ${e}`); } finally { setBusy(null); }
  };
  const budget = insight?.budget ?? Infinity;
  const abilities = [...new Map(build.abilityOrder.map((s) => [s.ability.id, s.ability])).values()];
  const steps = build.abilityOrder.length;
  const hasCore = Boolean(validation);
  const hasStretch = build.items.some((b) => b.runningTotal > budget);

  return (
    <>
    <div className="layout">
      <div className="col-main">
      <div className="board">
        <div className="board-head">
          <div><h2>{build.name}</h2><div className="muted">{build.tagline}</div></div>
          <button className="share-btn" onClick={sharePng} disabled={busy === 'png'} aria-label="Share build as image" title="Share build as image">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>
            <span>{busy === 'png' ? 'Rendering…' : 'Share'}</span>
          </button>
        </div>
        {PHASES.map((p) => {
          const rows = build.items.filter((b) => b.phase === p.key);
          if (!rows.length) return null;
          return (
            <div className="phase" key={p.key}>
              <div className="phase-head"><span>{p.label}</span><small>{fmtSouls(rows[rows.length - 1].runningTotal)} souls by end</small></div>
              <div className="tiles">
                {rows.map((b) => (
                  <ItemTile key={b.item.id} item={b.item} order={b.order} isCore={validation?.badges[b.item.id]} stretch={b.runningTotal > budget} total={b.runningTotal} cost={b.paidCost}
                    onClick={() => setOpen(b)} ariaLabel={`${b.item.name}, ${b.paidCost} souls${b.upgradesFrom ? ` (upgrade from ${b.upgradesFrom.name})` : ''}, buy ${b.order}`} />
                ))}
              </div>
            </div>
          );
        })}
        <div className="board-foot"><span>{build.items.length} items</span><span className="souls">{fmtSouls(build.totalCost)}</span></div>
        <div className="source">
          {build.population.kind === 'top'
            ? `Built from high-rank lobbies (average badge ${build.population.minBadge}+, Phantom and above), ${build.population.matches.toLocaleString()} matches.`
            : `Built from all ranks, ${build.population.matches.toLocaleString()} matches. Not enough high-rank games for this hero.`}
        </div>
        {(hasCore || hasStretch) && (
          <div className="legend">
            {hasCore && <span><i style={{ background: 'var(--good)' }} /> in {core?.player}'s core set</span>}
            {hasStretch && <span><i style={{ background: 'var(--warn)' }} /> past your usual net worth</span>}
            <span>numbers are buy order</span>
          </div>
        )}
      </div>
      </div>

      <div className="col-side">
      <div className="ap">
        <h2>Ability Point Order</h2>
        <div className="muted">
          {build.abilityOrderSupport ? `Most successful sequence in ${build.population.abilitySequenceKind === 'top' ? 'high-rank' : 'all-rank'} data: ${build.abilityOrderSupport.matches.toLocaleString()} matches, ${(build.abilityOrderSupport.winRate * 100).toFixed(1)}% win rate.` : 'No aggregate sequence data; default unlock order.'}
        </div>
        <div className="ap-grid">
          {abilities.map((a) => (
            <div key={a.id} style={{ display: 'contents' }}>
              <div className="ap-icon"><img src={img(a.image_webp)} alt={a.name} /></div>
              <div className="ap-track" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }} aria-label={`${a.name} level-up steps`}>
                {build.abilityOrder.filter((s) => s.ability.id === a.id).map((s) => (
                  <span className={`pt ${s.kind}`} key={s.index} style={{ gridColumn: s.index + 1 }} title={`${s.index + 1}. ${a.name} ${s.kind === 'unlock' ? 'unlock' : s.kind.replace('tier', 'tier ')}`}>{AP_COST[s.kind]}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="ap-names">
          {abilities.map((a) => <div key={a.id}><img src={img(a.image_webp)} alt="" /><span>{a.name}</span></div>)}
        </div>
      </div>

      {validation && core && (
        <div className="panel">
          <h2>Validation vs. {core.player}'s {core.hero}</h2>
          <div className="muted">How well the generator did against a held-out top player. Core set = items in ≥30% of their {core.matches} sampled matchmaking games (wins weighted 1.5×); rarer items are their experiments and are excluded. Their data never feeds the generator.</div>
          <div className="big" style={{ marginTop: 6 }}>{(validation.agreement * 100).toFixed(0)}% agreement</div>
          <div className="meter"><div style={{ width: `${validation.agreement * 100}%` }} /></div>
          <div className="kv">
            <span>Item overlap (F1 of build vs core)</span><span>{(validation.overlap * 100).toFixed(0)}%</span>
            <span>Core items in build</span><span>{validation.sharedCount} / {core.core.length}</span>
            <span>Build items that are core</span><span>{(validation.precision * 100).toFixed(0)}%</span>
            <span>Buy-order agreement (shared items)</span><span>{(validation.order * 100).toFixed(0)}%</span>
          </div>
          {validation.missingCore.length > 0 && <>
            <div className="muted" style={{ marginTop: 8 }}>Core items this build skipped:</div>
            <div className="chips">{validation.missingCore.map((c) => <span className="chip" key={c.item.id}>{c.item.name} {(c.frequency * 100).toFixed(0)}%</span>)}</div>
          </>}
        </div>
      )}

      {insight && (
        <div className="panel">
          <h2>Your games</h2>
          <div className="kv">
            <span>Standard-mode matches on record</span><span>{insight.matches}</span>
            <span>Median match length</span><span>{fmtTime(insight.medianDurationS)}</span>
            <span>Median final net worth{insight.heroMatches >= 10 ? ` on ${heroName}` : ''}</span><span>{fmtSouls(insight.medianNetWorth)}</span>
            {insight.heroMatches > 0 && <><span>{heroName} games / win rate</span><span>{insight.heroMatches} / {((insight.heroWinRate ?? 0) * 100).toFixed(0)}%</span></>}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>Items past your median net worth ({fmtSouls(insight.budget)}) get an orange <b>$</b> mark: buy them only when the game runs long.</div>
        </div>
      )}

      </div>
    </div>
      {open && <ItemCard bi={open} isCore={validation?.badges[open.item.id]} onClose={() => setOpen(null)} />}
    </>
  );
}
