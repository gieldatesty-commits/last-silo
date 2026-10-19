import type { GameConfig } from '../config.js';
import { rng } from './rng.js';

export type Route = GameConfig['dives']['routes'][number];
export interface Stats {
  sila: number;
  technika: number;
  percepcja: number;
  wytrwalosc: number;
}

export const divePower = (s: Stats, itemBonus = 0) => 0.5 * s.technika + 0.3 * s.percepcja + 0.2 * s.wytrwalosc + itemBonus;

/** p = clamp(0.5 + (moc - trudność) / (2 * trudność), 0.10, 0.90) */
export const diveChance = (s: Stats, difficulty: number, itemBonus = 0) =>
  Math.min(0.9, Math.max(0.1, 0.5 + (divePower(s, itemBonus) - difficulty) / (2 * difficulty)));

export const steamCost = (route: Route, steamMultiplier: number) => Math.ceil(route.steam * steamMultiplier);

/** XP potrzebne, by przejść z poziomu `level` na `level + 1` */
export const xpToNext = (c: GameConfig, level: number) => Math.round(c.progression.xp_base * level ** c.progression.xp_exp);

/** Dolicza XP; zwraca nowy poziom, XP i zdobyte punkty statystyk (xp to suma, nie "w poziomie"). */
export function addXp(c: GameConfig, level: number, xpInLevel: number, gained: number) {
  let lvl = level;
  let xp = xpInLevel + gained;
  let points = 0;
  while (lvl < c.progression.max_level && xp >= xpToNext(c, lvl)) {
    xp -= xpToNext(c, lvl);
    lvl++;
    points += c.progression.points_per_level;
  }
  if (lvl >= c.progression.max_level) xp = 0;
  return { level: lvl, xpInLevel: xp, points };
}

export interface DiveOutcome {
  success: boolean;
  chance: number;
  ore: number;
  tokens: number;
  samples: number;
  materials: Record<string, number>;
  xp: number;
  /** ile ubyło z puli strefy */
  poolDraw: number;
  /** mnożnik zdrowia puli użyty do nagrody */
  poolHealth: number;
}

/**
 * Deterministyczne rozstrzygnięcie zjazdu (RNG z ziarna zapisanego przy starcie).
 * Nagroda rudy skalowana zdrowiem WSPÓLNEJ puli strefy: max(floor, pozostało/całość).
 * Powyżej podłogi pula ubywa o przyznaną rudę, poniżej – "ślady" bez ubywania.
 */
export function resolveDive(c: GameConfig, route: Route, stats: Stats, oreMultiplier: number, seed: number, pool: { remaining: number; total: number }, itemBonus = 0, samplesMult = 1, richness: Record<string, number> = {}): DiveOutcome {
  const r = rng(seed);
  const chance = diveChance(stats, route.difficulty, itemBonus);
  const success = r() < chance;
  const uOre = r();
  const uTok = r();
  const uSmp = r();
  const uMat = c.geology.materials.map(() => r()); // na końcu, by nie zmieniać wcześniejszych losowań // dolosowywane na końcu, by nie zmieniać wyników wcześniejszych losowań
  const floor = c.dives.pool_floor_fraction;
  const health = pool.total > 0 ? Math.max(floor, pool.remaining / pool.total) : floor;
  const frac = success ? 1 : c.dives.fail_reward_fraction;
  const rw = routeRewards(c, route);
  const baseOre = (rw.oreMin + (rw.oreMax - rw.oreMin) * uOre) * oreMultiplier * frac;
  const ore = Math.round(baseOre * health);
  const aboveFloor = pool.remaining - floor * pool.total;
  const poolDraw = aboveFloor > 0 ? Math.min(ore, aboveFloor) : 0;
  const tokens = success ? Math.round(route.tokens[0] + (route.tokens[1] - route.tokens[0]) * uTok) : 0;
  const samples = success ? Math.round((route.samples[0] + (route.samples[1] - route.samples[0]) * uSmp) * samplesMult) : 0;
  const materials: Record<string, number> = {};
  if (route.min_level >= c.geology.min_route_level) {
    const hours = route.seconds / 3600;
    c.geology.materials.forEach((m, i) => {
      const e = hours * c.geology.mat_per_hour * route.reward_mult * (richness[m] ?? 0) * frac;
      const n = Math.floor(e) + (uMat[i]! < e - Math.floor(e) ? 1 : 0);
      if (n > 0) materials[m] = n;
    });
  }
  return { success, chance, ore, tokens, samples, materials, xp: Math.round(rw.xp * frac), poolDraw, poolHealth: health };
}

/** Efektywność nagrody: krótkie trasy płacą więcej za minutę (1 + short_bonus przy najkrótszej, 1.0 przy najdłuższej). */
export function efficiency(c: GameConfig, minutes: number): number {
  const e = c.dives.economy;
  const x = Math.log(e.reference_minutes / Math.max(minutes, e.min_route_minutes)) / Math.log(e.reference_minutes / e.min_route_minutes);
  return 1 + e.short_bonus * Math.min(1, Math.max(0, x));
}

/** Średnia nagroda trasy (przy pełnej puli, bez bonusów archetypu) */
export function routeRewards(c: GameConfig, route: Route) {
  const minutes = route.seconds / 60;
  const eff = efficiency(c, minutes);
  const ore = c.dives.economy.ore_per_min * minutes * eff * route.reward_mult;
  const sp = c.dives.economy.spread;
  return { oreAvg: ore, oreMin: ore * (1 - sp), oreMax: ore * (1 + sp), xp: Math.round(c.dives.economy.xp_per_min * minutes * eff * route.reward_mult), orePerHour: (ore / minutes) * 60 };
}

/** Całkowita pula strefy dla danej liczby graczy (każdy silos dokłada swój udział). */
export const poolTotal = (c: GameConfig, zone: string, players: number) => c.dives.zones[zone]!.pool_per_player * players;

/** Regeneracja wspólnej puli strefy: odnawia `regen_per_day` całkowitej puli na dobę, do pełna. */
export function regenPool(c: GameConfig, zone: string, remaining: number, total: number, dtMs: number): number {
  const rate = c.dives.zones[zone]?.regen_per_day ?? 0;
  if (rate <= 0 || dtMs <= 0) return remaining;
  return Math.min(total, remaining + total * rate * (dtMs / 86_400_000));
}
