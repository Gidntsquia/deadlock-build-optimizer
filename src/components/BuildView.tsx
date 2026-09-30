import type { Build, Hero, Item, Phase } from '../types.ts';
import type { BuildValidation, CoreSet } from '../validation/validate.ts';
import { asset } from '../data.ts';
import { pct } from '../text.ts';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

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
          <div key={ph.id} className="phase panel">
            <h2 className="bar-head">{ph.label} <small>{ph.hint}</small></h2>
            <ol className="items">
              {list.map((bi) => {
                const it = byId.get(bi.item_id)!;
                const v = validation?.per_item.get(bi.item_id);
                return (
                  <li key={bi.item_id}>
                    <button className={`tile slot-${it.item_slot_type}`} onClick={() => onOpen(it)} aria-label={`${it.name}, ${it.cost} souls. Open details`}>
                      <span className="tier" aria-hidden>{ROMAN[it.item_tier] ?? it.item_tier}</span>
                      <img src={asset(it.image)} alt="" width={64} height={64} />
                      {it.is_active_item && <span className="active-tag">Active</span>}
                      <span className="tile-name">{it.name}</span>
                      <span className="tile-cost">{it.cost.toLocaleString()}</span>
                      {v && <span className={v.core ? 'dot core' : 'dot exp'} title={v.core ? 'Core item' : 'Not core'} />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      <div className="phase panel">
        <h2 className="bar-head">Ability Point Order <small>{hero.name}</small></h2>
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
    <div className="ap">
      <div className="ap-grid">
        {abilities.map((a) => {
          const steps = build.ability_steps.filter((s) => s.ability_id === a.id);
          return (
            <div key={a.id} className="ap-row">
              <span className="ap-icon" title={a.name}>{a.image ? <img src={asset(a.image)} alt={a.name} width={34} height={34} /> : a.name}</span>
              {Array.from({ length: 16 }, (_, i) => {
                const s = steps.find((x) => x.step === i + 1);
                return (
                  <span key={i} className="ap-cell">
                    {s && (s.rank === 1
                      ? <b className="pip unlock" title={`Step ${s.step}: unlock ${a.name}`}>⚡</b>
                      : <b className="pip" title={`Step ${s.step}: ${a.name} tier ${s.rank - 1}`}>◆{s.rank - 1}</b>)}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Columns are level-up steps 1–16. Played in {build.ability_matches.toLocaleString()} matches, {pct(build.ability_win_rate, 1)} wins.
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
