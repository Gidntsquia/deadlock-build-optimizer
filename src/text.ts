import type { Item, Prop } from './types.ts';

/** Whitelist sanitiser for description HTML from the assets API: drops svg/icons, keeps highlight spans and line breaks. */
export function cleanHtml(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<span class="highlight">([\s\S]*?)<\/span>/gi, '\u0001$1\u0002')
    .replace(/<br\s*\/?>/gi, '\u0003')
    .replace(/<[^>]*>/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\u0001/g, '<b>').replace(/\u0002/g, '</b>').replace(/\u0003/g, '<br/>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface StatLine { label: string; value: string }

const HIDE = new Set(['AbilityCooldownBetweenCharge']);

export function statLines(item: Item): StatLine[] {
  const out: StatLine[] = [];
  for (const [k, p] of Object.entries(item.properties) as [string, Prop][]) {
    if (HIDE.has(k) || !p.label) continue;
    const v = parseFloat(String(p.value));
    if (!Number.isFinite(v) || v === 0) continue;
    if (p.disable_value !== undefined && String(p.disable_value) === String(p.value)) continue;
    const sign = v > 0 && (p.prefix === '{s:sign}' || /Bonus|Power|Resist|Speed|Rate|Health/.test(k)) ? '+' : '';
    const prefix = p.prefix && !p.prefix.startsWith('{') ? p.prefix : '';
    out.push({ label: String(p.label), value: `${sign}${prefix}${Number.isInteger(v) ? v : +v.toFixed(2)}${p.postfix ?? ''}` });
  }
  return out;
}

export interface TextBlock { kind: string; html: string }

export function textBlocks(item: Item): TextBlock[] {
  const blocks: TextBlock[] = [];
  const seen = new Set<string>();
  const add = (kind: string, raw: unknown) => {
    if (typeof raw !== 'string') return;
    const html = cleanHtml(raw);
    if (html && !seen.has(html)) {
      seen.add(html);
      blocks.push({ kind, html });
    }
  };
  for (const s of item.tooltip_sections) {
    for (const a of s.section_attributes ?? []) add(s.section_type ?? 'info', a.loc_string);
  }
  const d = item.description as { desc?: string; passive?: string; active?: string } | null;
  if (d) {
    add('active', d.active);
    add('passive', d.passive);
    add('info', d.desc);
  }
  return blocks;
}

export const TIER_LABEL = (t: number) => `Tier ${t}`;
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
