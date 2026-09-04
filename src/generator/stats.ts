// Stat-valuation tables used by the scoring function. All numbers are documented in README.md.
// unitValue: rough "souls per unit" of a stat, used to convert an item's raw stat lines into a
// soul-equivalent value so that value-per-soul can be compared across items.
export const UNIT_VALUE: Record<string, number> = {
  BaseAttackDamagePercent: 55, BonusFireRate: 60, BonusClipSizePercent: 20, BulletLifestealPercent: 45,
  BonusBulletSpeedPercent: 8, BulletArmorReduction: 45, NonPlayerBonusWeaponPower: 12,
  TechPower: 60, TechPowerPercent: 50, SpiritPower: 60, BonusSpirit: 60, AbilityLifestealPercentHero: 45,
  CooldownReduction: 70, TechRangeMultiplier: 40, TechRadiusMultiplier: 30, BonusAbilityDurationPercent: 50,
  MagicResistReduction: 45, TechPowerReduction: 30,
  BonusHealth: 6, BulletResist: 55, TechResist: 55, OutOfCombatHealthRegen: 30, BonusHealthRegen: 60,
  BonusMoveSpeed: 350, BonusSprintSpeed: 150, Stamina: 250, StatusResistancePercent: 25, SlowResistancePercent: 15,
  BonusMeleeDamagePercent: 12, MeleeResistPercent: 15, CombatBarrier: 4,
};

// Which stats each build archetype cares about (multiplier on the unit value).
export interface Archetype { key: string; name: string; tagline: string; slotBias: Record<'weapon' | 'vitality' | 'spirit', number>; statMult: Record<string, number> }

// One build per hero. Stat multipliers are neutral (1.0 for every stat): the hero fit comes from the
// kit profile term, the slot mix from what the population actually buys. No slot bias.
export const ARCHETYPES: Archetype[] = [
  {
    key: 'recommended', name: 'Recommended build', tagline: 'What high-rank players buy on this hero, in the order they buy it.',
    slotBias: { weapon: 1, vitality: 1, spirit: 1 },
    statMult: {},
  },
];

// Scoring weights (see README "Scoring function").
export const WEIGHTS = { popularity: 1.0, winLift: 1.0, efficiency: 0.8, kit: 0.8, synergy: 0.5, active: 0.1 };
export const WIN_SHRINK_FRAC = 0.05;      // Bayesian shrinkage: prior weight = 5% of the hero's most-bought item's matches
export const MIN_USAGE = 0.03;            // ignore items bought in <3% (relative) of games: their win rates are selection-biased noise
export const MAX_ITEMS = 14;
export const MIN_ITEMS = 12;
export const MAX_UPGRADE_STEPS = 4;      // extra entries allowed for component -> upgrade pairs (they share a slot)
export const SLOT_CAP = 5;                // items per slot type (4 base slots + 1 flex, rounded)
export const MAX_ACTIVES = 3;
export const PHASE_TIME_S = { early: 600, mid: 1320 }; // <10 min early, <22 min mid, else late
export const TIER_MIN = { 1: 3, 2: 3 } as Record<number, number>; // minimum items of tier 1 / tier 2
// Population choice: generate from the high-rank population (lobby average badge >= the snapshot's
// top_min_average_badge, currently 90 = Phantom+) when it has enough data, else fall back to all ranks.
export const MIN_TOP_ITEM_MATCHES = 500;    // the hero's most-bought item needs >=500 high-rank matches
export const MIN_TOP_SEQ_MATCHES = 200;     // the best high-rank ability sequence needs >=200 matches
