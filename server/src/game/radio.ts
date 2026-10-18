import type { GameConfig } from '../config.js';
import { defenseBonus } from './formulas.js';
import { distanceKm, type LatLon } from './world.js';

export const hasReceiver = (c: GameConfig, level: number) => level >= c.radio.levels.receiver;
export const hasTransmitter = (c: GameConfig, level: number) => level >= c.radio.levels.transmitter;
export const hasCipher = (c: GameConfig, level: number) => level >= c.radio.levels.cipher;
export const hasRelays = (c: GameConfig, level: number) => level >= c.radio.levels.relays;

/** Zasięg nasłuchu w km (0 bez Odbiornika). */
export const listenRangeKm = (c: GameConfig, level: number) => (hasReceiver(c, level) ? c.radio.r0_km * c.radio.range_growth ** (level - c.radio.levels.receiver) : 0);

export const isBroadcasting = (c: GameConfig, level: number, on: boolean) => on && hasTransmitter(c, level);

/** Czy słuchacz (poziom radia `listenerLevel`) słyszy nadającego (poziom `targetLevel`) z danej odległości? */
export function audible(c: GameConfig, listenerLevel: number, targetLevel: number, km: number): boolean {
  const reach = listenRangeKm(c, listenerLevel) * (hasCipher(c, targetLevel) ? 1 - c.radio.cipher_range_reduction : 1);
  return reach > 0 && km <= reach;
}

export const travelMinutes = (c: GameConfig, km: number) => Math.min(c.radio.travel_max, Math.max(c.radio.travel_min, km / c.radio.speed_km_per_min));

export const distanceBand = (c: GameConfig, km: number) => Math.max(c.radio.distance_band_km, Math.round(km / c.radio.distance_band_km) * c.radio.distance_band_km);

const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function bearingSector(from: LatLon, to: LatLon): (typeof SECTORS)[number] {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLon = r(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(r(to.lat));
  const x = Math.cos(r(from.lat)) * Math.sin(r(to.lat)) - Math.sin(r(from.lat)) * Math.cos(r(to.lat)) * Math.cos(dLon);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return SECTORS[Math.round(deg / 45) % 8]!;
}

export interface FightStats {
  sila: number;
  percepcja: number;
  wytrwalosc: number;
}
export const attackPower = (s: FightStats) => s.sila + 0.4 * s.percepcja;
export const defensePower = (c: GameConfig, s: FightStats, wartowniaLevel: number) => s.wytrwalosc + defenseBonus(c, wartowniaLevel);

/** P(wygrana atakującego) = 1 / (1 + exp(−3·ln(A/D))) */
export function raidWinChance(a: number, d: number): number {
  if (a <= 0) return 0;
  if (d <= 0) return 1;
  return 1 / (1 + Math.exp(-3 * Math.log(a / d)));
}

/** Ogólna "moc" gracza do dobierania lig: suma statystyk + 2 × suma poziomów budynków. */
export const playerPower = (s: { sila: number; technika: number; percepcja: number; wytrwalosc: number }, levels: Record<string, number>) =>
  s.sila + s.technika + s.percepcja + s.wytrwalosc + 2 * Object.values(levels).reduce((a, b) => a + b, 0);

export const inLeague = (c: GameConfig, mine: number, theirs: number) => Math.abs(theirs - mine) <= c.raids.league_tolerance * mine;

export { distanceKm };
