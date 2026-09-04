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

export const ARCHETYPES: Archetype[] = [
  {
    key: 'gun', name: 'Gun Carry', tagline: 'Weapon damage, fire rate and bullet lifesteal; abilities support the gun.',
    slotBias: { weapon: 1.0, vitality: 0.85, spirit: 0.6 },
    statMult: { BaseAttackDamagePercent: 1.6, BonusFireRate: 1.6, BonusClipSizePercent: 1.2, BulletLifestealPercent: 1.4, BulletArmorReduction: 1.4, BonusBulletSpeedPercent: 1.1, TechPower: 0.5, TechPowerPercent: 0.4, CooldownReduction: 0.6, AbilityLifestealPercentHero: 0.4, BonusHealth: 1.0, BulletResist: 1.0, TechResist: 1.0, BonusMoveSpeed: 1.0, Stamina: 1.0 },
  },
  {
    key: 'spirit', name: 'Spirit Burn', tagline: 'Spirit power, cooldowns and ability lifesteal; damage over time does the work.',
    slotBias: { weapon: 0.6, vitality: 0.85, spirit: 1.0 },
    statMult: { TechPower: 1.6, TechPowerPercent: 1.6, SpiritPower: 1.6, BonusSpirit: 1.6, CooldownReduction: 1.4, AbilityLifestealPercentHero: 1.4, BonusAbilityDurationPercent: 1.3, TechRangeMultiplier: 1.1, MagicResistReduction: 1.4, BaseAttackDamagePercent: 0.5, BonusFireRate: 0.6, BulletLifestealPercent: 0.5, BonusHealth: 1.0, BulletResist: 1.0, TechResist: 1.0, BonusMoveSpeed: 1.0, Stamina: 1.0 },
  },
  {
    key: 'bruiser', name: 'Hybrid Bruiser', tagline: 'Health, resistances and sustain first; balanced damage on top.',
    slotBias: { weapon: 0.8, vitality: 1.0, spirit: 0.8 },
    statMult: { BonusHealth: 1.6, BulletResist: 1.5, TechResist: 1.5, BonusHealthRegen: 1.3, OutOfCombatHealthRegen: 1.0, BulletLifestealPercent: 1.2, AbilityLifestealPercentHero: 1.2, CombatBarrier: 1.4, StatusResistancePercent: 1.3, BaseAttackDamagePercent: 0.9, BonusFireRate: 0.9, TechPower: 0.9, BonusMoveSpeed: 1.1, Stamina: 1.1 },
  },
];

// Scoring weights (see README "Scoring function").
export const WEIGHTS = { popularity: 1.0, winLift: 1.0, efficiency: 0.8, kit: 0.8, synergy: 0.5, active: 0.1 };
export const WIN_SHRINK_FRAC = 0.05;      // Bayesian shrinkage: prior weight = 5% of the hero's most-bought item's matches
export const MIN_USAGE = 0.03;            // ignore items bought in <3% (relative) of games: their win rates are selection-biased noise
export const MAX_ITEMS = 14;
export const MIN_ITEMS = 12;
export const SLOT_CAP = 5;                // items per slot type (4 base slots + 1 flex, rounded)
export const MAX_ACTIVES = 3;
export const PHASE_TIME_S = { early: 600, mid: 1320 }; // <10 min early, <22 min mid, else late
export const TIER_MIN = { 1: 3, 2: 3 } as Record<number, number>; // minimum items of tier 1 / tier 2
