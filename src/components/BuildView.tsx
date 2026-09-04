import { img } from '../data/load';
import { useState } from 'react';
import type { Build, BuildItem, Phase } from '../types';
import type { BuildValidation, CoreSet } from '../validation/zergggy';
import type { PersonalInsight } from '../personal';
import { fmtSouls, fmtTime } from '../text';
import { ItemCard } from './ItemCard';
import { ItemTile } from './ItemTile';

const PHASES: { key: Phase; label: string }[] = [{ key: 'early', label: 'Early Game' }, { key: 'mid', label: 'Mid Game' }, { key: 'late', label: 'Late Game' }];
// Ability points spent per step, as the in-game board labels them: unlock is free, tiers cost 1 / 2 / 5.
const AP_COST = { unlock: '', tier1: '1', tier2: '2', tier3: '5' } as const;

export function BuildView({ build, validation, core, insight, heroName }: { build: Build; validation: BuildValidation | null; core: CoreSet | null; insight: PersonalInsight | null; heroName: string }) {
  const [open, setOpen] = useState<BuildItem | null>(null);
  const budget = insight?.budget ?? Infinity;
  const abilities = [...new Map(build.abilityOrder.map((s) => [s.ability.id, s.ability])).values()];
  const steps = build.abilityOrder.length;
  const hasCore = Boolean(validation);
  const hasStretch = build.items.some((b) => b.runningTotal > budget);

  return (
    <>
      <div className="board">
        <h2>{build.name}</h2>
        <div className="muted">{build.tagline}</div>
        {PHASES.map((p) => {
          const rows = build.items.filter((b) => b.phase === p.key);
          if (!rows.length) return null;
          return (
            <div className="phase" key={p.key}>
              <div className="phase-head"><span>{p.label}</span><small>{fmtSouls(rows[rows.length - 1].runningTotal)} souls by end</small></div>
              <div className="tiles">
                {rows.map((b) => (
                  <ItemTile key={b.item.id} item={b.item} order={b.order} isCore={validation?.badges[b.item.id]} stretch={b.runningTotal > budget} total={b.runningTotal}
                    onClick={() => setOpen(b)} ariaLabel={`${b.item.name}, ${b.item.cost} souls, buy ${b.order}`} />
                ))}
              </div>
            </div>
          );
        })}
        <div className="board-foot"><span>{build.items.length} items</span><span className="souls">{fmtSouls(build.totalCost)}</span></div>
        {(hasCore || hasStretch) && (
          <div className="legend">
            {hasCore && <span><i style={{ background: 'var(--good)' }} /> in Zergggy's core set</span>}
            {hasStretch && <span><i style={{ background: 'var(--warn)' }} /> past your usual net worth</span>}
            <span>numbers are buy order</span>
          </div>
        )}
      </div>

      <div className="ap">
        <h2>Ability Point Order</h2>
        <div className="muted">
          {build.abilityOrderSupport ? `Most successful sequence in aggregate data: ${build.abilityOrderSupport.matches.toLocaleString()} matches, ${(build.abilityOrderSupport.winRate * 100).toFixed(1)}% win rate.` : 'No aggregate sequence data; default unlock order.'}
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
          <h2>Validation vs. Zergggy's Infernus</h2>
          <div className="muted">How well the generator did against a held-out top player. Core set = items in ≥30% of his {core.matches} sampled matchmaking games (wins weighted 1.5×); rarer items are his experiments and are excluded. His data never feeds the generator.</div>
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

      {open && <ItemCard bi={open} isCore={validation?.badges[open.item.id]} onClose={() => setOpen(null)} />}
    </>
  );
}
