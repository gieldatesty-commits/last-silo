import type { GameConfig } from '../config.js';

type Recipe = GameConfig['items']['recipes'][number];

/** Mnożnik bonusu przedmiotu z wzmocnienia. */
export const tierBonusMult = (c: GameConfig, tier: number) => 1 + c.items.upgrade.bonus_per_tier * tier;
/** Mnożnik kosztu naprawy z wzmocnienia. */
export const tierRepairMult = (c: GameConfig, tier: number) => 1 + c.items.upgrade.repair_per_tier * tier;

/** Profil przedmiotu: moc zjazdu, atak i obrona w najazdach (docs/ekwipunek-v1.0.md §2). */
export type Profile = { dive: number; attack: number; defense: number };
export const ZERO_PROFILE: Profile = Object.freeze({ dive: 0, attack: 0, defense: 0 });
export const addProfiles = (a: Profile, b: Profile): Profile => ({ dive: a.dive + b.dive, attack: a.attack + b.attack, defense: a.defense + b.defense });

/** Profil = pola receptury × jakość × mnożnik wzmocnienia. */
export function itemProfile(c: GameConfig, rc: Pick<Recipe, 'bonus' | 'attack' | 'defense'>, quality: number, tier: number): Profile {
  const m = quality * tierBonusMult(c, tier);
  return { dive: rc.bonus * m, attack: (rc.attack ?? 0) * m, defense: (rc.defense ?? 0) * m };
}

/** Moc zjazdu przedmiotu (zgodność: część `dive` profilu). */
export const itemBonus = (c: GameConfig, rc: Pick<Recipe, 'bonus'>, quality: number, tier: number) => itemProfile(c, { bonus: rc.bonus, attack: 0, defense: 0 }, quality, tier).dive;

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
