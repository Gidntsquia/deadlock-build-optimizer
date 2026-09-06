// Draws a build board to a PNG for sharing: same parchment board, slot-tinted tiles, buy-order badges, tier tabs and
// ability-point order as the on-screen BuildView. Item images are same-origin snapshot files, so the canvas is not
// tainted and toBlob works.
import type { Build, Phase } from '../types';
import { fmtSouls } from '../text';

const C = {
  room: '#0e1a19', board: '#cbbd9f', edge: '#a89873', head: '#b7a986', ink: '#2b241a', soft: '#6b5e46', teal: '#62b6c8', tealInk: '#1b3a44',
  slot: { weapon: ['#c98a3a', '#e6ad5f'], vitality: ['#7fae47', '#a6cf6e'], spirit: ['#9a6fd0', '#b992e4'] } as Record<string, [string, string]>,
  tier: ['', '', '#7f5d33', '#5a4630', '#2e2419'], navy: '#2b3d70', navyTrack: '#1a2a58', navyInk: '#e9edf8',
};
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const PHASES: { key: Phase; label: string }[] = [{ key: 'early', label: 'Early Game' }, { key: 'mid', label: 'Mid Game' }, { key: 'late', label: 'Late Game' }];
const AP_COST = { unlock: '', tier1: '1', tier2: '2', tier3: '5' } as const;
const FONT = 'Nunito, "Segoe UI", system-ui, sans-serif';

const loadImg = (src?: string) => new Promise<HTMLImageElement | null>((res) => {
  if (!src) return res(null);
  const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
});

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' '), lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (g.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}

export interface PngOptions { heroName: string; heroImage?: string; img: (p?: string) => string | undefined; scale?: number; fetchedAt?: string }

export async function renderBuildPng(build: Build, o: PngOptions): Promise<Blob> {
  const scale = o.scale ?? 2, W = 900, COLS = 8, PAD = 16, TILE = (W - PAD * 2 - (COLS - 1) * 10) / COLS, TILE_H = TILE + 36;
  const phases = PHASES.map((p) => ({ ...p, rows: build.items.filter((b) => b.phase === p.key) })).filter((p) => p.rows.length);
  const abilities = [...new Map(build.abilityOrder.map((s) => [s.ability.id, s.ability])).values()];
  const steps = build.abilityOrder.length;
  const tileImgs = await Promise.all(build.items.map((b) => loadImg(o.img(b.item.shop_image_webp || b.item.image_webp))));
  const abImgs = await Promise.all(abilities.map((a) => loadImg(o.img(a.image_webp))));
  const heroImg = await loadImg(o.heroImage);
  try { await (document as unknown as { fonts?: { load: (f: string) => Promise<unknown> } }).fonts?.load(`800 16px ${FONT}`); } catch { /* fallback font */ }

  const boardH = 64 + phases.reduce((a, p) => a + 34 + Math.ceil(p.rows.length / COLS) * (TILE_H + 10) + 6, 0) + 40;
  const apH = 50 + abilities.length * 44 + 20;
  const H = 70 + boardH + 12 + apH + 30;
  const cv = document.createElement('canvas'); cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext('2d')!; g.scale(scale, scale);
  g.fillStyle = C.room; g.fillRect(0, 0, W, H);

  // header
  g.fillStyle = C.teal; g.fillRect(0, 0, W, 58);
  if (heroImg) { g.save(); g.beginPath(); g.arc(36, 29, 20, 0, Math.PI * 2); g.clip(); g.drawImage(heroImg, 16, 9, 40, 40); g.restore(); }
  g.fillStyle = C.tealInk; g.font = `800 20px ${FONT}`; g.textBaseline = 'middle'; g.fillText(`${o.heroName} build`, 68, 22);
  g.font = `700 12px ${FONT}`; g.globalAlpha = .8; g.fillText(`Deadlock Optimal Build Finder${o.fetchedAt ? `, data fetched ${o.fetchedAt}` : ''}`, 68, 42); g.globalAlpha = 1;

  // board
  let y = 70;
  roundRect(g, 10, y, W - 20, boardH, 8); g.fillStyle = C.board; g.fill(); g.lineWidth = 2; g.strokeStyle = C.edge; g.stroke();
  g.fillStyle = C.ink; g.font = `800 18px ${FONT}`; g.textBaseline = 'alphabetic'; g.fillText(build.name, PAD + 4, y + 26);
  g.fillStyle = C.soft; g.font = `700 12.5px ${FONT}`; g.fillText(build.tagline, PAD + 4, y + 46);
  y += 60;
  let k = 0;
  for (const p of phases) {
    g.fillStyle = C.head; g.fillRect(PAD, y, W - PAD * 2, 28);
    g.fillStyle = C.ink; g.font = `800 15px ${FONT}`; g.fillText(p.label, PAD + 10, y + 19);
    const end = fmtSouls(p.rows[p.rows.length - 1].runningTotal) + ' souls by end';
    g.fillStyle = C.soft; g.font = `700 12px ${FONT}`; g.fillText(end, W - PAD - 10 - g.measureText(end).width, y + 19);
    y += 34;
    p.rows.forEach((b, i) => {
      const x = PAD + (i % COLS) * (TILE + 10), ty = y + Math.floor(i / COLS) * (TILE_H + 10);
      const [deep, light] = C.slot[b.item.item_slot_type] ?? C.slot.weapon;
      g.save(); roundRect(g, x, ty, TILE, TILE_H, 6); g.clip();
      g.fillStyle = deep; g.fillRect(x, ty, TILE, TILE);
      g.fillStyle = light; g.fillRect(x, ty + TILE, TILE, 36);
      const im = tileImgs[k++]; if (im) { const s = TILE * .82, off = (TILE - s) / 2; g.drawImage(im, x + off, ty + off, s, s); }
      // tier tab
      g.fillStyle = b.item.item_tier >= 2 ? C.tier[b.item.item_tier] : light;
      g.beginPath(); g.moveTo(x + TILE - 26, ty); g.lineTo(x + TILE, ty); g.lineTo(x + TILE, ty + 26); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.font = `900 9px ${FONT}`; const rn = ROMAN[b.item.item_tier] ?? String(b.item.item_tier); g.fillText(rn, x + TILE - 3 - g.measureText(rn).width, ty + 10);
      // order badge
      g.fillStyle = 'rgba(20,15,10,.7)'; roundRect(g, x + 3, ty + 3, 18, 16, 8); g.fill();
      g.fillStyle = '#fff'; g.font = `900 10px ${FONT}`; g.textAlign = 'center'; g.fillText(String(b.order), x + 12, ty + 15);
      if (b.item.is_active_item) { g.fillStyle = '#2d2418'; roundRect(g, x + TILE / 2 - 22, ty + TILE - 16, 44, 13, 3); g.fill(); g.fillStyle = '#f2e7cf'; g.font = `900 8px ${FONT}`; g.fillText('ACTIVE', x + TILE / 2, ty + TILE - 6); }
      // name plate
      g.fillStyle = C.ink; g.font = `800 11px ${FONT}`;
      const lines = wrap(g, b.item.name, TILE - 6).slice(0, 2);
      lines.forEach((l, j) => g.fillText(l, x + TILE / 2, ty + TILE + (lines.length === 1 ? 22 : 15 + j * 13)));
      g.textAlign = 'left'; g.restore();
    });
    y += Math.ceil(p.rows.length / COLS) * (TILE_H + 10) + 6;
  }
  g.fillStyle = C.ink; g.font = `800 13px ${FONT}`; g.fillText(`${build.items.length} items`, PAD + 4, y + 18);
  const tot = fmtSouls(build.totalCost) + ' souls'; g.fillText(tot, W - PAD - 4 - g.measureText(tot).width, y + 18);
  g.fillStyle = C.soft; g.font = `700 11px ${FONT}`;
  const src = build.population.kind === 'top' ? `High-rank lobbies (badge ${build.population.minBadge}+), ${build.population.matches.toLocaleString()} matches. Numbers are buy order.` : `All ranks, ${build.population.matches.toLocaleString()} matches. Numbers are buy order.`;
  g.fillText(src, PAD + 4, y + 34);
  y = 70 + boardH + 12;

  // ability point order
  roundRect(g, 10, y, W - 20, apH, 8); g.fillStyle = C.navy; g.fill();
  g.fillStyle = C.navyInk; g.font = `800 16px ${FONT}`; g.fillText('Ability Point Order', PAD + 4, y + 24);
  g.font = `700 11px ${FONT}`; g.globalAlpha = .8;
  g.fillText(build.abilityOrderSupport ? `${build.abilityOrderSupport.matches.toLocaleString()} matches, ${(build.abilityOrderSupport.winRate * 100).toFixed(1)}% win rate` : 'Default unlock order', PAD + 4, y + 40); g.globalAlpha = 1;
  const trackX = PAD + 230, trackW = W - PAD - trackX, cell = trackW / Math.max(1, steps);
  abilities.forEach((a, i) => {
    const ay = y + 52 + i * 44;
    const im = abImgs[i]; if (im) g.drawImage(im, PAD + 4, ay, 34, 34);
    g.fillStyle = C.navyInk; g.font = `800 12px ${FONT}`; g.fillText(a.name, PAD + 44, ay + 21);
    g.fillStyle = C.navyTrack; roundRect(g, trackX, ay + 6, trackW, 22, 4); g.fill();
    for (const s of build.abilityOrder) if (s.ability.id === a.id) {
      const cx = trackX + s.index * cell + cell / 2;
      g.fillStyle = s.kind === 'unlock' ? C.teal : '#e9edf8'; g.beginPath(); g.arc(cx, ay + 17, Math.min(9, cell / 2 - 1), 0, Math.PI * 2); g.fill();
      if (AP_COST[s.kind]) { g.fillStyle = C.navy; g.font = `900 10px ${FONT}`; g.textAlign = 'center'; g.fillText(AP_COST[s.kind], cx, ay + 21); g.textAlign = 'left'; }
    }
  });
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}
