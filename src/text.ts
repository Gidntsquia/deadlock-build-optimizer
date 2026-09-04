// Turns the assets API's HTML/SVG-laden description strings into readable text.
export function cleanText(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*\/?>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
export const fmtSouls = (n: number) => n.toLocaleString('en-US');
export const fmtTime = (s: number) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
// Human label for a property key when the assets data has no label ("BonusFireRate" -> "Bonus Fire Rate")
export const labelFor = (key: string, label?: string) => label || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Percent$/, ' %');
