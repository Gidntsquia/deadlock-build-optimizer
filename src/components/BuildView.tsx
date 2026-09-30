import type { Build, Hero, Item, Phase } from '../types.ts';
import type { BuildValidation, CoreSet } from '../validation/validate.ts';
import { asset } from '../data.ts';
import { pct } from '../text.ts';

const PHASES: { id: Phase; label: string; hint: string }[] = [
  { id: 'early', label: 'Early game', hint: 'Lane & first 10 minutes' },
  { id: 'mid', label: 'Mid game', hint: 'Transition & objectives' },
  { id: 'late', label: 'Late game', hint: 'Core power spikes' },
];

export function BuildView({ build, hero, items, validation, core, onOpen }: {
  build: Build; hero: Hero; items: Item[]; validation: BuildValidation | null; core: CoreSet | null; onOpen: (i: Item) => void;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <section>
      <p className="tagline">{build.tagline}</p>
      <p className="muted small">
        {build.items.length} items · {build.total_cost.toLocaleString()} souls of a {build.budget.toLocaleString()} budget
      </p>

      {validation && (
        <div className="validation" aria-label="Validation">
          <div className="agree">
            <strong>{Math.round(validation.agreement * 100)}%</strong>
            <span>agreement with Zergggy’s core set</span>
          </div>
          <div className="bar" aria-hidden><i style={{ width: `${Math.round(validation.agreement * 100)}%` }} /></div>
          <p className="muted small">
            How well the generator did (held-out check, not a source of the build): {validation.shared.length} of {core?.coreIds.length} core items matched
            (item overlap {pct(validation.overlap)}, buy-order agreement {pct(validation.order)}).
          </p>
        </div>
      )}

      {PHASES.map((ph) => {
        const list = build.items.filter((i) => i.phase === ph.id);
        if (!list.length) return null;
        return (
          <div key={ph.id} className="phase">
            <h2>{ph.label} <small>{ph.hint}</small></h2>
            <ol className="items">
              {list.map((bi) => {
                const it = byId.get(bi.item_id)!;
                const v = validation?.per_item.get(bi.item_id);
                return (
                  <li key={bi.item_id}>
                    <button className="item" onClick={() => onOpen(it)} aria-label={`${it.name}, ${it.cost} souls. Open details`}>
                      <img className={`shop slot-${it.item_slot_type}`} src={asset(it.image)} alt={`${it.name} shop icon`} width={48} height={48} />
                      <span className="meta">
                        <span className="name">{it.name}</span>
                        <span className="sub">T{it.item_tier} · {it.item_slot_type}{it.is_active_item ? ' · active' : ''}</span>
                      </span>
                      <span className="cost">
                        <b>{it.cost.toLocaleString()}</b>
                        <small>Σ {bi.running_total.toLocaleString()}</small>
                      </span>
                      {v && <span className={v.core ? 'badge core' : 'badge exp'}>{v.core ? 'core' : 'not core'}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      <div className="phase">
        <h2>Ability order <small>{hero.name}</small></h2>
        <AbilityOrder build={build} hero={hero} />
      </div>

      {validation && core && <CoreReport validation={validation} core={core} byId={byId} />}
    </section>
  );
}

function AbilityOrder({ build, hero }: { build: Build; hero: Hero }) {
  const order = build.unlock_order;
  const abilities = order.map((n) => hero.abilities.find((a) => a.name === n)!).filter(Boolean);
  return (
    <div>
      <p className="muted small">Unlock order: {order.map((n, i) => `${i + 1}. ${n}`).join('  ')}</p>
      <ul className="abilities">
        {abilities.map((a) => {
          const steps = build.ability_steps.filter((s) => s.ability_id === a.id);
          return (
            <li key={a.id}>
              <div className="ab-head">
                {a.image && <img src={asset(a.image)} alt="" width={32} height={32} />}
                <span>{a.name}</span>
              </div>
              <div className="ranks">
                {[1, 2, 3, 4].map((r) => {
                  const s = steps.find((x) => x.rank === r);
                  return (
                    <span key={r} className="rank" title={r === 1 ? 'Unlock' : `Upgrade tier ${r - 1}`}>
                      <small>{r === 1 ? 'Unlock' : `Tier ${r - 1}`}</small>
                      <b>{s ? `#${s.step}` : '–'}</b>
                    </span>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        Numbers are the level-up step (1–16). Sequence played in {build.ability_matches.toLocaleString()} matches, {pct(build.ability_win_rate, 1)} wins.
      </p>
    </div>
  );
}

function CoreReport({ validation, core, byId }: { validation: BuildValidation; core: CoreSet; byId: Map<number, Item> }) {
  return (
    <div className="phase">
      <h2>Validation report <small>held-out</small></h2>
      <p className="muted small">
        Zergggy’s core set = items held in ≥30% of his {core.matches} sampled real Infernus matches (wins weighted 1.5×). Rarer items are experiments and excluded.
      </p>
      {validation.missed_core.length > 0 && (
        <>
          <h3>Core items this build did not pick</h3>
          <p className="chips">
            {validation.missed_core.map((id) => (
              <span key={id} className="chip">{byId.get(id)?.name ?? id} <small>{pct(core.items.get(id)!.weighted_share)}</small></span>
            ))}
          </p>
        </>
      )}
    </div>
  );
}
