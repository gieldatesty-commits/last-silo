import type { GameConfig } from '../config.js';
import { rng } from './rng.js';
import { npcPrice } from './market.js';
import { ambushChance, shipMinutes } from './caravan.js';

export const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const NAMES = ['Faktoria Żelazna', 'Faktoria Szara', 'Faktoria Ostatnia', 'Faktoria Kamienna', 'Faktoria Cicha', 'Faktoria Głucha', 'Faktoria Rdzawa', 'Faktoria Wysoka'];

export interface Offer {
  slot: number;
  name: string;
  material: string;
  qty: number;
  km: number;
  sector: (typeof SECTORS)[number];
  unitReward: number;
  minutes: number;
  ambushChance: number;
}

/** Doba (UTC) jako numer, wspólna dla serwera i symulacji. */
export const dayIndex = (ms: number) => Math.floor(ms / 86_400_000);

/** Ile ofert jest na tablicy w dobie przy danej liczbie graczy. */
export const offerCount = (c: GameConfig, players: number) => Math.max(c.contracts.min_offers, Math.ceil(players * c.contracts.offers_per_player));

/** Wspólna tablica ofert na dobę: deterministyczna (ziarno świata + doba + slot), więc bez zapisu w bazie. */
export function genOffers(c: GameConfig, day: number, players: number): Offer[] {
  const out: Offer[] = [];
  for (let slot = 0; slot < offerCount(c, players); slot++) {
    const r = rng(((c.contracts.seed * 1_000_003) ^ (day * 131 + slot * 7919)) >>> 0);
    const material = c.geology.materials[Math.floor(r() * c.geology.materials.length)]!;
    const [q0, q1] = c.contracts.qty;
    const qty = q0 + Math.floor(r() * (q1 - q0 + 1));
    const [k0, k1] = c.contracts.km;
    const steps = Math.floor((k1 - k0) / 500);
    const km = k0 + 500 * Math.floor(r() * (steps + 1));
    const sector = SECTORS[Math.floor(r() * 8)]!;
    const name = NAMES[Math.floor(r() * NAMES.length)]!;
    const unitReward = Math.round((npcPrice(c, material) ?? 0) * (c.contracts.reward_base + c.contracts.reward_per_1000km * (km / 1000)));
    out.push({ slot, name, material, qty, km, sector, unitReward, minutes: Math.round(shipMinutes(c, km)), ambushChance: ambushChance(c, km) });
  }
  return out;
}
