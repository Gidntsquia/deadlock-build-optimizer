import { useEffect } from 'react';
import type { Build, Item } from '../types.ts';
import type { BuildValidation } from '../validation/validate.ts';
import { asset } from '../data.ts';
import { statLines, textBlocks, TIER_LABEL, pct } from '../text.ts';

export function ItemCard({ item, build, validation, onClose }: { item: Item; build: Build; validation: BuildValidation | null; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const stats = statLines(item);
  const blocks = textBlocks(item);
  const bi = build.items.find((i) => i.item_id === item.id);
  const v = validation?.per_item.get(item.id);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={item.name} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{item.name}</h2>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-top">
          <img className={`shop slot-${item.item_slot_type}`} src={asset(item.image)} alt={`${item.name} shop icon`} width={96} height={96} />
          <dl className="facts">
            <div><dt>Cost</dt><dd>{item.cost.toLocaleString()} souls</dd></div>
            <div><dt>Tier</dt><dd>{TIER_LABEL(item.item_tier)}</dd></div>
            <div><dt>Slot</dt><dd className={`slot-text slot-${item.item_slot_type}`}>{item.item_slot_type}</dd></div>
            <div><dt>Type</dt><dd>{item.is_active_item ? 'Active' : 'Passive'}</dd></div>
          </dl>
        </div>
        {stats.length > 0 && (
          <ul className="stats">
            {stats.map((s) => (
              <li key={s.label + s.value}><span>{s.label}</span><b>{s.value}</b></li>
            ))}
          </ul>
        )}
        {blocks.map((b, i) => (
          <div className="text-block" key={i}>
            <span className={`kind kind-${b.kind}`}>{b.kind}</span>
            <p dangerouslySetInnerHTML={{ __html: b.html }} />
          </div>
        ))}
        {bi && (
          <div className="why">
            <h3>In this build</h3>
            <p>
              {bi.phase} game · running total {bi.running_total.toLocaleString()} · hero win rate with item {pct(bi.win_rate, 1)} · pick rate {pct(bi.pick_rate)}
            </p>
            {bi.reasons.length > 0 && <p className="muted">{bi.reasons.join(' · ')}</p>}
            {v && <p>{v.core ? <span className="badge core">core</span> : <span className="badge exp">not core</span>} in Zergggy’s Infernus sample ({pct(v.share)} weighted share)</p>}
          </div>
        )}
      </div>
    </div>
  );
}
