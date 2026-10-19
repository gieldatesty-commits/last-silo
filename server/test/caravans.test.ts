import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger, walletBalance } from '../src/ledger.js';
import { priceCorridor } from '../src/game/market.js';
import { ambushChance, insuranceFee, shipFeePerUnit, shipMinutes, survivingQty } from '../src/game/caravan.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const base = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
// konfig z pewną zasadzką, żeby sprawdzić stratę i ubezpieczenie
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
async function newPlayer(a = app) {
  const reg = (await a.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await a.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Karawana${++n}`, archetype: 'gornik' } });
  await pool.query('UPDATE players SET level = 6 WHERE user_id = $1', [reg.userId]);
  await pool.query("UPDATE buildings SET level = 5 WHERE user_id = $1 AND type = 'radiostacja'", [reg.userId]);
  return { id: reg.userId as string, h };
}
const grant = (id: string, res: Record<string, number>) =>
  db.transaction().execute((trx) => applyLedger(trx, id, Object.entries(res).map(([resource, delta]) => ({ resource, delta, reason: 'admin_adjust' as const, ref: `grant-${++g}-${resource}` })), 'test'));
let k = 0;
const post = (a: typeof app, h: Record<string, string>, path: string, payload: object = {}) => a.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': `cv-${++k}-padding` }, payload });
const bal = (id: string, r: string) => db.transaction().execute((trx) => walletBalance(trx, id, r));

describe('wzory przewozu', () => {
  it('czas, opłata i ryzyko rosną z dystansem; ubezpieczenie kosztuje ułamek wartości', () => {
    expect(shipMinutes(base, 100)).toBe(base.caravans.min_minutes);
    expect(shipMinutes(base, 1200)).toBeCloseTo(120, 5);
    expect(shipMinutes(base, 100_000)).toBe(base.caravans.max_minutes);
    expect(shipFeePerUnit(base, 'miedz', 4000)).toBeGreaterThan(shipFeePerUnit(base, 'miedz', 1000));
    expect(shipFeePerUnit(base, 'miedz', 100_000)).toBe(Math.floor(base.exchange.buy_ore.miedz! * base.caravans.fee_cap));
    expect(ambushChance(base, 0)).toBeCloseTo(base.caravans.ambush.base, 6);
    expect(ambushChance(base, 100_000)).toBe(base.caravans.ambush.max);
    expect(insuranceFee(base, 1000)).toBe(80);
    expect(survivingQty(base, 10)).toBe(6);
    expect(survivingQty(base, 1)).toBe(1);
  });
});

describe('dostawa karawaną', () => {
  it('towar dociera dopiero po czasie, a przed tym nie można go użyć', async () => {
    const s = await newPlayer();
    const b = await newPlayer();
    await grant(s.id, { krysztal: 20 });
    await grant(b.id, { ore: 10_000 });
    const c = priceCorridor(base, 'krysztal')!;
    const id = (await post(app, s.h, '/market/listings', { material: 'krysztal', qty: 20, unitPrice: c.max })).json().id as string;
    const r = (await post(app, b.h, `/market/listings/${id}/buy`, { qty: 20 })).json();
    expect(r.arrivesAt).toBeTruthy();
    expect(await bal(b.id, 'krysztal')).toBe(0);

    const ships = (await app.inject({ url: '/market/shipments', headers: b.h })).json();
    expect(ships.shipments).toHaveLength(1);
    expect(ships.shipments[0]).toMatchObject({ state: 'transit', qty: 20 });

    // tuż przed dostawą nadal nic; po czasie towar w portfelu (zasadzki nie ma przy domyślnym ryzyku i ziarnie 1)
    const eta = new Date(r.arrivesAt).getTime();
    clock = new Date(eta - 60_000);
    await app.inject({ url: '/silo', headers: b.h });
    expect(await bal(b.id, 'krysztal')).toBe(0);
    clock = new Date(eta + 60_000);
    await app.inject({ url: '/silo', headers: b.h });
    expect(await bal(b.id, 'krysztal')).toBe(20);
    expect((await app.inject({ url: '/market/shipments', headers: b.h })).json().shipments[0].state).toBe('delivered');
    // powtórne rozliczenie nie duplikuje dostawy
    await app.inject({ url: '/silo', headers: b.h });
    expect(await bal(b.id, 'krysztal')).toBe(20);
    expect(await auditLedger(db)).toEqual([]);
  });

  it('zasadzka zabiera część towaru, ubezpieczenie nie', async () => {
    const s = await newPlayer(hostileApp);
    const b = await newPlayer(hostileApp);
    const c = await newPlayer(hostileApp);
    await grant(s.id, { siarka: 40 });
    await grant(b.id, { ore: 20_000 });
    await grant(c.id, { ore: 20_000 });
    const cor = priceCorridor(hostile, 'siarka')!;
    const id = (await post(hostileApp, s.h, '/market/listings', { material: 'siarka', qty: 40, unitPrice: cor.max })).json().id as string;

    const plain = (await post(hostileApp, b.h, `/market/listings/${id}/buy`, { qty: 10 })).json();
    const insured = (await post(hostileApp, c.h, `/market/listings/${id}/buy`, { qty: 10, insure: true })).json();
    expect(plain.insuranceFee).toBe(0);
    expect(insured.insuranceFee).toBe(insuranceFee(hostile, 10 * cor.max));
    expect(plain.ambushChance).toBe(100);

    hours(40);
    await hostileApp.inject({ url: '/silo', headers: b.h });
    await hostileApp.inject({ url: '/silo', headers: c.h });
    expect(await bal(b.id, 'siarka')).toBe(survivingQty(hostile, 10));
    expect(await bal(c.id, 'siarka')).toBe(10);
    const sh = (await hostileApp.inject({ url: '/market/shipments', headers: b.h })).json().shipments[0];
    expect(sh).toMatchObject({ state: 'ambushed', deliveredQty: 6 });
    expect(await auditLedger(db)).toEqual([]);
  });

  it('limit przesyłek w drodze i brak środków na przewóz cofa zakup', async () => {
    const s = await newPlayer();
    const b = await newPlayer();
    await grant(s.id, { miedz: 100 });
    const c = priceCorridor(base, 'miedz')!;
    const id = (await post(app, s.h, '/market/listings', { material: 'miedz', qty: 100, unitPrice: c.min })).json().id as string;
    // tylko tyle rudy, by zapłacić za towar, ale nie za przewóz
    await pool.query("UPDATE wallets SET balance = $2 WHERE user_id = $1 AND resource = 'ore'", [b.id, 10 * c.min]);
    const poor = await post(app, b.h, `/market/listings/${id}/buy`, { qty: 10 });
    expect(poor.statusCode).toBe(402);
    expect((await pool.query('SELECT count(*)::int AS n FROM shipments')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT qty FROM market_listings WHERE id = $1', [id])).rows[0].qty).toBe(100);

    await grant(b.id, { ore: 100_000 });
    for (let i = 0; i < base.caravans.max_active; i++) expect((await post(app, b.h, `/market/listings/${id}/buy`, { qty: 1 })).statusCode).toBe(200);
    expect((await post(app, b.h, `/market/listings/${id}/buy`, { qty: 1 })).json().error).toBe('too_many_shipments');
  });
});
