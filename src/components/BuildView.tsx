import { img } from '../data/load';
import { useState } from 'react';
import type { Build, BuildItem, Phase } from '../types';
import type { BuildValidation, CoreSet } from '../validation/zergggy';
import type { PersonalInsight } from '../personal';
import { fmtSouls, fmtTime } from '../text';
import { ItemCard } from './ItemCard';

const PHASES: { key: Phase; label: string }[] = [{ key: 'early', label: 'Early game' }, { key: 'mid', label: 'Mid game' }, { key: 'late', label: 'Late game' }];
const KIND = { unlock: 'Unlock', tier1: 'T1', tier2: 'T2', tier3: 'T3' } as const;

export function BuildView({ build, validation, core, insight, heroName }: { build: Build; validation: BuildValidation | null; core: CoreSet | null; insight: PersonalInsight | null; heroName: string }) {
  const [open, setOpen] = useState<BuildItem | null>(null);
  const budget = insight?.budget ?? Infinity;
  return (
    <>
      <div className="section">
        <h2>{build.name}</h2>
        <div className="muted">{build.tagline}</div>
        {PHASES.map((p) => {
          const rows = build.items.filter((b) => b.phase === p.key);
          if (!rows.length) return null;
          return (
            <div className="phase" key={p.key}>
              <div className="phase-head"><span>{p.label}</span><span>{fmtSouls(rows[rows.length - 1].runningTotal)} souls by end</span></div>
              {rows.map((b) => {
                const isCore = validation?.badges[b.item.id];
                return (
                  <button className="item-row" key={b.item.id} onClick={() => setOpen(b)} aria-label={`${b.item.name}, ${b.item.cost} souls`}>
                    <span className="n">{b.order}</span>
                    <img src={img(b.item.shop_image_webp || b.item.image_webp)} alt="" loading="lazy" />
                    <span>
                      <span className="name"><span className={`slot-dot slot-${b.item.item_slot_type}`} />{b.item.name}
                        {isCore !== undefined && <span className={`badge ${isCore ? 'core' : 'notcore'}`}>{isCore ? 'core' : 'not core'}</span>}
                        {b.runningTotal > budget && <span className="badge stretch">stretch</span>}
                      </span>
                      <span className="meta">T{b.item.item_tier} · ~{fmtTime(b.avgBuyTimeS)} · {(b.winRate * 100).toFixed(0)}% WR</span>
                    </span>
                    <span className="cost"><b>{fmtSouls(b.item.cost)}</b><small>Σ {fmtSouls(b.runningTotal)}</small></span>
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="total"><span>{build.items.length} items</span><span>{fmtSouls(build.totalCost)} souls</span></div>
      </div>

      <div className="section">
        <h2>Ability level-up order</h2>
        <div className="muted">
          {build.abilityOrderSupport ? `Most successful sequence in aggregate data: ${build.abilityOrderSupport.matches.toLocaleString()} matches, ${(build.abilityOrderSupport.winRate * 100).toFixed(1)}% win rate.` : 'No aggregate sequence data; default unlock order.'}
        </div>
        <div className="ability-list" style={{ marginTop: 8 }}>
          {build.abilityOrder.map((s) => (
            <span className={`ability-step ${s.kind}`} key={s.index} title={s.ability.name}>
              <img src={img(s.ability.image_webp)} alt="" /><span>{s.index + 1}. <b>{s.ability.name}</b> <span className="k">{KIND[s.kind]}</span></span>
            </span>
          ))}
        </div>
        <div className="ability-legend">
          {[...new Map(build.abilityOrder.map((s) => [s.ability.id, s.ability])).values()].map((a) => (
            <div key={a.id}><img src={img(a.image_webp)} alt="" /><span>{a.name}</span></div>
          ))}
        </div>
      </div>

      {validation && core && (
        <div className="section">
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
            <div className="chips">{validation.missingCore.map((c) => <span className="chip" key={c.item.id}>{c.item.name} · {(c.frequency * 100).toFixed(0)}%</span>)}</div>
          </>}
        </div>
      )}

      {insight && (
        <div className="section">
          <h2>Your games</h2>
          <div className="kv">
            <span>Standard-mode matches on record</span><span>{insight.matches}</span>
            <span>Median match length</span><span>{fmtTime(insight.medianDurationS)}</span>
            <span>Median final net worth{insight.heroMatches >= 10 ? ` on ${heroName}` : ''}</span><span>{fmtSouls(insight.medianNetWorth)}</span>
            {insight.heroMatches > 0 && <><span>{heroName} games / win rate</span><span>{insight.heroMatches} / {((insight.heroWinRate ?? 0) * 100).toFixed(0)}%</span></>}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>Items past your median net worth ({fmtSouls(insight.budget)}) are tagged <span className="badge stretch">stretch</span>: buy them only when the game runs long.</div>
        </div>
      )}

      {open && <ItemCard bi={open} isCore={validation?.badges[open.item.id]} onClose={() => setOpen(null)} />}
    </>
  );
}
