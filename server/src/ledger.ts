import { sql, type Transaction } from 'kysely';
import type { Database } from './db.js';

export const LEDGER_REASONS = [
  'starting_grant',
  'production',
  'building_cost',
  'dive_cost',
  'dive_reward',
  'raid_loot',
  'raid_loss',
  'craft_cost',
  'upgrade_cost',
  'repair_cost',
  'research_cost',
  'market_listing',
  'market_return',
  'caravan_fee',
  'caravan_delivery',
  'contract_cargo',
  'contract_reward',
  'market_sale',
  'market_purchase',
  'market_fee',
  'tutorial_reward',
  'admin_adjust',
  'rune_craft',
  'rune_craft_cost',
  'rune_socket',
  'rune_unsocket',
  'rune_unsocket_fee',
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export interface LedgerEntry {
  resource: string;
  delta: number;
  reason: LedgerReason;
  /** unikalny w obrębie (gracz, powód) – chroni przed podwójnym zapisem */
  ref?: string;
}

export class InsufficientFunds extends Error {
  constructor(public resource: string) {
    super(`insufficient_funds:${resource}`);
  }
}

/**
 * JEDYNE miejsce, w którym zmienia się saldo. Dziennik jest niezmienialny, wallets to cache.
 * Zwraca false, jeśli wszystkie wpisy z `ref` już istniały (powtórzone wywołanie = brak skutku).
 */
export async function applyLedger(trx: Transaction<Database>, userId: string, entries: LedgerEntry[], configVersion: string): Promise<boolean> {
  let applied = false;
  for (const e of entries) {
    if (!Number.isInteger(e.delta) || e.delta === 0) continue;
    const ins = await trx
      .insertInto('ledger_entries')
      .values({ user_id: userId, resource: e.resource, delta: e.delta, reason: e.reason, ref: e.ref ?? null, config_version: configVersion })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!ins) continue; // duplikat ref
    applied = true;
    try {
      // UPDATE najpierw: CHECK na INSERT działa przed ON CONFLICT, więc debet istniejącego wiersza nie może iść tą drogą
      const upd = await trx
        .updateTable('wallets')
        .set({ balance: sql`balance + ${e.delta}` as never })
        .where('user_id', '=', userId)
        .where('resource', '=', e.resource)
        .executeTakeFirst();
      if (Number(upd.numUpdatedRows) === 0) {
        // brak wiersza: dodatni wpis go tworzy, ujemny łamie CHECK (balance >= 0) => brak środków
        // ON CONFLICT przy dodatnim wpisie: wyścig o pierwszy wiersz portfela nie psuje salda
        await trx
          .insertInto('wallets')
          .values({ user_id: userId, resource: e.resource, balance: e.delta as never })
          .onConflict((oc) => oc.columns(['user_id', 'resource']).doUpdateSet({ balance: sql`wallets.balance + ${e.delta}` as never }))
          .execute();
      }
    } catch (err) {
      if ((err as { code?: string }).code === '23514') throw new InsufficientFunds(e.resource);
      throw err;
    }
  }
  return applied;
}

export async function walletBalance(trx: Transaction<Database>, userId: string, resource: string): Promise<number> {
  const r = await trx.selectFrom('wallets').select('balance').where('user_id', '=', userId).where('resource', '=', resource).executeTakeFirst();
  return r ? Number(r.balance) : 0;
}

/** Audyt: porównuje cache portfeli z sumą dziennika. Pusta lista = OK. */
export async function auditLedger(trx: Transaction<Database> | import('kysely').Kysely<Database>) {
  const rows = await (trx as import('kysely').Kysely<Database>)
    .selectFrom('wallets as w')
    .leftJoin(
      (eb) => eb.selectFrom('ledger_entries').select(['user_id', 'resource']).select((e) => e.fn.sum('delta').as('total')).groupBy(['user_id', 'resource']).as('l'),
      (j) => j.onRef('l.user_id', '=', 'w.user_id').onRef('l.resource', '=', 'w.resource'),
    )
    .select(['w.user_id', 'w.resource', 'w.balance', 'l.total'])
    .execute();
  return rows.filter((r) => Number(r.balance) !== Number(r.total ?? 0));
}

/**
 * Audyt gniazd run: runy osadzone w przedmiotach (item_runes) muszą się zgadzać z dziennikiem,
 * czyli z liczbą osadzeń (rune_socket, −1 z portfela) minus wyjęć (rune_unsocket, +1) dla gracza i runy.
 */
export async function auditSockets(db: Transaction<Database> | import('kysely').Kysely<Database>) {
  const r = await sql<{ user_id: string; rune: string; socketed: number; ledger: number }>`
    WITH s AS (
      SELECT i.user_id, ir.rune_id AS rune, count(*)::int AS n
      FROM item_runes ir JOIN items i ON i.id = ir.item_id
      GROUP BY i.user_id, ir.rune_id
    ), l AS (
      SELECT user_id, resource AS rune, (-sum(delta) FILTER (WHERE reason = 'rune_socket') - coalesce(sum(delta) FILTER (WHERE reason = 'rune_unsocket'), 0))::int AS n
      FROM ledger_entries WHERE reason IN ('rune_socket', 'rune_unsocket')
      GROUP BY user_id, resource
    )
    SELECT coalesce(s.user_id, l.user_id) AS user_id, coalesce(s.rune, l.rune) AS rune, coalesce(s.n, 0) AS socketed, coalesce(l.n, 0) AS ledger
    FROM s FULL JOIN l ON l.user_id = s.user_id AND l.rune = s.rune
    WHERE coalesce(s.n, 0) <> coalesce(l.n, 0)`.execute(db);
  return r.rows;
}
