import type { Hero, HeroAnalytics, Item } from './types.ts';
import type { UserHistory } from './personalize.ts';

export const BASE = import.meta.env.BASE_URL;
export const asset = (p: string | null | undefined) => (p ? `${BASE}${p}` : '');

async function getJson<T>(rel: string): Promise<T> {
  const res = await fetch(`${BASE}data/${rel}`);
  if (!res.ok) throw new Error(`Missing snapshot ${rel} (${res.status}). Run "npm run fetch-data".`);
  return res.json();
}

export const loadItems = () => getJson<Item[]>('items.json');
export const loadHeroes = () => getJson<Hero[]>('heroes.json');
export const loadAnalytics = (heroId: number) => getJson<HeroAnalytics>(`analytics/${heroId}.json`);
export const loadUserHistory = () => getJson<UserHistory>('user-history.json').catch(() => null);
export const loadManifest = () => getJson<{ fetched_at: string; assets_source: string }>('manifest.json').catch(() => null);
