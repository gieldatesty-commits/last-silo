import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger, walletBalance } from '../src/ledger.js';
import { botBid, marketFee, priceCorridor } from '../src/game/market.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const T0 = new Date('2026-04-01T10:00:00Z');
let clock = T0;
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1 });
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
  await db.destroy();
});

let n = 0;
let g = 0;
async function newPlayer(opts: { ready?: boolean } = {}) {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Handel${++n}`, archetype: 'gornik' } });
  if (opts.ready !== false) {
    await pool.query('UPDATE players SET level = 6 WHERE user_id = $1', [reg.userId]);
    await pool.query("UPDATE buildings SET level = 5 WHERE user_id = $1 AND type = 'radiostacja'", [reg.userId]);
  }
  return { id: reg.userId as string, h };
}
const grant = (id: string, res: Record<string, number>) =>
  db.transaction().execute((trx) => applyLedger(trx, id, Object.entries(res).map(([resource, delta]) => ({ resource, delta, reason: 'admin_adjust' as const, ref: `grant-${++g}-${resource}` })), 'test'));
let k = 0;
const post = (h: Record<string, string>, path: string, payload: object = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': `mk-${++k}-padding` }, payload });
const bal = (id: string, r: string) => db.transaction().execute((trx) => walletBalance(trx, id, r));
const list = async (p: { h: Record<string, string> }, material: string, qty: number, unitPrice: number) => post(p.h, '/market/listings', { material, qty, unitPrice });

describe('ceny rynku', () => {
  it('korytarz: od oferty bota do ceny NPC; prowizja co najmniej 1', () => {
    const c = priceCorridor(config, 'miedz')!;
    expect(c.max).toBe(config.exchange.buy_ore.miedz);
    expect(c.min).toBe(botBid(config, 'miedz'));
    expect(c.min).toBeLessThan(c.max);
    expect(marketFee(config, 1000)).toBe(50);
    expect(marketFee(config, 3)).toBe(1);
  });
});

describe('rynek graczy', () => {
  it('wymaga poziomu gracza i Radiostacji', async () => {
    const low = await newPlayer({ ready: false });
    expect((await app.inject({ url: '/market', headers: low.h })).json().error).toBe('level_too_low');
    await pool.query('UPDATE players SET level = 6 WHERE user_id = $1', [low.id]);
    expect((await app.inject({ url: '/market', headers: low.h })).json().error).toBe('radio_too_low');
  });

  it('wystawienie, kupno części, prowizja i zachowanie materiałów', async () => {
    const seller = await newPlayer();
    const buyer = await newPlayer();
    await grant(seller.id, { miedz: 100 });
    await grant(buyer.id, { ore: 10_000 });
    const c = priceCorridor(config, 'miedz')!;

    expect((await list(seller, 'miedz', 50, c.max + 1)).json().error).toBe('price_out_of_range');
    expect((await list(seller, 'miedz', 50, c.min - 1)).json().error).toBe('price_out_of_range');
    expect((await list(seller, 'zloto', 5, c.min)).json().error).toBe('unknown_material');
    const price = Math.floor((c.min + c.max) / 2);
    const made = await list(seller, 'miedz', 50, price);
    expect(made.statusCode).toBe(201);
    expect(await bal(seller.id, 'miedz')).toBe(50); // depozyt zdjęty

    const id = made.json().id as string;
    const bad = await post(seller.h, `/market/listings/${id}/buy`, { qty: 1 });
    expect(bad.json().error).toBe('own_listing');
    expect((await post(buyer.h, `/market/listings/${id}/buy`, { qty: 51 })).json().error).toBe('not_enough_qty');

    const ore0 = await bal(buyer.id, 'ore');
    const bought = await post(buyer.h, `/market/listings/${id}/buy`, { qty: 20 });
    expect(bought.statusCode).toBe(200);
    const fee = marketFee(config, 20 * price);
    expect(bought.json()).toMatchObject({ qty: 20, paid: 20 * price, fee });
    expect(await bal(buyer.id, 'ore')).toBe(ore0 - 20 * price);
    expect(await bal(buyer.id, 'miedz')).toBe(20);
    expect(await bal(seller.id, 'ore')).toBe(config.economy.start_ore + 20 * price - fee);
    // materiał nie powstaje ani nie znika: 50 u sprzedawcy + 20 u kupującego + 30 w wystawieniu = 100
    const left = (await pool.query('SELECT qty FROM market_listings WHERE id = $1', [id])).rows[0].qty;
    expect((await bal(seller.id, 'miedz')) + (await bal(buyer.id, 'miedz')) + left).toBe(100);
    expect(left).toBe(30);

    const rest = await post(buyer.h, `/market/listings/${id}/buy`, { qty: 30 });
    expect(rest.statusCode).toBe(200);
    expect((await post(buyer.h, `/market/listings/${id}/buy`, { qty: 1 })).json().error).toBe('listing_closed');
    expect(await auditLedger(db)).toEqual([]);

    const ov = (await app.inject({ url: '/market', headers: buyer.h })).json();
    const m = ov.materials.find((x: { id: string }) => x.id === 'miedz');
    expect(m.avg7d).toBe(price);
    expect(m.volume7d).toBe(50);
  });

  it('brak rudy u kupującego cofa całą transakcję', async () => {
    const seller = await newPlayer();
    const buyer = await newPlayer();
    await grant(seller.id, { krysztal: 10 });
    const c = priceCorridor(config, 'krysztal')!;
    const id = (await list(seller, 'krysztal', 10, c.max)).json().id as string;
    await pool.query("UPDATE wallets SET balance = 0 WHERE user_id = $1 AND resource = 'ore'", [buyer.id]);
    const r = await post(buyer.h, `/market/listings/${id}/buy`, { qty: 5 });
    expect(r.statusCode).toBe(402);
    expect((await pool.query('SELECT qty, state FROM market_listings WHERE id = $1', [id])).rows[0]).toEqual({ qty: 10, state: 'active' });
    expect((await pool.query('SELECT count(*)::int AS n FROM market_trades')).rows[0].n).toBe(0);
  });

  it('anulowanie zwraca towar; limit aktywnych wystawień', async () => {
    const s = await newPlayer();
    await grant(s.id, { siarka: 1000 });
    const c = priceCorridor(config, 'siarka')!;
    const ids: string[] = [];
    for (let i = 0; i < config.market.max_active; i++) ids.push((await list(s, 'siarka', 10, c.max)).json().id);
    expect((await list(s, 'siarka', 10, c.max)).json().error).toBe('too_many_listings');
    expect(await bal(s.id, 'siarka')).toBe(1000 - 10 * config.market.max_active);
    const del = await app.inject({ method: 'DELETE', url: `/market/listings/${ids[0]}`, headers: s.h });
    expect(del.json()).toMatchObject({ returned: 10 });
    expect(await bal(s.id, 'siarka')).toBe(1000 - 10 * (config.market.max_active - 1));
    expect((await app.inject({ method: 'DELETE', url: `/market/listings/${ids[0]}`, headers: s.h })).json().error).toBe('listing_closed');
    const other = await newPlayer();
    expect((await app.inject({ method: 'DELETE', url: `/market/listings/${ids[1]}`, headers: other.h })).json().error).toBe('no_listing');
  });

  it('wygasłe wystawienie wraca do sprzedającego', async () => {
    const s = await newPlayer();
    const b = await newPlayer();
    await grant(s.id, { miedz: 40 });
    await grant(b.id, { ore: 5000 });
    const c = priceCorridor(config, 'miedz')!;
    const id = (await list(s, 'miedz', 40, c.max)).json().id as string;
    hours(config.market.listing_hours + 1);
    expect((await post(b.h, `/market/listings/${id}/buy`, { qty: 1 })).json().error).toBe('listing_closed');
    await app.inject({ url: '/market', headers: s.h }); // odczyt rozlicza wygasłe wystawienia
    expect(await bal(s.id, 'miedz')).toBe(40);
    expect((await pool.query('SELECT state FROM market_listings WHERE id = $1', [id])).rows[0].state).toBe('expired');
    expect(await auditLedger(db)).toEqual([]);
  });

  it('bot podłogi cen: stała cena i dzienny limit', async () => {
    const s = await newPlayer();
    await grant(s.id, { miedz: 100 });
    const price = botBid(config, 'miedz')!;
    const q = config.market.bot_daily_qty;
    const ore0 = await bal(s.id, 'ore');
    const r = await post(s.h, '/market/sell-npc', { material: 'miedz', qty: q });
    expect(r.json()).toMatchObject({ received: price * q });
    expect(await bal(s.id, 'ore')).toBe(ore0 + price * q);
    expect((await post(s.h, '/market/sell-npc', { material: 'miedz', qty: 1 })).json().error).toBe('bot_daily_limit');
    hours(25);
    expect((await post(s.h, '/market/sell-npc', { material: 'miedz', qty: 1 })).statusCode).toBe(200);
  });

  it('równoległe zakupy: tylko jeden dostaje ostatnią partię; wzajemne zakupy bez zakleszczenia', async () => {
    const s = await newPlayer();
    const b1 = await newPlayer();
    const b2 = await newPlayer();
    await grant(s.id, { miedz: 30 });
    await grant(b1.id, { ore: 50_000 });
    await grant(b2.id, { ore: 50_000 });
    const c = priceCorridor(config, 'miedz')!;
    const id = (await list(s, 'miedz', 30, c.max)).json().id as string;
    const [r1, r2] = await Promise.all([post(b1.h, `/market/listings/${id}/buy`, { qty: 30 }), post(b2.h, `/market/listings/${id}/buy`, { qty: 30 })]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect((await bal(b1.id, 'miedz')) + (await bal(b2.id, 'miedz'))).toBe(30);

    // A kupuje od B, a B od A jednocześnie
    const a = await newPlayer();
    const b = await newPlayer();
    await grant(a.id, { krysztal: 10, ore: 20_000 });
    await grant(b.id, { siarka: 10, ore: 20_000 });
    const la = (await list(a, 'krysztal', 10, priceCorridor(config, 'krysztal')!.max)).json().id as string;
    const lb = (await list(b, 'siarka', 10, priceCorridor(config, 'siarka')!.max)).json().id as string;
    const both = await Promise.all([post(a.h, `/market/listings/${lb}/buy`, { qty: 10 }), post(b.h, `/market/listings/${la}/buy`, { qty: 10 })]);
    expect(both.map((x) => x.statusCode)).toEqual([200, 200]);
    expect(await auditLedger(db)).toEqual([]);
  });

  it('lista ofert sortowana po cenie, z oznaczeniem własnych', async () => {
    const s = await newPlayer();
    const o = await newPlayer();
    await grant(s.id, { miedz: 30 });
    await grant(o.id, { miedz: 30 });
    const c = priceCorridor(config, 'miedz')!;
    await list(s, 'miedz', 10, c.max);
    await list(o, 'miedz', 10, c.min + 1);
    const l = (await app.inject({ url: '/market/listings?material=miedz', headers: s.h })).json().listings;
    expect(l.map((x: { unitPrice: number }) => x.unitPrice)).toEqual([c.min + 1, c.max]);
    expect(l.map((x: { mine: boolean }) => x.mine)).toEqual([false, true]);
  });
});
