import type { Hero, SlotType } from '../types.ts';

export interface KitProfile {
  /** 0..1 how much of the hero's damage scales with spirit (from ability scale functions) */
  spirit: number;
  /** 0..1 how strong the hero's gun is (damage per second of the primary weapon) */
  weapon: number;
  /** 0..1 how much of the hero's kit is triggered by bullets (burn build-up etc.) → fire rate / ammo synergy */
  bulletProc: number;
  /** share of per-level growth by category (sums to 1) */
  growth: Record<SlotType, number>;
  /** final synergy per slot type, 0..1 */
  synergy: Record<SlotType, number>;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

export function kitProfile(hero: Hero): KitProfile {
  // Spirit scaling: sum of stat_scale on tech-scaled properties across the four signature abilities.
  let techScale = 0;
  let procKeys = 0;
  for (const ab of hero.abilities) {
    for (const [key, p] of Object.entries(ab.properties)) {
      const sf = p.scale_function;
      if (sf && /tech_damage/.test(sf.class_name ?? '')) techScale += sf.stat_scale ?? 0.5;
      if (/Bullet|PerShot|PerHit|Headshot|Buildup|BuildUp/i.test(key) && Number(p.value) !== 0) procKeys++;
    }
  }
  const spirit = clamp(techScale / 2.5);
  const dps = hero.weapon?.damage_per_second ?? 40;
  const weapon = clamp((dps - 20) / 60);
  const bulletProc = clamp(procKeys / 4);

  // Growth shares (per level): bullet damage %, health %, spirit points
  const up = hero.standard_level_up_upgrades ?? {};
  const bulletBase = hero.weapon?.bullet_damage || 1;
  const hpBase = hero.starting_stats?.max_health?.value || 800;
  const g = {
    weapon: (up.MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL ?? 0) / bulletBase,
    vitality: (up.MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL ?? 0) / hpBase,
    spirit: (up.MODIFIER_VALUE_TECH_POWER ?? 0) / 20,
  };
  const gs = g.weapon + g.vitality + g.spirit || 1;
  const growth = { weapon: g.weapon / gs, vitality: g.vitality / gs, spirit: g.spirit / gs };

  // Synergy: 60% kit, 40% growth (growth scaled so an even split = 0.33 → ~0.5)
  const kit = { weapon, spirit, vitality: 0.45 };
  const synergy = {
    weapon: clamp(0.6 * kit.weapon + 0.4 * clamp(growth.weapon * 1.5)),
    spirit: clamp(0.6 * kit.spirit + 0.4 * clamp(growth.spirit * 1.5)),
    vitality: clamp(0.6 * kit.vitality + 0.4 * clamp(growth.vitality * 1.5)),
  };
  return { spirit, weapon, bulletProc, growth, synergy };
}
