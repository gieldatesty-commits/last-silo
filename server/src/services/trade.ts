import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { applyLedger, InsufficientFunds } from '../ledger.js';
import { describeProfile, geologyProfile } from '../game/geology.js';
import { GameError, settle, type Ctx } from './silo.js';
import { radioLevel } from './items.js';

type Trx = Transaction<Database>;

/** Jakościowy opis geologii okolicy (bez liczb): co obfituje, czego brak. */
export async function getGeology(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  await ctx.db.transaction().execute((trx) => settle(trx, cfg, userId, ctx.now()));
  const p = await ctx.db.selectFrom('players').select(['silo_lat', 'silo_lon']).where('user_id', '=', userId).executeTakeFirst();
  const s = await ctx.db.selectFrom('silos').select('seed').where('user_id', '=', userId).executeTakeFirst();
  if (!p || p.silo_lat === null || !s) throw new GameError(409, 'no_player');
  const profile = geologyProfile(cfg, { lat: p.silo_lat, lon: p.silo_lon! }, Number(s.seed));
  const d = describeProfile(cfg, profile);
  return {
    materials: cfg.geology.materials.map((m) => ({ id: m, name: cfg.resources.find((r) => r.id === m)!.name, local: d[m] })),
    exchangeRadio: cfg.exchange.radio,
  };
}

/** Handlarz Przekaźnikowy (NPC): kupno materiału za rudę po stałej cenie. Ruda ginie (ujście), materiał powstaje. */
export async function exchangeBuyTx(trx: Trx, ctx: Ctx, userId: string, material: string, qty: number) {
  const cfg = ctx.config;
  const price = cfg.exchange.buy_ore[material];
  if (!price || !cfg.geology.materials.includes(material)) throw new GameError(400, 'unknown_material');
  await settle(trx, cfg, userId, ctx.now());
  if ((await radioLevel(trx, userId)) < cfg.exchange.radio) throw new GameError(409, 'radio_too_low');
  const cost = Math.ceil(price * qty);
  try {
    // ref=null: kolejne zakupy są odrębnymi operacjami; podwójne wywołanie chroni Idempotency-Key
    await applyLedger(
      trx,
      userId,
      [
        { resource: 'ore', delta: -cost, reason: 'market_purchase' },
        { resource: material, delta: qty, reason: 'market_purchase' },
      ],
      cfg.version,
    );
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, 'insufficient_ore');
    throw e;
  }
  await trx.insertInto('events_log').values({ user_id: userId, name: 'exchange_buy', props: JSON.stringify({ material, qty, cost }) }).execute();
  return { material, qty, cost };
}
