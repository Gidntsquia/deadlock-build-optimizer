export type SlotType = 'weapon' | 'vitality' | 'spirit';

export interface Prop {
  value: string | number;
  label?: string;
  postfix?: string;
  prefix?: string;
  [k: string]: unknown;
}

export interface Item {
  id: number;
  class_name: string;
  name: string;
  cost: number;
  item_tier: number;
  item_slot_type: SlotType;
  is_active_item: boolean;
  activation: string | null;
  heroes: number[];
  description: unknown;
  properties: Record<string, Prop>;
  tooltip_sections: {
    section_type?: string;
    section_attributes?: { properties?: string[]; elevated_properties?: string[]; important_properties?: string[]; loc_string?: string }[];
    [k: string]: unknown;
  }[];
  upgrades: unknown[];
  image: string | null;
  image_url: string;
}

export interface Ability {
  id: number;
  class_name: string;
  name: string;
  description: unknown;
  properties: Record<string, Prop & { scale_function?: { class_name?: string; stat_scale?: number } }>;
  upgrades: unknown[];
  image: string | null;
}

export interface Hero {
  id: number;
  name: string;
  class_name: string;
  tags: string[];
  image: string | null;
  starting_stats: Record<string, { value: number }>;
  standard_level_up_upgrades: Record<string, number>;
  weapon: Record<string, number> | null;
  abilities: Ability[];
}

export interface ItemStat {
  item_id: number;
  wins: number;
  losses: number;
  matches: number;
  players: number;
  avg_buy_time_s: number;
  avg_sell_time_s: number;
}
export interface AbilityOrderStat { abilities: number[]; wins: number; losses: number; matches: number }
export interface PermStat { item_ids: number[]; wins: number; losses: number; matches: number }
export interface HeroAnalytics {
  hero_id: number;
  hero_matches: number;
  hero_wins: number;
  item_stats: ItemStat[];
  ability_order_stats: AbilityOrderStat[];
  permutation_stats: PermStat[];
}

export type Phase = 'early' | 'mid' | 'late';

export interface BuildItem {
  item_id: number;
  phase: Phase;
  cost: number;
  running_total: number;
  score: number;
  win_rate: number;
  pick_rate: number;
  reasons: string[];
}
export interface AbilityStep {
  step: number; // 1..16
  ability_id: number;
  ability_name: string;
  rank: number; // 1 = unlock, 2..4 = upgrade tiers
}
export interface Build {
  id: string;
  name: string;
  tagline: string;
  hero_id: number;
  items: BuildItem[];
  total_cost: number;
  budget: number;
  ability_steps: AbilityStep[];
  unlock_order: string[];
  ability_win_rate: number;
  ability_matches: number;
}

export interface GeneratorOptions {
  /** late-game soul budget for the whole build */
  budget: number;
}

export interface UserInsight {
  matches: number;
  median_duration_min: number;
  souls_per_min: number;
  budget: number;
  hero_matches: number;
  hero_win_rate: number | null;
  text: string;
}
