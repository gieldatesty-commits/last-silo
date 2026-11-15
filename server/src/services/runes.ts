import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import type { GameConfig } from '../config.js';
import { applyLedger, InsufficientFunds, walletBalance } from '../ledger.js';
import { allRuneIds, parseRune, runeCraftCost } from '../game/runes.js';
import { GameError, settle, type Ctx } from './silo.js';
import { radioLevel } from './items.js';

type Trx = Transaction<Database>;

async function workshopLevel(db: Trx | Ctx['db'], userId: string): Promise<number> {
  return (await db.selectFrom('buildings').select('level').where('user_id', '=', userId).where('type', '=', 'warsztat').executeTakeFirst())?.level ?? 1;
}

/** Runy w portfelu gracza (tylko niezerowe). */
export async function runeWallet(db: Trx | Ctx['db'], cfg: GameConfig, userId: string): Promise<Record<string, number>> {
  const ids = allRuneIds(cfg);
  const rows = await db.selectFrom('wallets').select(['resource', 'balance']).where('user_id', '=', userId).where('resource', 'in', ids).execute();
  return Object.fromEntries(rows.filter((r) => Number(r.balance) > 0).map((r) => [r.resource, Number(r.balance)]));
}

/** Receptury run I–II z blokadą wg Warsztatu i Radia (do GET /items). */
export async function runeRecipes(db: Trx | Ctx['db'], cfg: GameConfig, userId: string) {
  const wl = await workshopLevel(db, userId);
  const rl = await radioLevel(db as never, userId);
  return allRuneIds(cfg).flatMap((id) => {
    const cost = runeCraftCost(cfg, id);
    const r = parseRune(cfg, id)!;
    return cost ? [{ id, kind: r.kind, level: r.level, name: r.name, effect: r.effect, value: r.value, ...cost, locked: wl < cost.workshop || rl < cost.radio }] : [];
  });
}

/** Wytworzenie runy I–II: koszt (ruda, żetony, materiał) i +1 runa przez dziennik. */
export async function craftRuneTx(trx: Trx, ctx: Ctx, userId: string, id: string) {
  const cfg = ctx.config;
  if (!parseRune(cfg, id)) throw new GameError(400, 'unknown_rune');
  const cost = runeCraftCost(cfg, id);
  if (!cost) throw new GameError(409, 'rune_not_craftable');
  await settle(trx, cfg, userId, ctx.now());
  if ((await workshopLevel(trx, userId)) < cost.workshop) throw new GameError(409, 'workshop_too_low');
  if ((await radioLevel(trx, userId)) < cost.radio) throw new GameError(409, 'radio_too_low');
  const n = (await walletBalance(trx, userId, id)) + 1;
  // ref unikalny na każde wytworzenie (dziennik pomija powtórzony ref; powtórki żądań łapie warstwa idempotencji)
  const ref = `rune:${id}:${randomUUID()}`;
  try {
    await applyLedger(
      trx,
      userId,
      [
        ...(cost.ore > 0 ? [{ resource: 'ore', delta: -cost.ore, reason: 'rune_craft_cost' as const, ref }] : []),
        ...(cost.tokens > 0 ? [{ resource: 'tokens', delta: -cost.tokens, reason: 'rune_craft_cost' as const, ref: `${ref}:tokens` }] : []),
        ...Object.entries(cost.materials).map(([m, q]) => ({ resource: m, delta: -q, reason: 'rune_craft_cost' as const, ref: `${ref}:mat:${m}` })),
        { resource: id, delta: 1, reason: 'rune_craft', ref },
      ],
      cfg.version,
    );
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, `insufficient_${e.resource}`);
    throw e;
  }
  await trx.insertInto('events_log').values({ user_id: userId, name: 'rune_crafted', props: JSON.stringify({ runeId: id }) }).execute();
  return { runeId: id, count: n };
}
