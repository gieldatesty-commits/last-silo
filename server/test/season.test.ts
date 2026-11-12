import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { auditLedger } from '../src/ledger.js';
import { rewardFor, seasonTick } from '../src/services/season.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const T0 = new Date('2026-04-01T10:00:00Z');
let clock = T0;
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1 });
const ctx = { db, config, now: () => clock, scheduler: { schedule: async () => undefined } };
const days = (d: number) => new Date(T0.getTime() + d * 86_400_000);

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
async function newPlayer(archetype = 'gornik') {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  const nickname = `Sezon${++n}`;
  const r = await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname, archetype } });
  expect(r.statusCode).toBe(201);
  return { id: reg.userId as string, h, nickname };
}
const post = (h: Record<string, string>, path: string, key: string, payload: object = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload });
const get = async (h: Record<string, string>, path: string) => (await app.inject({ url: path, headers: h })).json();

describe('nagrody sezonu', () => {
  it('pierwsza pasująca: miejsce 1, procent, minimalny poziom', () => {
    expect(rewardFor(config, 1, 50, 1)?.id).toBe('mistrz_glebi');
    expect(rewardFor(config, 3, 50, 30)?.id).toBe('starszy_sztygar'); // top 10% z 50 = 5
    expect(rewardFor(config, 10, 50, 30)?.id).toBe('sztygar'); // top 33% z 50 = 17
    expect(rewardFor(config, 40, 50, 12)?.id).toBe('weteran');
    expect(rewardFor(config, 3, 50, 3)).toBeNull(); // za niski poziom
    for (const r of config.season.rewards) expect(r.start_bonus_ore).toBeLessThanOrEqual(config.season.max_bonus_ore);
  });
});

describe('cykl sezonu', () => {
  it('tworzy sezon 1, blokuje akcje po końcu, zamyka z wynikami i resetuje świat', async () => {
    const a = await newPlayer('gornik');
    const b = await newPlayer('inzynier');
    await pool.query('UPDATE players SET level = 6 WHERE user_id = $1', [b.id]);

    let s = await get(a.h, '/season');
    expect(s.season).toBe(1);
    expect(s.phase).toBe('active');
    expect(s.lengthDays).toBe(180);
    expect(s.daysLeft).toBe(180);

    // ekwipunek w zestawie 2 (aktywny): po resecie ma zniknąć, a aktywny wraca na 1
    const itemId = (await pool.query("INSERT INTO items (user_id, recipe_id, slot, quality, durability, max_durability) VALUES ($1, 'kilof', 'narzedzie', 1, 20, 20) RETURNING id", [a.id])).rows[0].id;
    await pool.query("INSERT INTO loadouts (user_id, loadout, slot, item_id) VALUES ($1, 2, 'narzedzie', $2)", [a.id, itemId]);
    await pool.query('UPDATE players SET active_loadout = 2 WHERE user_id = $1', [a.id]);

    // dzień 100: gra normalnie
    clock = days(100);
    expect((await get(a.h, '/season')).day).toBe(101);

    // po końcu: akcje blokowane, widok to przerwa
    clock = days(181);
    const blocked = await post(a.h, '/dives', 'dive-aaaaaaaa1', { routeId: 'plytki' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('season_ended');
    s = await get(a.h, '/season');
    expect(s.phase).toBe('intermission');
    expect(s.nextSeasonAt).toBeTruthy();

    // wyniki: dokładnie jeden Mistrz, drugi gracz poziom 6 → weteran
    const res = await get(a.h, '/season/results');
    expect(res.season).toBe(1);
    expect(res.total).toBe(2);
    expect(res.top.map((t: { rank: number }) => t.rank)).toEqual([1, 2]);
    const titles = res.top.map((t: { title: string | null }) => t.title);
    expect(titles).toContain('Mistrz Głębi');
    expect(titles).toContain('Weteran sezonu');
    const sBefore = await get(a.h, '/season');
    expect(sBefore.carryBonusOre + (await get(b.h, '/season')).carryBonusOre).toBe(400 + 100);

    // w przerwie nadal blokada; po 48 h start sezonu 2 i reset
    clock = new Date(days(180).getTime() + 47 * 3_600_000);
    expect((await post(a.h, '/dives', 'dive-aaaaaaaa2', { routeId: 'plytki' })).json().error).toBe('season_ended');
    clock = new Date(days(180).getTime() + 49 * 3_600_000);
    const t = await seasonTick(ctx);
    expect(t.action).toBe('started');
    s = await get(a.h, '/season');
    expect(s.season).toBe(2);
    expect(s.phase).toBe('active');
    expect(s.titles.length).toBeGreaterThanOrEqual(1);

    // świat wyczyszczony; konto i tytuły zostały
    const silo = await app.inject({ url: '/silo', headers: a.h });
    expect(silo.statusCode).not.toBe(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM silos')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM ledger_entries')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM loadouts')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT active_loadout FROM players WHERE user_id = $1', [a.id])).rows[0].active_loadout).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM ledger_archive WHERE season_id = 1')).rows[0].n).toBeGreaterThan(0);

    // nowa postać: nick znów wolny, bonus startowy doliczony raz
    const master = res.top.find((x: { title: string }) => x.title === 'Mistrz Głębi').nickname as string;
    const winner = master === a.nickname ? a : b;
    const created = await app.inject({ method: 'POST', url: '/players', headers: winner.h, payload: { nickname: master, archetype: 'zwiadowca' } });
    expect(created.statusCode).toBe(201);
    const wallet = (await get(winner.h, '/silo')).wallet;
    expect(wallet.ore).toBe(config.economy.start_ore + 400);
    expect((await get(winner.h, '/season')).carryBonusOre).toBe(0);
    expect(await auditLedger(db)).toEqual([]);
  });

  it('seasonTick jest idempotentny w trakcie sezonu', async () => {
    await newPlayer();
    const t1 = await seasonTick(ctx);
    const t2 = await seasonTick(ctx);
    expect(t1.action).toBe('none');
    expect(t2.action).toBe('none');
    expect((await pool.query('SELECT count(*)::int AS n FROM seasons')).rows[0].n).toBe(1);
  });
});
