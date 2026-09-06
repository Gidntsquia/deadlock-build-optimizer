import { img } from '../data/load';
import { useState } from 'react';
import type { Build, BuildItem, Phase } from '../types';
import { consensusThreshold, type PanelValidation } from '../validation/heldout';
import { fmtSouls } from '../text';
import { ItemCard } from './ItemCard';
import { ItemTile } from './ItemTile';
import { renderBuildPng } from '../export/png';

const PHASES: { key: Phase; label: string }[] = [{ key: 'early', label: 'Early Game' }, { key: 'mid', label: 'Mid Game' }, { key: 'late', label: 'Late Game' }];
// Ability points spent per step, as the in-game board labels them: unlock is free, tiers cost 1 / 2 / 5.
const AP_COST = { unlock: '', tier1: '1', tier2: '2', tier3: '5' } as const;

export function BuildView({ build, panel, heroName, heroImage, fetchedAt }: { build: Build; panel: PanelValidation | null; heroName: string; heroImage?: string; fetchedAt?: string }) {
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
  const abilities = [...new Map(build.abilityOrder.map((s) => [s.ability.id, s.ability])).values()];
  const steps = build.abilityOrder.length;
  const reps = panel?.players.length ?? 0;
  const need = consensusThreshold(reps);
  const hasCore = reps > 0;
  const isCore = (id: number) => (panel ? (panel.consensusBadges[id] ?? 0) >= need : undefined);

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
                  <ItemTile key={b.item.id} item={b.item} order={b.order} isCore={isCore(b.item.id)} total={b.runningTotal} cost={b.paidCost}
                    onClick={() => setOpen(b)} ariaLabel={`${b.item.name}, ${b.paidCost} souls${b.upgradesFrom ? ` (upgrade from ${b.upgradesFrom.name})` : ''}, buy ${b.order}`} />
                ))}
              </div>
            </div>
          );
        })}
        <div className="board-foot"><span>{build.items.length} items</span><span className="souls">{fmtSouls(build.totalCost)}</span></div>
        <div className="source">
          {build.population.kind === 'top'
            ? `Built from high-rank lobbies (average badge ${build.population.minBadge}+, Phantom and above), ${build.population.matches.toLocaleString()} matches${build.population.style ? ` played this way (${(build.population.style.share * 100).toFixed(0)}% of the hero's high-rank games)` : ''}.`
            : `Built from all ranks, ${build.population.matches.toLocaleString()} matches. Not enough high-rank games for this hero.`}
          {build.population.style && build.population.style.seed && ` This hero has more than one established build; this one is the games where ${build.population.style.seed.name} was bought.`}
          {build.population.style && !build.population.style.seed && ` This hero has more than one established build; this one leaves out games built around ${build.population.style.exclude.map((i) => i.name).join(', ')}.`}
        </div>
        {hasCore && (
          <div className="legend">
            <span><i style={{ background: 'var(--good)' }} /> core for {reps === 1 ? `${panel!.players[0].set.player}` : `${need} of ${reps} top players`}</span>
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

      {panel && reps > 0 && (
        <div className="panel">
          <h2>Validation vs. top players</h2>
          <div className="muted">How well the generator did against {reps === 1 ? 'one' : reps} held-out top {heroName} {reps === 1 ? 'player' : 'players'}. A player's core set = items in ≥30% of their sampled matchmaking games (wins weighted 1.5×); rarer items are experiments and are excluded. Panel agreement is the mean over players{reps > 1 ? ', weighted by how representative each player is' : ''}. Their data never feeds the generator.</div>
          <div className="big" style={{ marginTop: 6 }}>{(panel.agreement * 100).toFixed(0)}% agreement</div>
          <div className="meter"><div style={{ width: `${panel.agreement * 100}%` }} /></div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="panel-table">
              <thead><tr><th>Player</th><th title="matches in the sample (wins)">Games</th><th title="lifetime matches on this hero">Lifetime</th><th>Agree</th><th title="core items in build / core items">Core</th></tr></thead>
              <tbody>
                {panel.players.map((p) => (
                  <tr key={p.set.account_id}>
                    <td>{p.set.player}</td>
                    <td>{p.core.matches} ({p.core.wins}W)</td>
                    <td>{p.set.selection?.total_hero_matches ?? '—'}</td>
                    <td>{(p.validation.agreement * 100).toFixed(0)}%</td>
                    <td>{p.validation.sharedCount}/{p.core.core.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {panel.missingConsensus.length > 0 && <>
            <div className="muted" style={{ marginTop: 8 }}>Core items the panel buys that the build is missing:</div>
            <div className="chips">{panel.missingConsensus.map((c) => <span className="chip" key={c.item.id} title={`in ${(c.frequency * 100).toFixed(0)}% of their games on average`}>{c.item.name} {c.reps}/{reps} reps</span>)}</div>
          </>}
        </div>
      )}

      </div>
    </div>
      {open && <ItemCard bi={open} isCore={isCore(open.item.id)} onClose={() => setOpen(null)} />}
    </>
  );
}
