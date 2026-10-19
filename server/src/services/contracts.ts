import type { Transaction } from 'kysely';
import { randomInt } from 'node:crypto';
import type { Database } from '../db.js';
import type { GameConfig } from '../config.js';
import { applyLedger, InsufficientFunds, type LedgerEntry } from '../ledger.js';
import { rng } from '../game/rng.js';
import { insuranceFee, survivingQty } from '../game/caravan.js';
import { dayIndex, genOffers, offerCount } from '../game/contracts.js';
import { npcPrice } from '../game/market.js';
import { radioLevel } from './items.js';
import { GameError, settle, type Ctx } from './silo.js';

type Trx = Transaction<Database>;

/** Zlecenia, które dotarły: zasadzka z ziarna (ubezpieczone nic nie traci); nagroda za dostarczone sztuki. Wołane z `settle`. */
export async function resolveDueContracts(trx: Trx, cfg: GameConfig, userId: string, now: Date): Promise<void> {
  const due = await trx.selectFrom('contracts').selectAll().where('user_id', '=', userId).where('state', '=', 'transit').where('arrives_at', '<=', now).orderBy('arrives_at').orderBy('id').forUpdate().execute();
  for (const c of due) {
    const hit = rng(c.seed)() < c.ambush_chance;
    const lost = hit && !c.insured;
    const qty = lost ? survivingQty(cfg, c.qty) : c.qty;
    const reward = qty * c.unit_reward;
    if (reward > 0) await applyLedger(trx, userId, [{ resource: 'ore', delta: reward, reason: 'contract_reward', ref: `contract:${c.id}` }], cfg.version);
    const short = lost && qty < c.qty;
    await trx.updateTable('contracts').set({ state: short ? 'ambushed' : 'delivered', delivered_qty: qty, reward }).where('id', '=', c.id).execute();
    await trx.insertInto('events_log').values({ user_id: userId, name: short ? 'contract_ambushed' : 'contract_delivered', props: JSON.stringify({ contractId: c.id, material: c.material, qty: c.qty, delivered: qty, reward }) }).execute();
  }
}

async function guard(trx: Trx, ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  await settle(trx, cfg, userId, ctx.now());
  const p = await trx.selectFrom('players').select('level').where('user_id', '=', userId).executeTakeFirst();
  if (!p) throw new GameError(409, 'no_player');
  if (p.level < cfg.contracts.min_level) throw new GameError(409, 'level_too_low');
  if ((await radioLevel(trx, userId)) < cfg.contracts.radio) throw new GameError(409, 'radio_too_low');
}

async function countPlayers(trx: Trx): Promise<number> {
  const r = await trx.selectFrom('players').select((e) => e.fn.countAll<string>().as('n')).where('silo_lat', 'is not', null).executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Dzisiejsza tablica ofert, przyjęte zlecenia w drodze i ostatnie wyniki. */
export async function listContracts(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  const day = dayIndex(now.getTime());
  return ctx.db.transaction().execute(async (trx) => {
    await guard(trx, ctx, userId);
    const players = await countPlayers(trx);
    const taken = await trx.selectFrom('contracts').selectAll().where('user_id', '=', userId).orderBy('id', 'desc').limit(30).execute();
    const todayRows = await trx.selectFrom('contracts').select(['slot', 'user_id']).where('day', '=', day).execute();
    const bySlot = new Map(todayRows.map((r) => [r.slot, r.user_id]));
    const offers = genOffers(cfg, day, players).map((o) => ({ ...o, day, status: !bySlot.has(o.slot) ? ('open' as const) : bySlot.get(o.slot) === userId ? ('mine' as const) : ('taken' as const), totalReward: o.qty * o.unitReward, ambushChance: Math.round(o.ambushChance * 1000) / 10 }));
    const active = taken.filter((t) => t.state === 'transit').length;
    return {
      day,
      offers,
      maxActive: cfg.contracts.max_active,
      active,
      contracts: taken.map((t) => ({
        id: String(t.id),
        material: t.material,
        qty: t.qty,
        distanceKm: t.km,
        sector: t.sector,
        state: t.state,
        insured: t.insured,
        deliveredQty: t.delivered_qty,
        reward: t.reward === null ? null : Number(t.reward),
        arrivesAt: t.arrives_at,
        etaMinutes: t.state === 'transit' ? Math.max(0, Math.ceil((t.arrives_at.getTime() - now.getTime()) / 60_000)) : 0,
      })),
    };
  });
}

/** Przyjęcie zlecenia: ładunek schodzi z portfela, karawana rusza; nagroda przy dotarciu. */
export async function acceptContractTx(trx: Trx, ctx: Ctx, userId: string, day: number, slot: number, insure: boolean) {
  const cfg = ctx.config;
  const now = ctx.now();
  await guard(trx, ctx, userId);
  if (day !== dayIndex(now.getTime())) throw new GameError(409, 'offer_expired');
  const players = await countPlayers(trx);
  if (!Number.isInteger(slot) || slot < 0 || slot >= offerCount(cfg, players)) throw new GameError(404, 'no_offer');
  const o = genOffers(cfg, day, players)[slot]!;
  const active = await trx.selectFrom('contracts').select((e) => e.fn.countAll<string>().as('n')).where('user_id', '=', userId).where('state', '=', 'transit').executeTakeFirstOrThrow();
  if (Number(active.n) >= cfg.contracts.max_active) throw new GameError(409, 'too_many_contracts');
  const exists = await trx.selectFrom('contracts').select('user_id').where('day', '=', day).where('slot', '=', slot).executeTakeFirst();
  if (exists) throw new GameError(409, exists.user_id === userId ? 'already_accepted' : 'offer_taken');
  const insFee = insure ? insuranceFee(cfg, o.qty * (npcPrice(cfg, o.material) ?? 0)) : 0;
  const cseed = ctx.seed ? ctx.seed() : randomInt(1, 2 ** 31);
  const row = await trx
    .insertInto('contracts')
    .onConflict((oc) => oc.columns(['day', 'slot']).doNothing())
    .values({ user_id: userId, day, slot, material: o.material, qty: o.qty, km: o.km, sector: o.sector, unit_reward: o.unitReward, insured: insure, insurance_fee: insFee, seed: cseed, ambush_chance: o.ambushChance, accepted_at: now, arrives_at: new Date(now.getTime() + o.minutes * 60_000) })
    .returning(['id', 'arrives_at'])
    .executeTakeFirst();
  if (!row) throw new GameError(409, 'offer_taken');
  const entries: LedgerEntry[] = [
    { resource: o.material, delta: -o.qty, reason: 'contract_cargo', ref: `contract:${row.id}` },
    ...(insFee > 0 ? [{ resource: 'ore', delta: -insFee, reason: 'caravan_fee' as const, ref: `contract:${row.id}:ins` }] : []),
  ];
  try {
    await applyLedger(trx, userId, entries, cfg.version);
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, `insufficient_${e.resource}`);
    throw e;
  }
  await trx.insertInto('events_log').values({ user_id: userId, name: 'contract_accepted', props: JSON.stringify({ material: o.material, qty: o.qty, km: o.km }) }).execute();
  return { contractId: String(row.id), material: o.material, qty: o.qty, destination: o.name, sector: o.sector, distanceKm: o.km, unitReward: o.unitReward, totalReward: o.qty * o.unitReward, insured: insure, insuranceFee: insFee, ambushChance: Math.round(o.ambushChance * 1000) / 10, arrivesAt: row.arrives_at };
}
