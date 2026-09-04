import { ItemTile } from './ItemTile';
import { useEffect } from 'react';
import type { BuildItem } from '../types';
import { cleanText, fmtSouls, labelFor } from '../text';

const SLOT_LABEL = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' } as const;
const HIDE = new Set(['AbilityUnitTargetLimit']);
// the assets API uses a `{s:sign}` token for "show a + on positive values"
const fmtPrefix = (prefix: string | undefined, v: unknown) => (prefix ?? '').replace('{s:sign}', Number(v) >= 0 ? '+' : '');
const isZero = (v: unknown) => ['0', '0.0', '-1', '-1.0', '', 'undefined'].includes(String(v));

export function ItemCard({ bi, isCore, onClose }: { bi: BuildItem; isCore: boolean | undefined; onClose: () => void }) {
  const it = bi.item;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  // Stat lines: properties the tooltip marks as shown, in tooltip order; fallback to all non-zero props.
  const ordered: string[] = [];
  for (const s of it.tooltip_sections) for (const a of s.section_attributes ?? []) for (const k of [...(a.important_properties ?? []), ...(a.elevated_properties ?? []), ...(a.properties ?? [])]) if (!ordered.includes(k)) ordered.push(k);
  const keys = (ordered.length ? ordered : Object.keys(it.properties)).filter((k) => it.properties[k] && !HIDE.has(k) && !isZero(it.properties[k].value));

  const shownTexts = new Set(it.tooltip_sections.flatMap((s) => (s.section_attributes ?? []).map((a) => cleanText(a.loc_string))));
  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={it.name}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <ItemTile item={it} />
          <div>
            <h2>{it.name}</h2>
            <div className="chips">
              <span className="chip">{SLOT_LABEL[it.item_slot_type]}</span>
              <span className="chip">Tier {it.item_tier}</span>
              <span className="chip">{fmtSouls(it.cost)} souls</span>
              {isCore !== undefined && <span className={`badge ${isCore ? 'core' : 'notcore'}`}>{isCore ? 'Zergggy core' : 'Not core'}</span>}
            </div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="tt-section">
          <h3>Stats</h3>
          {keys.length === 0 && <p className="muted">No flat stat lines.</p>}
          {keys.map((k) => { const p = it.properties[k]; return (
            <div className="stat-line" key={k}><span>{labelFor(k, p.label)}</span><b>{fmtPrefix(p.prefix, p.value)}{String(p.value)}{p.postfix ?? ''}</b></div>
          ); })}
        </div>

        {it.tooltip_sections.map((s, i) => {
          const texts = (s.section_attributes ?? []).map((a) => cleanText(a.loc_string)).filter(Boolean);
          if (!texts.length) return null;
          return <div className="tt-section" key={i}><h3>{s.section_type ?? 'Effect'}</h3>{texts.map((t, j) => <p key={j}>{t}</p>)}</div>;
        })}
        {Object.entries(it.description).filter(([, v]) => v && !shownTexts.has(cleanText(v))).map(([k, v]) => (
          <div className="tt-section" key={k}><h3>{k}</h3><p>{cleanText(v)}</p></div>
        ))}

        <div className="tt-section">
          <h3>Why it's in this build</h3>
          <div className="kv">
            <span>Buy step</span><span>#{bi.order} · {bi.phase} game</span>
            {bi.upgradesFrom && <><span>Upgrades</span><span>{bi.upgradesFrom.name}, pay {fmtSouls(bi.paidCost)}</span></>}
            <span>Running total after buy</span><span>{fmtSouls(bi.runningTotal)}</span>
            <span>Win rate when bought</span><span>{(bi.winRate * 100).toFixed(1)}%</span>
            <span>Relative usage</span><span>{(bi.usageRate * 100).toFixed(0)}%</span>
            <span>Score</span><span>{bi.score.toFixed(2)}</span>
          </div>
          {bi.reasons.length > 0 && <ul className="reasons">{bi.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      </div>
    </div>
  );
}
