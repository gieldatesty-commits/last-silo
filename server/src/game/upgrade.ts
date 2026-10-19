import type { GameConfig } from '../config.js';

type Recipe = GameConfig['items']['recipes'][number];

/** Mnożnik bonusu przedmiotu z wzmocnienia. */
export const tierBonusMult = (c: GameConfig, tier: number) => 1 + c.items.upgrade.bonus_per_tier * tier;
/** Mnożnik kosztu naprawy z wzmocnienia. */
export const tierRepairMult = (c: GameConfig, tier: number) => 1 + c.items.upgrade.repair_per_tier * tier;

export const itemBonus = (c: GameConfig, rc: Pick<Recipe, 'bonus'>, quality: number, tier: number) => rc.bonus * quality * tierBonusMult(c, tier);

/** Koszt wzmocnienia do `toTier` (1..max_tier). */
export function upgradeTierCost(c: GameConfig, rc: Recipe, toTier: number) {
  const u = c.items.upgrade;
  const materials: Record<string, number> = {};
  for (const [m, n] of Object.entries(u.materials_per_tier)) if (n > 0) materials[m] = n * toTier;
  return {
    ore: Math.ceil(rc.ore * u.ore_fraction * u.growth ** (toTier - 1)),
    tokens: u.tokens_per_tier * toTier,
    materials,
    workshop: u.workshop_base + toTier,
    radio: u.radio,
  };
}
