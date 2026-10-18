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
export function resolveDive(c: GameConfig, route: Route, stats: Stats, oreMultiplier: number, seed: number, pool: { remaining: number; total: number }): DiveOutcome {
  const r = rng(seed);
  const chance = diveChance(stats, route.difficulty);
  const success = r() < chance;
  const uOre = r();
  const uTok = r();
  const floor = c.dives.pool_floor_fraction;
  const health = Math.max(floor, pool.remaining / pool.total);
  const frac = success ? 1 : c.dives.fail_reward_fraction;
  const baseOre = (route.ore[0] + (route.ore[1] - route.ore[0]) * uOre) * oreMultiplier * frac;
  const ore = Math.round(baseOre * health);
  const aboveFloor = pool.remaining - floor * pool.total;
  const poolDraw = aboveFloor > 0 ? Math.min(ore, aboveFloor) : 0;
  const tokens = success ? Math.round(route.tokens[0] + (route.tokens[1] - route.tokens[0]) * uTok) : 0;
  return { success, chance, ore, tokens, xp: Math.round(route.xp * frac), poolDraw, poolHealth: health };
}

export const poolTotal = (c: GameConfig, route: Route) => route.pool_per_player * c.world.expected_players;
