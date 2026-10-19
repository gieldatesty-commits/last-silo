import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import type { GameConfig } from '../config.js';
import { applyLedger } from '../ledger.js';
import { rng } from '../game/rng.js';
import { survivingQty } from '../game/caravan.js';
import type { Ctx } from './silo.js';

type Trx = Transaction<Database>;

/**
 * Przesyłki kupującego, które dotarły: zasadzka rozstrzygana z ziarna (ubezpieczona nic nie traci), towar trafia do portfela.
 * Wołane z `settle`, idempotentne (ref `ship:<id>` w księdze).
 */
export async function resolveDueShipments(trx: Trx, cfg: GameConfig, userId: string, now: Date): Promise<void> {
  const due = await trx.selectFrom('shipments').selectAll().where('buyer_id', '=', userId).where('state', '=', 'transit').where('arrives_at', '<=', now).orderBy('arrives_at').orderBy('id').forUpdate().execute();
  for (const s of due) {
    const hit = rng(s.seed)() < s.ambush_chance;
    const lost = hit && !s.insured;
    const qty = lost ? survivingQty(cfg, s.qty) : s.qty;
    if (qty > 0) await applyLedger(trx, userId, [{ resource: s.material, delta: qty, reason: 'caravan_delivery', ref: `ship:${s.id}` }], cfg.version);
    await trx.updateTable('shipments').set({ state: lost && qty < s.qty ? 'ambushed' : 'delivered', delivered_qty: qty }).where('id', '=', s.id).execute();
    await trx.insertInto('events_log').values({ user_id: userId, name: lost && qty < s.qty ? 'caravan_ambushed' : 'caravan_delivered', props: JSON.stringify({ shipmentId: s.id, material: s.material, qty: s.qty, delivered: qty }) }).execute();
  }
}

/** Przesyłki w drodze i ostatnio dostarczone. */
export async function listShipments(ctx: Ctx, userId: string) {
  const { settle } = await import('./silo.js');
  return ctx.db.transaction().execute(async (trx) => {
    await settle(trx, ctx.config, userId, ctx.now());
    const rows = await trx.selectFrom('shipments').selectAll().where('buyer_id', '=', userId).orderBy('id', 'desc').limit(30).execute();
    const now = ctx.now().getTime();
    return {
      maxActive: ctx.config.caravans.max_active,
      shipments: rows.map((s) => ({
        id: String(s.id),
        material: s.material,
        qty: s.qty,
        deliveredQty: s.delivered_qty,
        state: s.state,
        insured: s.insured,
        distanceKm: s.km,
        shipFee: Number(s.ship_fee) + Number(s.insurance_fee),
        departedAt: s.departed_at,
        arrivesAt: s.arrives_at,
        etaMinutes: s.state === 'transit' ? Math.max(0, Math.ceil((s.arrives_at.getTime() - now) / 60_000)) : 0,
      })),
    };
  });
}
