import type { GameConfig } from '../config.js';
import { maxLevelOf } from './formulas.js';

type Recipe = GameConfig['items']['recipes'][number];

/** Mnożnik bonusu przedmiotu z wzmocnienia. */
export const tierBonusMult = (c: GameConfig, tier: number) => 1 + c.items.upgrade.bonus_per_tier * tier;
/** Mnożnik kosztu naprawy z wzmocnienia. */
export const tierRepairMult = (c: GameConfig, tier: number) => 1 + c.items.upgrade.repair_per_tier * tier;

/** Profil przedmiotu: moc zjazdu, atak i obrona w najazdach (docs/ekwipunek-v1.0.md §2). */
export type Profile = { dive: number; attack: number; defense: number };
export const ZERO_PROFILE: Profile = Object.freeze({ dive: 0, attack: 0, defense: 0 });
export const addProfiles = (a: Profile, b: Profile): Profile => ({ dive: a.dive + b.dive, attack: a.attack + b.attack, defense: a.defense + b.defense });

/** Rzadkość przedmiotu z configu (`items.rarity`). */
export type Rarity = GameConfig['items']['rarity'][number];

/** Rzadkość dla liczby `u` ∈ [0,1): progi kumulowanych szans w kolejności z configu. */
export function rollRarity(c: GameConfig, u: number): Rarity {
  let acc = 0;
  for (const r of c.items.rarity) {
    acc += r.chance;
    if (u < acc) return r;
  }
  return c.items.rarity[c.items.rarity.length - 1]!;
}

/** Rzadkość po id; nieznana albo brak (przedmioty sprzed migracji 017) = pierwsza z listy (zwykła). */
export const rarityOf = (c: GameConfig, id: string | null | undefined): Rarity => c.items.rarity.find((r) => r.id === id) ?? c.items.rarity[0]!;

/** Profil = pola receptury × jakość × mnożnik wzmocnienia × mnożnik rzadkości. */
export function itemProfile(c: GameConfig, rc: Pick<Recipe, 'bonus' | 'attack' | 'defense'>, quality: number, tier: number, rarityMult = 1): Profile {
  const m = quality * tierBonusMult(c, tier) * rarityMult;
  return { dive: rc.bonus * m, attack: (rc.attack ?? 0) * m, defense: (rc.defense ?? 0) * m };
}

/** Moc zjazdu przedmiotu (zgodność: część `dive` profilu). */
export const itemBonus = (c: GameConfig, rc: Pick<Recipe, 'bonus'>, quality: number, tier: number) => itemProfile(c, { bonus: rc.bonus, attack: 0, defense: 0 }, quality, tier).dive;

/** Koszt wzmocnienia do `toTier` (1..max_tier). Tiery powyżej 5: ruda × growth_high, Warsztat na maksimum, badanie z `high_tiers`. */
export function upgradeTierCost(c: GameConfig, rc: Recipe, toTier: number) {
  const u = c.items.upgrade;
  const materials: Record<string, number> = {};
  for (const [m, n] of Object.entries(u.materials_per_tier)) if (n > 0) materials[m] = n * toTier;
  const LOW = 5;
  const base = rc.ore * u.ore_fraction;
  const ore = toTier <= LOW ? base * u.growth ** (toTier - 1) : Math.ceil(base * u.growth ** (LOW - 1)) * u.growth_high ** (toTier - LOW);
  const tech = [...u.high_tiers].filter((h) => h.from <= toTier).sort((a, b) => b.from - a.from)[0]?.tech ?? null;
  return {
    ore: Math.ceil(ore),
    tokens: u.tokens_per_tier * toTier,
    materials,
    workshop: Math.min(u.workshop_base + toTier, maxLevelOf(c, 'warsztat')),
    radio: u.radio,
    tech,
  };
}
