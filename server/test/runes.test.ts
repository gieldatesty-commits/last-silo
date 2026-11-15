import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger, walletBalance } from '../src/ledger.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-04-01T10:00:00Z');
let nextSeed = 1;
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => nextSeed });
const tick = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000));

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE; TRUNCATE world_pools');
  clock = new Date('2026-04-01T10:00:00Z');
  nextSeed = 1;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

let n = 0;
async function newPlayer() {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Runiarz${++n}`, archetype: 'gornik' } });
  return { id: reg.userId as string, h };
}
const post = (h: Record<string, string>, path: string, key: string, payload: unknown = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload: payload as object });
let g = 0; // licznik referencji i kluczy
const grant = (id: string, res: Record<string, number>) =>
  db.transaction().execute((trx) => applyLedger(trx, id, Object.entries(res).map(([resource, delta]) => ({ resource, delta, reason: 'admin_adjust' as const, ref: `rg-${++g}` })), 'test'));
const bal = (id: string, r: string) => db.transaction().execute((trx) => walletBalance(trx, id, r));
const setLevel = (id: string, type: string, level: number) => pool.query('UPDATE buildings SET level = $3 WHERE user_id = $1 AND type = $2', [id, type, level]);

/** Gracz z Warsztatem i Radiem pozwalającymi wytwarzać runy I i II. */
async function crafter() {
  const p = await newPlayer();
  await setLevel(p.id, 'warsztat', 6);
  await setLevel(p.id, 'radiostacja', 5);
  return p;
}

describe('Runy: wytwarzanie', () => {
  it('runa I: koszt w dzienniku, +1 w portfelu, idempotencja, audyt', async () => {
    const { id, h } = await crafter();
    await grant(id, { ore: 1000, miedz: 20 });
    const r = await post(h, '/runes/runa_zyly_1/craft', 'rune-craft-0001');
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ runeId: 'runa_zyly_1', count: 1 });
    expect(await bal(id, 'runa_zyly_1')).toBe(1);
    expect(await bal(id, 'miedz')).toBe(12);
    expect(await bal(id, 'ore')).toBe(config.economy.start_ore + 1000 - 300);
    const again = await post(h, '/runes/runa_zyly_1/craft', 'rune-craft-0001');
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(await bal(id, 'runa_zyly_1')).toBe(1);
    expect(await auditLedger(db)).toEqual([]);
  });

  it('wymagania i błędy: Warsztat, Radio, materiał, poziom III, nieznana runa', async () => {
    const { id, h } = await newPlayer();
    await grant(id, { ore: 5000, tokens: 50, miedz: 5, siarka: 100 });
    expect((await post(h, '/runes/runa_zyly_1/craft', 'rune-err-0001')).json().error).toBe('workshop_too_low');
    await setLevel(id, 'warsztat', 6);
    expect((await post(h, '/runes/runa_zyly_1/craft', 'rune-err-0002')).json().error).toBe('radio_too_low');
    await setLevel(id, 'radiostacja', 5);
    const poor = await post(h, '/runes/runa_zyly_1/craft', 'rune-err-0003');
    expect(poor.statusCode).toBe(402);
    expect(poor.json().error).toBe('insufficient_miedz');
    expect((await post(h, '/runes/runa_ostrza_3/craft', 'rune-err-0004')).json().error).toBe('rune_not_craftable');
    const unk = await post(h, '/runes/runa_xyz_1/craft', 'rune-err-0005');
    expect(unk.statusCode).toBe(400);
    expect(unk.json().error).toBe('unknown_rune');
    expect(await auditLedger(db)).toEqual([]);
  });

  it('GET /items: portfel run i receptury run z blokadami', async () => {
    const { id, h } = await crafter();
    await grant(id, { ore: 1000, miedz: 20 });
    await post(h, '/runes/runa_zyly_1/craft', 'rune-list-0001');
    const r = (await app.inject({ url: '/items', headers: h })).json();
    expect(r.runes).toEqual({ runa_zyly_1: 1 });
    expect(r.runeRecipes).toHaveLength(8); // 4 rodzaje × poziomy I–II
    expect(r.runeRecipes.find((x: { id: string }) => x.id === 'runa_zyly_1')).toMatchObject({ kind: 'zyly', level: 1, name: 'Żyły', effect: 'dive', value: 0.2, ore: 300, materials: { miedz: 8 }, locked: false });
    await setLevel(id, 'warsztat', 4);
    const r2 = (await app.inject({ url: '/items', headers: h })).json();
    expect(r2.runeRecipes.find((x: { id: string }) => x.id === 'runa_zyly_2').locked).toBe(true);
  });
});


describe('Runy: osadzanie i wyjmowanie', () => {
  /** Gracz z założonym kilofem o rzadkości `rarity` i runami w portfelu. */
  async function withPick(rarity = 'solidny', runes: Record<string, number> = { runa_zyly_1: 1 }) {
    const p = await crafter();
    await grant(p.id, { ore: 2000, ...runes });
    const k = (await post(p.h, '/items/craft', `rs-craft-${++g}`, { recipeId: 'kilof' })).json();
    await pool.query('UPDATE items SET rarity = $2 WHERE id = $1', [k.id, rarity]);
    await post(p.h, `/items/${k.id}/equip`, `rs-equip-${++g}`);
    const before = (await app.inject({ url: '/items', headers: p.h })).json();
    return { ...p, k, before };
  }
  const items = async (h: Record<string, string>) => (await app.inject({ url: '/items', headers: h })).json();

  it('osadzenie: −1 runa, bonus w przedmiocie, zestawie i zrzucie zjazdu', async () => {
    const { id, h, k, before } = await withPick();
    const r = await post(h, `/items/${k.id}/runes`, 'rs-sock-0001', { socket: 0, rune: 'runa_zyly_1' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ sockets: 1, runes: [{ socket: 0, runeId: 'runa_zyly_1', name: 'Żyły' }] });
    expect(await bal(id, 'runa_zyly_1')).toBe(0);
    const after = await items(h);
    expect(after.items[0].bonus).toBeCloseTo(before.items[0].bonus + 0.2, 2);
    expect(after.loadoutStats['1'].dive).toBeCloseTo(before.loadoutStats['1'].dive + 0.2, 2);
    const d = (await post(h, '/dives', 'rs-dive-0001', { routeId: 'plytki' })).json();
    const snap = (await pool.query('SELECT item_bonus FROM dives WHERE id = $1', [d.diveId])).rows[0].item_bonus;
    expect(snap).toBeCloseTo(after.loadoutStats['1'].dive, 2);
    expect(await auditLedger(db)).toEqual([]);
  });

  it('błędy osadzania: brak gniazda (zwykły), gniazdo poza zakresem, zajęte, brak runy; portfel bez zmian', async () => {
    const zw = await withPick('zwykly');
    const e1 = await post(zw.h, `/items/${zw.k.id}/runes`, 'rs-err-0001', { socket: 0, rune: 'runa_zyly_1' });
    expect(e1.statusCode).toBe(409);
    expect(e1.json().error).toBe('no_socket');
    expect(await bal(zw.id, 'runa_zyly_1')).toBe(1);
    const so = await withPick('solidny', { runa_zyly_1: 2 });
    expect((await post(so.h, `/items/${so.k.id}/runes`, 'rs-err-0002', { socket: 1, rune: 'runa_zyly_1' })).json().error).toBe('no_socket');
    await post(so.h, `/items/${so.k.id}/runes`, 'rs-err-0003', { socket: 0, rune: 'runa_zyly_1' });
    expect((await post(so.h, `/items/${so.k.id}/runes`, 'rs-err-0004', { socket: 0, rune: 'runa_zyly_1' })).json().error).toBe('socket_taken');
    const none = await withPick('mistrzowski', {});
    const e5 = await post(none.h, `/items/${none.k.id}/runes`, 'rs-err-0005', { socket: 0, rune: 'runa_ostrza_1' });
    expect(e5.statusCode).toBe(402);
    expect(e5.json().error).toBe('insufficient_runa_ostrza_1');
    expect((await post(none.h, `/items/${none.k.id}/runes`, 'rs-err-0006', { socket: 0, rune: 'runa_xyz_1' })).json().error).toBe('unknown_rune');
    expect(await auditLedger(db)).toEqual([]);
  });

  it('wyjęcie: opłata w rudzie, runa wraca, gniazdo puste; socket_empty; brak rudy → 402 i runa zostaje', async () => {
    const { id, h, k } = await withPick();
    await post(h, `/items/${k.id}/runes`, 'rs-out-0001', { socket: 0, rune: 'runa_zyly_1' });
    const ore0 = await bal(id, 'ore');
    const r = await post(h, `/items/${k.id}/runes/0/remove`, 'rs-out-0002');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ runes: [], paid: 100 });
    expect(await bal(id, 'ore')).toBe(ore0 - 100);
    expect(await bal(id, 'runa_zyly_1')).toBe(1);
    expect((await post(h, `/items/${k.id}/runes/0/remove`, 'rs-out-0003')).json().error).toBe('socket_empty');
    await post(h, `/items/${k.id}/runes`, 'rs-out-0004', { socket: 0, rune: 'runa_zyly_1' });
    await grant(id, { ore: -(await bal(id, 'ore')) + 50 });
    const poor = await post(h, `/items/${k.id}/runes/0/remove`, 'rs-out-0005');
    expect(poor.statusCode).toBe(402);
    expect(poor.json().error).toBe('insufficient_ore');
    expect((await items(h)).items[0].runes).toEqual([{ socket: 0, runeId: 'runa_zyly_1', name: 'Żyły' }]);
    expect(await auditLedger(db)).toEqual([]);
  });

  it('zepsuty przedmiot: bez bonusu run w zestawie; po naprawie wraca', async () => {
    const { h, k } = await withPick();
    await post(h, `/items/${k.id}/runes`, 'rs-br-0001', { socket: 0, rune: 'runa_zyly_1' });
    await pool.query('UPDATE items SET durability = 0 WHERE id = $1', [k.id]);
    expect((await items(h)).loadoutStats['1'].dive).toBe(0);
    await post(h, `/items/${k.id}/repair`, 'rs-br-0002');
    expect((await items(h)).loadoutStats['1'].dive).toBeGreaterThan(0.2);
  });

  it('Trwałości obniża koszt naprawy (widok i pobranie)', async () => {
    const { id, h, k } = await withPick('solidny', { runa_trwalosci_2: 1 });
    await pool.query('UPDATE items SET durability = 1 WHERE id = $1', [k.id]);
    const full = (await items(h)).items[0].repairCost as number;
    await post(h, `/items/${k.id}/runes`, 'rs-tr-0001', { socket: 0, rune: 'runa_trwalosci_2' });
    const cheap = (await items(h)).items[0].repairCost as number;
    expect(cheap).toBeLessThan(full);
    const ore0 = await bal(id, 'ore');
    const r = await post(h, `/items/${k.id}/repair`, 'rs-tr-0002');
    expect(r.json().paid).toBe(cheap);
    expect(await bal(id, 'ore')).toBe(ore0 - cheap);
  });
});
