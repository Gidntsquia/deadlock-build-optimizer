import type { Ability, Hero, HeroAnalytics, Item } from '../types';
import type { UserHistory } from '../personal';

export const base = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}data/`;
export async function j<T>(rel: string): Promise<T> {
  const r = await fetch(base + rel);
  if (!r.ok) throw new Error(`Missing snapshot ${rel} – run \`npm run fetch-data\``);
  return r.json();
}
export interface Manifest { fetched_at: string; window_days: number; counts: Record<string, number> }
export const loadCore = () => Promise.all([j<Item[]>('items.json'), j<Hero[]>('heroes.json'), j<Ability[]>('abilities.json'), j<Manifest>('manifest.json')]);
export const loadAnalytics = (heroId: number) => j<HeroAnalytics>(`analytics/${heroId}.json`);
export const loadUser = () => j<UserHistory>('user/history.json');

/** Image fields in the snapshot are app-relative (img/...) after fetch-data; absolute URLs pass through. */
export const img = (p?: string) => (!p ? undefined : /^https?:/.test(p) ? p : base + p);
