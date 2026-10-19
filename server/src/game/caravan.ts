import type { GameConfig } from '../config.js';
import { distanceBand } from './radio.js';
import { npcPrice } from './market.js';

/** Dystans rozliczeniowy: pasmo jak w radiu (nie zdradza dokładnych położeń). */
export const shipKm = (c: GameConfig, km: number) => distanceBand(c, km);

export const shipMinutes = (c: GameConfig, km: number) => Math.min(c.caravans.max_minutes, Math.max(c.caravans.min_minutes, (km / c.caravans.speed_km_per_h) * 60));

/** Opłata przewozowa za sztukę (ruda); ujście. */
export function shipFeePerUnit(c: GameConfig, material: string, km: number): number {
  const npc = npcPrice(c, material) ?? 0;
  const raw = npc * c.caravans.fee_per_1000km * (km / 1000);
  return Math.max(1, Math.min(Math.ceil(raw), Math.floor(npc * c.caravans.fee_cap)));
}

export const ambushChance = (c: GameConfig, km: number) => Math.min(c.caravans.ambush.max, c.caravans.ambush.base + c.caravans.ambush.per_1000km * (km / 1000));

export const insuranceFee = (c: GameConfig, gross: number) => (c.caravans.insurance_fee > 0 ? Math.max(1, Math.ceil(gross * c.caravans.insurance_fee)) : 0);

/** Ile sztuk dociera po zasadzce (nieubezpieczona przesyłka traci `loss_fraction`, zaokrąglone). */
export const survivingQty = (c: GameConfig, qty: number) => qty - Math.round(qty * c.caravans.ambush.loss_fraction);
