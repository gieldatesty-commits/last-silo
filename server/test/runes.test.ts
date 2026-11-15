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
let g = 0;
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

