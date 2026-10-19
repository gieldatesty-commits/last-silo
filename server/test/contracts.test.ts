import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger, walletBalance } from '../src/ledger.js';
import { dayIndex, genOffers, offerCount } from '../src/game/contracts.js';
import { shipFeePerUnit, survivingQty, insuranceFee } from '../src/game/caravan.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const base = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const hostile = { ...base, caravans: { ...base.caravans, ambush: { ...base.caravans.ambush, base: 1, max: 1 } } };
const T0 = new Date('2026-04-01T10:00:00Z');
let clock = T0;
const mk = (cfg: typeof base) => buildApp({ db, config: cfg, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1 });
const app = mk(base);
const hostileApp = mk(hostile);
const hours = (h: number) => (clock = new Date(clock.getTime() + h * 3_600_000));

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE; TRUNCATE world_pools, seasons CASCADE');
  clock = T0;
});
afterAll(async () => {
  await app.close();
  await hostileApp.close();
  await db.destroy();
});

let n = 0;
let g = 0;
async function newPlayer(a = app, ready = true) {
  const reg = (await a.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await a.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Zlecenie${++n}`, archetype: 'gornik' } });
  if (ready) {
    await pool.query('UPDATE players SET level = 6 WHERE user_id = $1', [reg.userId]);
    await pool.query("UPDATE buildings SET level = 5 WHERE user_id = $1 AND type = 'radiostacja'", [reg.userId]);
  }
  return { id: reg.userId as string, h };
}
const grant = (id: string, res: Record<string, number>) =>
  db.transaction().execute((trx) => applyLedger(trx, id, Object.entries(res).map(([resource, delta]) => ({ resource, delta, reason: 'admin_adjust' as const, ref: `grant-${++g}-${resource}` })), 'test'));
let k = 0;
const post = (a: typeof app, h: Record<string, string>, path: string, payload: object = {}) => a.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': `ct-${++k}-padding` }, payload });
const bal = (id: string, r: string) => db.transaction().execute((trx) => walletBalance(trx, id, r));
const board = async (a: typeof app, h: Record<string, string>) => (await a.inject({ url: '/contracts', headers: h })).json();
const day0 = dayIndex(T0.getTime());

describe('generator ofert', () => {
  it('jest deterministyczny, mieści się w zakresach, a nagroda przewyższa cenę NPC i koszt przewozu', () => {
    const a = genOffers(base, 100, 50);
    expect(genOffers(base, 100, 50)).toEqual(a);
    expect(genOffers(base, 101, 50)).not.toEqual(a);
    expect(a).toHaveLength(offerCount(base, 50));
    for (let d = 0; d < 200; d++) {
      for (const o of genOffers(base, d, 50)) {
        expect(o.qty).toBeGreaterThanOrEqual(base.contracts.qty[0]);
        expect(o.qty).toBeLessThanOrEqual(base.contracts.qty[1]);
        expect(o.km % 500).toBe(0);
        expect(o.km).toBeGreaterThanOrEqual(base.contracts.km[0]);
        expect(o.km).toBeLessThanOrEqual(base.contracts.km[1]);
        const npc = base.exchange.buy_ore[o.material]!;
        expect(o.unitReward).toBeGreaterThan(npc);
        expect(o.unitReward).toBeGreaterThan(npc * 0.3 + shipFeePerUnit(base, o.material, o.km)); // opłaca się wobec zakupu od bota/oferty plus przewóz
      }
    }
  });
});

describe('zlecenia karawanowe', () => {
  it('wymaga poziomu i Radiostacji', async () => {
    const low = await newPlayer(app, false);
    expect((await app.inject({ url: '/contracts', headers: low.h })).json().error).toBe('level_too_low');
    await pool.query('UPDATE players SET level = 6 WHERE user_id = $1', [low.id]);
    expect((await app.inject({ url: '/contracts', headers: low.h })).json().error).toBe('radio_too_low');
  });

  it('przyjęcie zdejmuje ładunek, nagroda po dotarciu, brak dubli i wygasanie ofert', async () => {
    const p = await newPlayer();
    let b = await board(app, p.h);
    expect(b.offers).toHaveLength(3);
    const o = b.offers[0];
    await grant(p.id, { [o.material]: o.qty + 5 });

    const acc = await post(app, p.h, `/contracts/${day0}/0/accept`);
    expect(acc.statusCode).toBe(200);
    expect(acc.json()).toMatchObject({ qty: o.qty, material: o.material, totalReward: o.qty * o.unitReward });
    expect(await bal(p.id, o.material)).toBe(5);
    expect((await post(app, p.h, `/contracts/${day0}/0/accept`)).json().error).toBe('already_accepted');

    b = await board(app, p.h);
    expect(b.offers[0].status).toBe('mine');
    expect(b.active).toBe(1);

    const ore0 = await bal(p.id, 'ore');
    hours(o.minutes / 60 + 1);
    await app.inject({ url: '/silo', headers: p.h });
    expect(await bal(p.id, 'ore')).toBe(ore0 + o.qty * o.unitReward);
    await app.inject({ url: '/silo', headers: p.h });
    expect(await bal(p.id, 'ore')).toBe(ore0 + o.qty * o.unitReward); // bez dubla
    expect((await board(app, p.h)).contracts[0]).toMatchObject({ state: 'delivered', deliveredQty: o.qty, reward: o.qty * o.unitReward });

    // wczorajsza oferta wygasa
    hours(24);
    expect((await post(app, p.h, `/contracts/${day0}/1/accept`)).json().error).toBe('offer_expired');
    expect(await auditLedger(db)).toEqual([]);
  });

  it('brak ładunku cofa przyjęcie; limit zleceń w drodze', async () => {
    const p = await newPlayer();
    const o = (await board(app, p.h)).offers;
    const none = await post(app, p.h, `/contracts/${day0}/0/accept`);
    expect(none.statusCode).toBe(402);
    expect((await pool.query('SELECT count(*)::int AS n FROM contracts')).rows[0].n).toBe(0);

    const need: Record<string, number> = {};
    for (const x of o) need[x.material] = (need[x.material] ?? 0) + x.qty;
    await grant(p.id, need);
    expect((await post(app, p.h, `/contracts/${day0}/0/accept`)).statusCode).toBe(200);
    expect((await post(app, p.h, `/contracts/${day0}/1/accept`)).statusCode).toBe(200);
    expect((await post(app, p.h, `/contracts/${day0}/2/accept`)).json().error).toBe('too_many_contracts');
    expect((await post(app, p.h, `/contracts/${day0}/7/accept`)).json().error).toBe('no_offer');
  });

  it('zlecenie z wspólnej tablicy bierze tylko jeden gracz', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const o = (await board(app, a.h)).offers[0];
    await grant(a.id, { [o.material]: o.qty });
    await grant(b.id, { [o.material]: o.qty });
    expect((await post(app, a.h, `/contracts/${day0}/0/accept`)).statusCode).toBe(200);
    const r = await post(app, b.h, `/contracts/${day0}/0/accept`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('offer_taken');
    expect(await bal(b.id, o.material)).toBe(o.qty);
    expect((await board(app, b.h)).offers[0].status).toBe('taken');
  });

  it('zasadzka obcina nagrodę proporcjonalnie, ubezpieczenie chroni', async () => {
    const a = await newPlayer(hostileApp);
    const b = await newPlayer(hostileApp);
    const oa = (await board(hostileApp, a.h)).offers[0];
    const ob = (await board(hostileApp, b.h)).offers[1];
    await grant(a.id, { [oa.material]: oa.qty });
    await grant(b.id, { [ob.material]: ob.qty, ore: 5000 });
    expect((await post(hostileApp, a.h, `/contracts/${day0}/0/accept`)).statusCode).toBe(200);
    const ins = (await post(hostileApp, b.h, `/contracts/${day0}/1/accept`, { insure: true })).json();
    expect(ins.insuranceFee).toBe(insuranceFee(hostile, ob.qty * hostile.exchange.buy_ore[ob.material]!));

    const a0 = await bal(a.id, 'ore');
    const b0 = await bal(b.id, 'ore');
    hours(40);
    await hostileApp.inject({ url: '/silo', headers: a.h });
    await hostileApp.inject({ url: '/silo', headers: b.h });
    expect(await bal(a.id, 'ore')).toBe(a0 + survivingQty(hostile, oa.qty) * oa.unitReward);
    expect(await bal(b.id, 'ore')).toBe(b0 + ob.qty * ob.unitReward);
    expect((await board(hostileApp, a.h)).contracts[0].state).toBe('ambushed');
    expect(await auditLedger(db)).toEqual([]);
  });
});
