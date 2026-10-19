import { sql, type Selectable, type Transaction } from 'kysely';
import type { Database } from '../db.js';
import { applyLedger, InsufficientFunds, type LedgerEntry } from '../ledger.js';
import { botBid, marketFee, npcPrice, priceCorridor } from '../game/market.js';
import { radioLevel } from './items.js';
import { GameError, settle, type Ctx } from './silo.js';

type Trx = Transaction<Database>;
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function guard(trx: Trx, ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  await settle(trx, cfg, userId, ctx.now());
  const p = await trx.selectFrom('players').select('level').where('user_id', '=', userId).executeTakeFirst();
  if (!p) throw new GameError(409, 'no_player');
  if (p.level < cfg.market.min_level) throw new GameError(409, 'level_too_low');
  if ((await radioLevel(trx, userId)) < cfg.market.radio) throw new GameError(409, 'radio_too_low');
}

async function ledger(trx: Trx, ctx: Ctx, userId: string, entries: LedgerEntry[]) {
  try {
    await applyLedger(trx, userId, entries, ctx.config.version);
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, `insufficient_${e.resource}`);
    throw e;
  }
}

/** Wygasłe wystawienia wracają do sprzedającego (leniwie, partiami; bezpieczne przy równoległych wywołaniach). */
async function sweepExpired(trx: Trx, ctx: Ctx) {
  const now = ctx.now();
  const due = await trx.selectFrom('market_listings').selectAll().where('state', '=', 'active').where('expires_at', '<=', now).orderBy('id').limit(50).forUpdate().skipLocked().execute();
  for (const l of due) {
    if (l.qty > 0) await ledger(trx, ctx, l.seller_id, [{ resource: l.material, delta: l.qty, reason: 'market_return', ref: `listing:${l.id}:return` }]);
    await trx.updateTable('market_listings').set({ state: 'expired' }).where('id', '=', l.id).execute();
  }
}

const listingView = (l: Selectable<Database['market_listings']>, nickname: string | null, userId: string) => ({
  id: String(l.id),
  material: l.material,
  qty: l.qty,
  unitPrice: l.unit_price,
  expiresAt: l.expires_at,
  seller: nickname,
  mine: l.seller_id === userId,
});

function checkMaterial(ctx: Ctx, material: string) {
  if (!ctx.config.geology.materials.includes(material)) throw new GameError(400, 'unknown_material');
}

/** Ceny, korytarze, średnia z 7 dni, wolumen, najlepsza oferta i pozostały dzienny limit sprzedaży botom. */
export async function marketOverview(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await guard(trx, ctx, userId);
    await sweepExpired(trx, ctx);
    const since = new Date(now.getTime() - 7 * DAY);
    const stats = await trx
      .selectFrom('market_trades')
      .select(['material', sql<string>`sum(gross)`.as('gross'), sql<string>`sum(qty)`.as('qty')])
      .where('buyer_id', 'is not', null)
      .where('created_at', '>', since)
      .groupBy('material')
      .execute();
    const asks = await trx
      .selectFrom('market_listings')
      .select(['material', sql<number>`min(unit_price)`.as('best')])
      .where('state', '=', 'active')
      .where('expires_at', '>', now)
      .where('qty', '>', 0)
      .groupBy('material')
      .execute();
    const botSold = await trx
      .selectFrom('market_trades')
      .select(['material', sql<string>`sum(qty)`.as('qty')])
      .where('buyer_id', 'is', null)
      .where('seller_id', '=', userId)
      .where('created_at', '>', new Date(now.getTime() - DAY))
      .groupBy('material')
      .execute();
    const soldToday = botSold.reduce((s, r) => s + Number(r.qty), 0);
    return {
      fee: cfg.market.fee,
      maxActive: cfg.market.max_active,
      maxQty: cfg.market.max_qty,
      listingHours: cfg.market.listing_hours,
      botDailyLeft: Math.max(0, cfg.market.bot_daily_qty - soldToday),
      materials: cfg.geology.materials.map((m) => {
        const st = stats.find((s) => s.material === m);
        const c = priceCorridor(cfg, m)!;
        return {
          id: m,
          name: cfg.resources.find((r) => r.id === m)!.name,
          npcPrice: npcPrice(cfg, m),
          botBid: botBid(cfg, m),
          corridor: c,
          avg7d: st && Number(st.qty) > 0 ? Math.round(Number(st.gross) / Number(st.qty)) : null,
          volume7d: st ? Number(st.qty) : 0,
          bestAsk: asks.find((a) => a.material === m)?.best ?? null,
        };
      }),
    };
  });
}

export async function listListings(ctx: Ctx, userId: string, material?: string) {
  if (material) checkMaterial(ctx, material);
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await guard(trx, ctx, userId);
    await sweepExpired(trx, ctx);
    let q = trx
      .selectFrom('market_listings as l')
      .innerJoin('players as p', 'p.user_id', 'l.seller_id')
      .select(['l.id', 'l.seller_id', 'l.material', 'l.qty', 'l.qty_initial', 'l.unit_price', 'l.state', 'l.created_at', 'l.expires_at', 'p.nickname'])
      .where('l.state', '=', 'active')
      .where('l.expires_at', '>', now)
      .where('l.qty', '>', 0);
    if (material) q = q.where('l.material', '=', material);
    const rows = await q.orderBy('l.unit_price').orderBy('l.id').limit(50).execute();
    return { listings: rows.map((r) => listingView(r as never, r.nickname, userId)) };
  });
}

export async function myMarket(ctx: Ctx, userId: string) {
  return ctx.db.transaction().execute(async (trx) => {
    await guard(trx, ctx, userId);
    await sweepExpired(trx, ctx);
    const mine = await trx.selectFrom('market_listings').selectAll().where('seller_id', '=', userId).where('state', '=', 'active').orderBy('id').execute();
    const trades = await trx
      .selectFrom('market_trades')
      .selectAll()
      .where((eb) => eb.or([eb('seller_id', '=', userId), eb('buyer_id', '=', userId)]))
      .orderBy('id', 'desc')
      .limit(20)
      .execute();
    return {
      listings: mine.map((l) => listingView(l, null, userId)),
      trades: trades.map((t) => ({
        id: String(t.id),
        material: t.material,
        qty: t.qty,
        unitPrice: t.unit_price,
        side: t.seller_id === userId ? ('sold' as const) : ('bought' as const),
        counterparty: t.buyer_id === null ? 'bot' : 'gracz',
        gross: Number(t.gross),
        fee: t.seller_id === userId ? Number(t.fee) : 0,
        at: t.created_at,
      })),
    };
  });
}

export async function createListingTx(trx: Trx, ctx: Ctx, userId: string, input: { material: string; qty: number; unitPrice: number }) {
  const cfg = ctx.config;
  checkMaterial(ctx, input.material);
  await guard(trx, ctx, userId);
  await sweepExpired(trx, ctx);
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > cfg.market.max_qty) throw new GameError(400, 'bad_qty');
  const c = priceCorridor(cfg, input.material)!;
  if (!Number.isInteger(input.unitPrice) || input.unitPrice < c.min || input.unitPrice > c.max) throw new GameError(400, 'price_out_of_range');
  const active = await trx.selectFrom('market_listings').select((e) => e.fn.countAll<string>().as('n')).where('seller_id', '=', userId).where('state', '=', 'active').executeTakeFirstOrThrow();
  if (Number(active.n) >= cfg.market.max_active) throw new GameError(409, 'too_many_listings');
  const now = ctx.now();
  const l = await trx
    .insertInto('market_listings')
    .values({ seller_id: userId, material: input.material, qty: input.qty, qty_initial: input.qty, unit_price: input.unitPrice, created_at: now, expires_at: new Date(now.getTime() + cfg.market.listing_hours * HOUR) })
    .returningAll()
    .executeTakeFirstOrThrow();
  // depozyt: towar opuszcza portfel do czasu sprzedaży, zwrotu lub wygaśnięcia
  await ledger(trx, ctx, userId, [{ resource: input.material, delta: -input.qty, reason: 'market_listing', ref: `listing:${l.id}` }]);
  await trx.insertInto('events_log').values({ user_id: userId, name: 'market_listed', props: JSON.stringify({ material: input.material, qty: input.qty, unitPrice: input.unitPrice }) }).execute();
  return listingView(l, null, userId);
}

export async function cancelListingTx(trx: Trx, ctx: Ctx, userId: string, id: string) {
  if (!/^\d+$/.test(id)) throw new GameError(404, 'no_listing');
  await guard(trx, ctx, userId);
  const l = await trx.selectFrom('market_listings').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!l || l.seller_id !== userId) throw new GameError(404, 'no_listing');
  if (l.state !== 'active') throw new GameError(409, 'listing_closed');
  if (l.qty > 0) await ledger(trx, ctx, userId, [{ resource: l.material, delta: l.qty, reason: 'market_return', ref: `listing:${l.id}:return` }]);
  await trx.updateTable('market_listings').set({ state: 'cancelled' }).where('id', '=', id).execute();
  return { id, returned: l.qty, material: l.material };
}

/** Kupno z wystawienia (całość lub część). Sprzedający dostaje cenę minus prowizję (prowizja znika z gry). */
export async function buyListingTx(trx: Trx, ctx: Ctx, userId: string, id: string, qty: number) {
  const cfg = ctx.config;
  if (!/^\d+$/.test(id)) throw new GameError(404, 'no_listing');
  await guard(trx, ctx, userId);
  await sweepExpired(trx, ctx);
  const l = await trx.selectFrom('market_listings').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!l) throw new GameError(404, 'no_listing');
  if (l.state !== 'active' || l.expires_at <= ctx.now()) throw new GameError(409, 'listing_closed');
  if (l.seller_id === userId) throw new GameError(409, 'own_listing');
  if (!Number.isInteger(qty) || qty < 1) throw new GameError(400, 'bad_qty');
  if (qty > l.qty) throw new GameError(409, 'not_enough_qty');
  const gross = qty * l.unit_price;
  const fee = marketFee(cfg, gross);
  const trade = await trx
    .insertInto('market_trades')
    .values({ listing_id: l.id, buyer_id: userId, seller_id: l.seller_id, material: l.material, qty, unit_price: l.unit_price, gross, fee, created_at: ctx.now() })
    .returning('id')
    .executeTakeFirstOrThrow();
  const ref = `trade:${trade.id}`;
  const buyerEntries: LedgerEntry[] = [
    { resource: 'ore', delta: -gross, reason: 'market_purchase', ref },
    { resource: l.material, delta: qty, reason: 'market_purchase', ref: `${ref}:mat` },
  ];
  const sellerEntries: LedgerEntry[] = [
    { resource: 'ore', delta: gross, reason: 'market_sale', ref },
    ...(fee > 0 ? [{ resource: 'ore', delta: -fee, reason: 'market_fee' as const, ref }] : []),
  ];
  // stała kolejność blokad portfeli (po id użytkownika) – brak zakleszczeń przy wzajemnych zakupach
  const steps: [string, LedgerEntry[]][] = [[userId, buyerEntries], [l.seller_id, sellerEntries]];
  steps.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [uid, entries] of steps) await ledger(trx, ctx, uid, entries);
  const left = l.qty - qty;
  await trx.updateTable('market_listings').set({ qty: left, state: left === 0 ? 'sold' : 'active' }).where('id', '=', id).execute();
  await trx.insertInto('events_log').values({ user_id: userId, name: 'market_bought', props: JSON.stringify({ material: l.material, qty, unitPrice: l.unit_price }) }).execute();
  return { listingId: id, material: l.material, qty, unitPrice: l.unit_price, paid: gross, fee };
}

/** Bot podłogi cen: kupuje materiały od gracza po niskiej, stałej cenie, w dziennym limicie. Zapewnia wyjście także przy małym rynku. */
export async function sellToBotTx(trx: Trx, ctx: Ctx, userId: string, material: string, qty: number) {
  const cfg = ctx.config;
  checkMaterial(ctx, material);
  await guard(trx, ctx, userId);
  if (!Number.isInteger(qty) || qty < 1) throw new GameError(400, 'bad_qty');
  const now = ctx.now();
  const sold = await trx
    .selectFrom('market_trades')
    .select(sql<string>`coalesce(sum(qty), 0)`.as('qty'))
    .where('buyer_id', 'is', null)
    .where('seller_id', '=', userId)
    .where('created_at', '>', new Date(now.getTime() - DAY))
    .executeTakeFirstOrThrow();
  if (Number(sold.qty) + qty > cfg.market.bot_daily_qty) throw new GameError(409, 'bot_daily_limit');
  const price = botBid(cfg, material)!;
  const gross = price * qty;
  const trade = await trx.insertInto('market_trades').values({ listing_id: null, buyer_id: null, seller_id: userId, material, qty, unit_price: price, gross, fee: 0, created_at: now }).returning('id').executeTakeFirstOrThrow();
  await ledger(trx, ctx, userId, [
    { resource: material, delta: -qty, reason: 'market_sale', ref: `bot:${trade.id}:mat` },
    { resource: 'ore', delta: gross, reason: 'market_sale', ref: `bot:${trade.id}` },
  ]);
  await trx.insertInto('events_log').values({ user_id: userId, name: 'market_bot_sale', props: JSON.stringify({ material, qty, unitPrice: price }) }).execute();
  return { material, qty, unitPrice: price, received: gross };
}
