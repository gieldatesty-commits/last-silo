import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger, walletBalance } from '../src/ledger.js';
import { rng } from '../src/game/rng.js';

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
let g = 0;
async function newPlayer() {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Kompleciarz${++n}`, archetype: 'gornik' } });
  return { id: reg.userId as string, h };
}
const post = (h: Record<string, string>, path: string, key: string, payload: unknown = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload: payload as object });
const items = async (h: Record<string, string>) => (await app.inject({ url: '/items', headers: h })).json();
const recipe = (id: string) => config.items.recipes.find((r) => r.id === id)!;

/** Przedmiot wprost w bazie (jakość 1, zwykły, tier 0), założony w podanych zestawach. */
async function give(userId: string, recipeId: string, loadouts: (1 | 2)[], durability?: number) {
  const rc = recipe(recipeId);
  const id = (await pool.query('INSERT INTO items (user_id, recipe_id, slot, quality, durability, max_durability) VALUES ($1, $2, $3, 1, $4, $5) RETURNING id::text', [userId, rc.id, rc.slot, durability ?? rc.durability, rc.durability])).rows[0].id as string;
  for (const lo of loadouts) await pool.query('INSERT INTO loadouts (user_id, loadout, slot, item_id) VALUES ($1, $2, $3, $4)', [userId, lo, rc.slot, id]);
  return id;
}
const SZTYGAR = ['mlot_pneumatyczny', 'helm_wzmocniony', 'lampa_wibracyjna', 'detektor_zylowy'];
const RDZEN = ['wiertlo_rdzeniowe', 'kombinezon_izolowany', 'lampa_rezonansowa', 'skaner_sejsmiczny'];
const sumDive = (ids: string[]) => ids.reduce((a, id) => a + recipe(id).bonus, 0);

describe('Komplety w zestawach', () => {
  it('4 części Sztygara w I: +0,8 zjazdu, postęp 4/4; te same 2 w II: 2/4', async () => {
    const { id, h } = await newPlayer();
    const ids: string[] = [];
    for (const [i, r] of SZTYGAR.entries()) ids.push(await give(id, r, i < 2 ? [1, 2] : [1]));
    const r = await items(h);
    expect(r.loadoutStats['1'].dive).toBeCloseTo(sumDive(SZTYGAR) + 0.8, 2);
    expect(r.sets.find((s: { id: string }) => s.id === 'sztygar')).toMatchObject({ have: { '1': 4, '2': 2 }, bonus2: { dive_ore_pct: 5 }, bonus4: { dive_power: 0.8 } });
    expect(r.setsActive['1']).toEqual([{ id: 'sztygar', name: 'Komplet Sztygara', have: 4, bonus2: true, bonus4: true }]);
    expect(r.setsActive['2']).toEqual([{ id: 'sztygar', name: 'Komplet Sztygara', have: 2, bonus2: true, bonus4: false }]);
  });

  it('zepsuta część nie liczy się do progu: 3 dobre + 1 zepsuta = tylko bonus2', async () => {
    const { id, h } = await newPlayer();
    for (const [i, r] of SZTYGAR.entries()) await give(id, r, [1], i === 3 ? 0 : undefined);
    const r = await items(h);
    expect(r.loadoutStats['1'].dive).toBeCloseTo(sumDive(SZTYGAR.slice(0, 3)), 2);
    expect(r.sets.find((s: { id: string }) => s.id === 'sztygar').have['1']).toBe(3);
  });

  it('Wartownik 2/4 w II: +1,5 obrony w zestawie II i w obronie silosu (pełna jako aktywny, ×0,75 jako drugi)', async () => {
    const { id, h } = await newPlayer();
    await give(id, 'plyta_wartownika', [2]);
    await give(id, 'noktowizor', [2]);
    const r = await items(h);
    const def = recipe('plyta_wartownika').defense + recipe('noktowizor').defense + 1.5;
    expect(r.loadoutStats['2'].defense).toBeCloseTo(def, 2);
    expect(r.siloDefense['2']).toBeCloseTo(def, 2);
    expect(r.siloDefense['1']).toBeCloseTo(config.items.loadouts.passive_defense_share * def, 1); // serwer zaokrągla do 0,01
  });

  it('Rdzeń 4/4: naprawa przedmiotów z tego zestawu −25%, przedmiot tylko z II bez zniżki; repairTx pobiera obniżony koszt', async () => {
    const { id, h } = await newPlayer();
    await db.transaction().execute((trx) => applyLedger(trx, id, [{ resource: 'ore', delta: 100_000, reason: 'admin_adjust', ref: `sg-${++g}` }], 'test'));
    const w = await give(id, 'wiertlo_rdzeniowe', [1], 1);
    for (const r of RDZEN.slice(1, 3)) await give(id, r, [1]);
    const k = await give(id, 'kilof', [2], 1);
    const cost = async (itemId: string) => (await items(h)).items.find((i: { id: string }) => i.id === itemId).repairCost as number;
    const w3 = await cost(w);
    const k0 = await cost(k);
    await give(id, 'skaner_sejsmiczny', [1]); // 4/4
    const w4 = await cost(w);
    expect(w4).toBeLessThan(w3);
    expect(w4).toBe(Math.ceil(recipe('wiertlo_rdzeniowe').ore * config.items.repair_cost_fraction * 0.75 * ((recipe('wiertlo_rdzeniowe').durability - 1) / recipe('wiertlo_rdzeniowe').durability)));
    expect(await cost(k)).toBe(k0);
    const ore0 = await db.transaction().execute((trx) => walletBalance(trx, id, 'ore'));
    const paid = (await post(h, `/items/${w}/repair`, `sg-rep-${++g}`)).json().paid;
    expect(paid).toBe(w4);
    expect(await db.transaction().execute((trx) => walletBalance(trx, id, 'ore'))).toBe(ore0 - w4);
    expect(await auditLedger(db)).toEqual([]);
  });
});

describe('Komplety: ruda w zjazdach (zrzut)', () => {
  const gleboki = config.dives.routes.find((r) => r.id === 'gleboki')!;
  /** Gracz poziomu 10 z 2 częściami Sztygara w zestawie `lo` (I aktywny). */
  async function diver(lo: 1 | 2) {
    const p = await newPlayer();
    await pool.query('UPDATE players SET level = 10 WHERE user_id = $1', [p.id]);
    const a = await give(p.id, 'mlot_pneumatyczny', [lo]);
    const b = await give(p.id, 'helm_wzmocniony', [lo]);
    return { ...p, a, b };
  }
  async function dive(p: { h: Record<string, string> }, key: string) {
    // ziarno z pierwszą liczbą < 0,3: udany zjazd dla obu graczy (szansa na Głębokim ok. 0,5)
    let seed = 1;
    while (rng(seed)() >= 0.3) seed++;
    nextSeed = seed;
    return (await post(p.h, '/dives', key, { routeId: 'gleboki' })).json();
  }
  const resolved = async (diveId: string) => (await pool.query('SELECT set_ore_pct, result FROM dives WHERE id = $1', [diveId])).rows[0];

  it('2 części Sztygara: set_ore_pct = 5 przy dodaniu, ruda ≈ ×1,05 względem gracza bez kompletu w aktywnym zestawie', async () => {
    const withSet = await diver(1);
    const noSet = await diver(2);
    const d1 = await dive(withSet, 'sg-ore-0001');
    const d2 = await dive(noSet, 'sg-ore-0002');
    expect((await resolved(d1.diveId)).set_ore_pct).toBe(5);
    expect((await resolved(d2.diveId)).set_ore_pct).toBe(0);
    tick(gleboki.seconds + 1);
    await items(withSet.h);
    await items(noSet.h);
    const r1 = (await resolved(d1.diveId)).result;
    const r2 = (await resolved(d2.diveId)).result;
    expect(r1.success && r2.success).toBe(true);
    expect(Math.abs(r1.ore - r2.ore * 1.05)).toBeLessThanOrEqual(1.5);
    expect(r1.ore).toBeGreaterThan(r2.ore);
  });

  it('zdjęcie części przed rozliczeniem obniża premię do 0 (min ze zrzutu i stanu teraz); zjazd sprzed migracji liczy się z zestawu teraz', async () => {
    const a = await diver(1);
    const ref = await diver(2);
    const d1 = await dive(a, 'sg-min-0001');
    const d2 = await dive(ref, 'sg-min-0002');
    await post(a.h, `/items/${a.b}/unequip`, 'sg-min-0003', { loadout: 1 });
    tick(gleboki.seconds + 1);
    await items(a.h);
    await items(ref.h);
    expect((await resolved(d1.diveId)).result.ore).toBe((await resolved(d2.diveId)).result.ore);
    // NULL (sprzed 019): bez zrzutu, liczone z zestawu w chwili rozliczenia — ta sama ruda co zjazd ze zrzutem 5%
    const b = await diver(1);
    const c = await diver(1);
    const d3 = await dive(b, 'sg-min-0004');
    const d4 = await dive(c, 'sg-min-0005');
    await pool.query('UPDATE dives SET set_ore_pct = NULL WHERE id = $1', [d3.diveId]);
    tick(gleboki.seconds + 1);
    await items(b.h);
    await items(c.h);
    expect(Math.abs((await resolved(d3.diveId)).result.ore - (await resolved(d4.diveId)).result.ore)).toBeLessThanOrEqual(1);
  });

  it('/dives/routes: zakres rudy z premią kompletu aktywnego zestawu', async () => {
    const a = await diver(1);
    const ref = await diver(2);
    const r1 = (await app.inject({ url: '/dives/routes', headers: a.h })).json().find((r: { id: string }) => r.id === 'gleboki');
    const r2 = (await app.inject({ url: '/dives/routes', headers: ref.h })).json().find((r: { id: string }) => r.id === 'gleboki');
    expect(Math.abs(r1.ore[1] - r2.ore[1] * 1.05)).toBeLessThanOrEqual(1);
    expect(r1.ore[1]).toBeGreaterThan(r2.ore[1]);
  });
});
