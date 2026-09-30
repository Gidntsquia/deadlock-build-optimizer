import { useState } from 'react';
import type { Hero } from '../types.ts';
import { asset } from '../data.ts';

export function HeroPicker({ heroes, current, onPick }: { heroes: Hero[]; current: Hero; onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const sorted = [...heroes].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <button className="hero-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Hero: ${current.name}. Change hero`}>
        {current.image && <img src={asset(current.image)} alt="" width={40} height={40} />}
        <span className="grow">{current.name}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Pick a hero" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Pick a hero</h2>
              <button className="close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="hero-grid">
              {sorted.map((h) => (
                <button key={h.id} className={h.id === current.id ? 'hero on' : 'hero'} onClick={() => { onPick(h.id); setOpen(false); }}>
                  {h.image && <img src={asset(h.image)} alt="" width={48} height={48} loading="lazy" />}
                  <span>{h.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
