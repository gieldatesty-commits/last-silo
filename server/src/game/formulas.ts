import type { BuildingType, GameConfig } from '../config.js';

export type Levels = Record<BuildingType, number>;

export const orePerHour = (c: GameConfig, level: number) =>
  c.effects.ore_per_hour.base * c.effects.ore_per_hour.growth ** (level - 1);

export const steamCap = (c: GameConfig, level: number) => c.effects.steam.cap_base + c.effects.steam.cap_step * (level - 1);

/** para na minutę */
export const steamRegen = (c: GameConfig, level: number) => c.effects.steam.regen_base + c.effects.steam.regen_step * (level - 1);

export const oreCap = (c: GameConfig, level: number) => Math.floor(c.effects.warehouse.cap_base * c.effects.warehouse.cap_growth ** (level - 1));

export const protectedShare = (c: GameConfig, level: number) =>
  Math.min(c.effects.warehouse.protected_max, c.effects.warehouse.protected_step * level);

/** Ruda chroniona przed najazdem: udział Magazynu z części mieszczącej się w jego pojemności; nadwyżka nie jest chroniona. */
export const protectedOre = (c: GameConfig, level: number, ore: number) => Math.floor(protectedShare(c, level) * Math.min(ore, oreCap(c, level)));

export const defenseBonus = (c: GameConfig, level: number) => c.effects.watchtower.defense_step * level;

/** koszt w rudzie ulepszenia DO poziomu `toLevel` */
export function upgradeCost(c: GameConfig, type: BuildingType, toLevel: number, costMultiplier = 1): number {
  const base = c.buildings.find((b) => b.id === type)!.base_cost;
  return Math.ceil(base * c.upgrades.cost_growth ** (toLevel - 1) * costMultiplier);
}

/** czas w sekundach ulepszenia DO poziomu `toLevel` (>= 2) */
export const upgradeSeconds = (c: GameConfig, toLevel: number) =>
  Math.round(c.upgrades.time_base_seconds * c.upgrades.time_growth ** (toLevel - 2));

export const initialLevels = (): Levels => ({ szyb_glowny: 1, generator_pary: 1, magazyn: 1, warsztat: 1, wartownia: 1, laboratorium: 1, radiostacja: 1 });

/** Maksymalny poziom budynku: wyjątek z `max_level_by_building`, inaczej `max_level`. */
export const maxLevelOf = (c: GameConfig, type: string) => c.upgrades.max_level_by_building[type] ?? c.upgrades.max_level;
