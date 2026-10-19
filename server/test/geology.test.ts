import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger } from '../src/ledger.js';
import { describeProfile, geologyProfile } from '../src/game/geology.js';
import { resolveDive } from '../src/game/dive.js';
import { distanceKm } from '../src/game/world.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-04-01T10:00:00Z');
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 7 });
const mats = config.geology.materials;

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE; TRUNCATE world_pools');
  clock = new Date('2026-04-01T10:00:00Z');
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

let n = 0;
async function newPlayer(radio = 1) {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Geolog${++n}`, archetype: 'gornik' } });
  await pool.query("UPDATE buildings SET level=$2 WHERE user_id=$1 AND type='radiostacja'", [reg.userId, radio]);
  return { id: reg.userId as string, h };
}
const post = (h: Record<string, string>, path: string, key: string, payload: unknown = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload: payload as object });
let g = 0;
const grant = (id: string, res: Record<string, number>) =>
  db.transaction().execute((trx) => applyLedger(trx, id, Object.entries(res).map(([resource, delta]) => ({ resource, delta, reason: 'admin_adjust' as const, ref: `gg-${++g}` })), 't'));

describe('geologia – profil regionu', () => {
  it('deterministyczny, trzy poziomy bogactwa: obfity > średni > ślady', () => {
    const p = geologyProfile(config, { lat: 20, lon: 30 }, 5);
    expect(geologyProfile(config, { lat: 20, lon: 30 }, 5)).toEqual(p);
    const v = Object.values(p).sort((a, b) => b - a);
    const t = config.geology.richness;
    expect(v[0]!).toBeGreaterThan(v[1]!);
    expect(v[1]!).toBeGreaterThan(v[2]!);
    expect(v[0]!).toBeLessThanOrEqual(t.main * (1 + config.geology.local_variance) + 1e-9);
    expect(v[2]!).toBeGreaterThan(0);
    expect(Object.keys(p).sort()).toEqual([...mats].sort());
  });

  it('regiony: bliscy sąsiedzi mają ten sam ranking częściej niż odlegli; na planecie występują różne profile', () => {
    const rankOf = (lat: number, lon: number) => Object.entries(geologyProfile(config, { lat, lon }, 1)).sort((a, b) => b[1] - a[1]).map(([id]) => id).join('>');
    let nearSame = 0, farSame = 0, total = 0;
    const mains = new Set<string>();
    for (let lat = -60; lat <= 60; lat += 20) {
      for (let lon = -180; lon < 180; lon += 20) {
        total++;
        const r = rankOf(lat, lon);
        mains.add(r.split('>')[0]!);
        if (r === rankOf(lat, lon + 3)) nearSame++;
        if (r === rankOf(-lat, lon + 180)) farSame++;
      }
    }
    expect(nearSame / total).toBeGreaterThan(0.8);
    expect(nearSame).toBeGreaterThan(farSame);
    expect(mains.size).toBe(3); // każdy materiał jest gdzieś obfity
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 3 }, config.world.radius_km)).toBeLessThan(400);
  });

  it('opis dla gracza bez liczb', () => {
    const d = describeProfile(config, { miedz: 1.0, krysztal: 0.4, siarka: 0.1 });
    expect(d).toEqual({ miedz: 'obfity', krysztal: 'sredni', siarka: 'slady' });
  });
});

describe('geologia – wydobycie z zjazdów', () => {
  const route = (id: string) => config.dives.routes.find((r) => r.id === id)!;
  const st = { sila: 30, technika: 30, percepcja: 30, wytrwalosc: 30 };
  const pool0 = { remaining: 1000, total: 1000 };
  it('niskie trasy nie dają materiałów; wysokie dają proporcjonalnie do bogactwa i długości', () => {
    const rich = { miedz: 1, krysztal: 0.4, siarka: 0.1 };
    for (let s = 1; s < 50; s++) expect(resolveDive(config, route('plytki'), st, 1, s, pool0, 0, 1, rich).materials).toEqual({});
    let sums: Record<string, number> = { miedz: 0, krysztal: 0, siarka: 0 };
    const N = 3000;
    for (let s = 1; s <= N; s++) {
      const o = resolveDive(config, route('brama'), st, 1, s, pool0, 100, 1, rich);
      for (const [m, v] of Object.entries(o.materials)) sums[m] = (sums[m] ?? 0) + v;
    }
    const hours = route('brama').seconds / 3600;
    const expected = (r: number) => hours * config.geology.mat_per_hour * route('brama').reward_mult * r;
    expect(sums.miedz! / N).toBeCloseTo(expected(1) * (0.9 + 0.1 * config.dives.fail_reward_fraction), 0); // sukces 90%, porażka 30% nagrody
    expect(sums.miedz!).toBeGreaterThan(sums.krysztal!);
    expect(sums.krysztal!).toBeGreaterThan(sums.siarka!);
  });
  it('dodatkowe losowania nie zmieniają dotychczasowych wyników', () => {
    const a = resolveDive(config, route('szczeliny'), st, 1, 11, pool0, 5, 1, {});
    const b = resolveDive(config, route('szczeliny'), st, 1, 11, pool0, 5, 1, { miedz: 1, krysztal: 1, siarka: 1 });
    expect([a.ore, a.tokens, a.samples, a.success]).toEqual([b.ore, b.tokens, b.samples, b.success]);
  });
});

describe('geologia – bramka Radiostacji poz. 5', () => {
  it('zawartość do poziomu 5 radia nie wymaga materiałów', () => {
    for (const r of config.items.recipes) if (Object.keys(r.materials).length) expect(r.radio).toBe(5);
    for (const t of config.research.techs) if (Object.keys(t.materials).length) expect(t.radio).toBe(5);
    const free = config.items.recipes.filter((r) => !r.radio);
    expect(free.length).toBeGreaterThanOrEqual(6); // sensowna zawartość bez materiałów
    expect(config.exchange.radio).toBe(5);
  });

  it('receptura z materiałami: wymaga radia 5, pobiera materiały, brak materiału = 402', async () => {
    const p = await newPlayer(4);
    await grant(p.id, { ore: 20000, tokens: 100, miedz: 100, krysztal: 100, siarka: 100 });
    await pool.query("UPDATE buildings SET level=7 WHERE user_id=$1 AND type='warsztat'", [p.id]);
    expect((await post(p.h, '/items/craft', 'geo-craft-0001', { recipeId: 'kombinezon_pancerny' })).json().error).toBe('radio_too_low');
    await pool.query("UPDATE buildings SET level=5 WHERE user_id=$1 AND type='radiostacja'", [p.id]);
    const ok = await post(p.h, '/items/craft', 'geo-craft-0002', { recipeId: 'kombinezon_pancerny' });
    expect(ok.statusCode).toBe(201);
    const w = (await app.inject({ url: '/silo', headers: p.h })).json().wallet;
    const rc = config.items.recipes.find((r) => r.id === 'kombinezon_pancerny')!;
    expect(w.miedz).toBe(100 - rc.materials.miedz!);
    expect(w.siarka).toBe(100 - rc.materials.siarka!);
    expect(w.krysztal).toBe(100);
    const poor = await newPlayer(5);
    await grant(poor.id, { ore: 20000, tokens: 100, miedz: 100 });
    await pool.query("UPDATE buildings SET level=7 WHERE user_id=$1 AND type='warsztat'", [poor.id]);
    const r = await post(poor.h, '/items/craft', 'geo-craft-0003', { recipeId: 'kombinezon_pancerny' });
    expect(r.statusCode).toBe(402);
    expect(r.json().error).toBe('insufficient_siarka');
    expect(await auditLedger(db)).toEqual([]);
  });

  it('badanie z materiałami: wymaga radia 5 i materiałów; lista pokazuje wymagania', async () => {
    const p = await newPlayer(4);
    await pool.query("UPDATE buildings SET level=5 WHERE user_id=$1 AND type='laboratorium'", [p.id]);
    await grant(p.id, { ore: 50000, tokens: 100, miedz: 50 });
    // zrób poprzednika
    await pool.query("INSERT INTO research(user_id,tech_id,state,ends_at) VALUES ($1,'geologia_1','done',now()),($1,'geologia_2','done',now())", [p.id]);
    const list = (await app.inject({ url: '/research', headers: p.h })).json();
    const g3 = list.techs.find((t: { id: string }) => t.id === 'geologia_3');
    expect(g3).toMatchObject({ state: 'locked', radioRequired: 5, materials: { miedz: 20 } });
    expect((await post(p.h, '/research/geologia_3/start', 'geo-res-0001')).json().error).toBe('radio_too_low');
    await pool.query("UPDATE buildings SET level=5 WHERE user_id=$1 AND type='radiostacja'", [p.id]);
    expect((await post(p.h, '/research/geologia_3/start', 'geo-res-0002')).statusCode).toBe(201);
    expect((await app.inject({ url: '/silo', headers: p.h })).json().wallet.miedz).toBe(30);
  });
});

describe('Handlarz Przekaźnikowy (wymiana NPC)', () => {
  it('od radia 5; kupno za rudę po stałej cenie, idempotentne; geologia bez liczb', async () => {
    const low = await newPlayer(4);
    await grant(low.id, { ore: 5000 });
    expect((await post(low.h, '/exchange/buy', 'ex-key-00001', { material: 'miedz', qty: 5 })).json().error).toBe('radio_too_low');
    const p = await newPlayer(5);
    await grant(p.id, { ore: 5000 });
    const k = 'ex-key-00002';
    const res = await post(p.h, '/exchange/buy', k, { material: 'krysztal', qty: 10 });
    expect(res.statusCode).toBe(201);
    expect(res.json().cost).toBe(config.exchange.buy_ore.krysztal! * 10);
    expect((await post(p.h, '/exchange/buy', k, { material: 'krysztal', qty: 10 })).headers['idempotent-replay']).toBe('true');
    const w = (await app.inject({ url: '/silo', headers: p.h })).json().wallet;
    expect(w.krysztal).toBe(10);
    expect(w.ore).toBeLessThanOrEqual(5300 - config.exchange.buy_ore.krysztal! * 10 + 5);
    expect((await post(p.h, '/exchange/buy', 'ex-key-00003', { material: 'zloto', qty: 1 })).json().error).toBe('unknown_material');
    expect((await post(p.h, '/exchange/buy', 'ex-key-00004', { material: 'miedz', qty: 500 })).json().error).toBe('insufficient_ore');
    const geo = (await app.inject({ url: '/geology', headers: p.h })).json();
    expect(geo.materials).toHaveLength(3);
    expect(['obfity', 'sredni', 'slady']).toContain(geo.materials[0].local);
    expect(new Set(geo.materials.map((m: { local: string }) => m.local)).size).toBe(3);
    expect(JSON.stringify(geo)).not.toMatch(/0\.\d/);
    expect(await auditLedger(db)).toEqual([]);
  });
});
