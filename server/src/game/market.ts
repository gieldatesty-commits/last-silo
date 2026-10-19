import type { GameConfig } from '../config.js';

/** Cena NPC (sufit) i oferta bota podłogi (dół) dla materiału, w rudzie za sztukę. */
export const npcPrice = (c: GameConfig, material: string) => c.exchange.buy_ore[material];
export const botBid = (c: GameConfig, material: string) => {
  const p = npcPrice(c, material);
  return p === undefined ? undefined : Math.max(1, Math.floor(p * c.market.bot_bid_fraction));
};
/** Dozwolony korytarz ceny wystawienia: od oferty bota do ceny NPC (po co ktoś miałby kupować drożej niż u NPC). */
export const priceCorridor = (c: GameConfig, material: string) => {
  const hi = npcPrice(c, material);
  const lo = botBid(c, material);
  return hi === undefined || lo === undefined ? undefined : { min: lo, max: hi };
};
/** Prowizja od sprzedaży graczowi (zaokrąglana w dół, ale co najmniej 1 przy dodatniej stawce). */
export const marketFee = (c: GameConfig, gross: number) => (c.market.fee > 0 ? Math.max(1, Math.floor(gross * c.market.fee)) : 0);
