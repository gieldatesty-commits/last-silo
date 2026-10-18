import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger } from '../src/ledger.js';
import { computeEffects, researchSeconds } from '../src/game/research.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-04-01T10:00:00Z');
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 5 });
const tick = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000));
const tech = (id: string) => config.research.techs.find((t) => t.id === id)!;

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
async function newPlayer() {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Badacz${++n}`, archetype: 'inzynier' } });
  return { id: reg.userId as string, h };
}
let g = 0;
const grant = (id: string, ore: number, tokens = 0) =>
  db.transaction().execute((trx) =>
    applyLedger(trx, id, [{ resource: 'ore', delta: ore, reason: 'admin_adjust', ref: `rg-o-${++g}` }, { resource: 'tokens', delta: tokens, reason: 'admin_adjust', ref: `rg-t-${g}` }], 't'),
  );
const post = (h: Record<string, string>, path: string, key: string, payload: unknown = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload: payload as object });
const setLab = (id: string, level: number) => pool.query("UPDATE buildings SET level=$2 WHERE user_id=$1 AND type='laboratorium'", [id, level]);
const research = async (h: Record<string, string>) => (await app.inject({ url: '/research', headers: h })).json();

describe('formuły badań', () => {
  it('efekty sumują się, odblokowania zbierane', () => {
    const fx = computeEffects(config, ['geologia_1', 'geologia_2', 'hydraulika_1', 'metalurgia', 'sejsmika', 'precyzja']);
    expect(fx.diveOre).toBeCloseTo(1.07, 9);
    expect(fx.diveSteam).toBeCloseTo(0.96, 9);
    expect(fx.repair).toBeCloseTo(0.9, 9);
    expect(fx.divePower).toBeCloseTo(0.3, 9);
    expect(fx.quality).toBeCloseTo(0.04, 9);
    expect(fx.unlocked.has('helm_wzmocniony')).toBe(true);
    expect(fx.unlocked.has('skaner_sejsmiczny')).toBe(true);
  });
  it('laboratorium skraca czas, nie więcej niż o połowę', () => {
    expect(researchSeconds(config, 1000, 1)).toBe(1000);
    expect(researchSeconds(config, 1000, 5)).toBe(800);
    expect(researchSeconds(config, 1000, 50)).toBe(500);
  });
  it('config spójny: wymagania, odblokowania i receptury wskazują istniejące byty', () => {
    const ids = new Set(config.research.techs.map((t) => t.id));
    for (const t of config.research.techs) for (const q of t.requires) expect(ids.has(q)).toBe(true);
    for (const r of config.items.recipes) if (r.tech) expect(config.research.techs.find((t) => t.id === r.tech)!.unlocks).toContain(r.id);
  });
});

describe('dział nauki', () => {
  it('drzewo: dostępne vs zablokowane (wymogi, poziom Laboratorium)', async () => {
    const { h } = await newPlayer();
    const r = await research(h);
    const st = (id: string) => r.techs.find((t: { id: string }) => t.id === id).state;
    expect(st('geologia_1')).toBe('available');
    expect(st('geologia_2')).toBe('locked');
    expect(st('metalurgia')).toBe('locked'); // lab 2
  });

  it('start: koszt w dzienniku, jedno badanie naraz, ukończenie po czasie, idempotencja', async () => {
    const { id, h } = await newPlayer();
    const res = await post(h, '/research/geologia_1/start', 'res-start-01');
    expect(res.statusCode).toBe(201);
    expect((await post(h, '/research/geologia_1/start', 'res-start-01')).headers['idempotent-replay']).toBe('true');
    const busy = await post(h, '/research/hydraulika_1/start', 'res-start-02');
    expect(busy.json().error).toBe('research_busy');
    expect((await research(h)).active.techId).toBe('geologia_1');
    expect((await app.inject({ url: '/silo', headers: h })).json().wallet.ore).toBe(config.economy.start_ore - tech('geologia_1').ore);
    tick(tech('geologia_1').seconds + 1);
    const r = await research(h);
    expect(r.active).toBeNull();
    expect(r.techs.find((t: { id: string }) => t.id === 'geologia_1').state).toBe('done');
    expect((await post(h, '/research/geologia_1/start', 'res-start-03')).json().error).toBe('already_researched');
    expect(await auditLedger(db)).toEqual([]);
    expect(id).toBeTruthy();
  });

  it('wymogi: poprzednik, poziom Laboratorium, środki', async () => {
    const { id, h } = await newPlayer();
    expect((await post(h, '/research/geologia_2/start', 'res-req-0001')).json().error).toBe('prerequisites_missing');
    expect((await post(h, '/research/metalurgia/start', 'res-req-0002')).json().error).toBe('lab_too_low');
    await setLab(id, 2);
    await post(h, '/research/hydraulika_1/start', 'res-req-0003'); // zjada rudę startową? 250 z 300
    tick(2000);
    const poor = await post(h, '/research/metalurgia/start', 'res-req-0004');
    expect(poor.statusCode).toBe(402);
    expect((await post(h, '/research/nie_ma/start', 'res-req-0005')).statusCode).toBe(400);
  });

  it('badanie odblokowuje recepturę i daje bonusy (rzeczywiste efekty)', async () => {
    const { id, h } = await newPlayer();
    await setLab(id, 3);
    await grant(id, 20000, 50);
    // receptura zablokowana do czasu badania (warsztat 3 spełnia wymóg poziomu)
    await pool.query("UPDATE buildings SET level=3 WHERE user_id=$1 AND type='warsztat'", [id]);
    expect((await post(h, '/items/craft', 'tech-craft-01', { recipeId: 'helm_wzmocniony' })).json().error).toBe('recipe_locked');
    const items0 = (await app.inject({ url: '/items', headers: h })).json();
    expect(items0.recipes.find((x: { id: string }) => x.id === 'helm_wzmocniony').locked).toBe(true);

    await post(h, '/research/metalurgia/start', 'tech-res-0001');
    tick(tech('metalurgia').seconds);
    expect((await research(h)).techs.find((t: { id: string }) => t.id === 'metalurgia').state).toBe('done');
    const ok = await post(h, '/items/craft', 'tech-craft-02', { recipeId: 'helm_wzmocniony' });
    expect(ok.statusCode).toBe(201);

    // naprawa tańsza o 10%
    const item = ok.json();
    await pool.query('UPDATE items SET durability = 0 WHERE id=$1', [item.id]);
    const rc = config.items.recipes.find((r) => r.id === 'helm_wzmocniony')!;
    const rep = await post(h, `/items/${item.id}/repair`, 'tech-repair-1');
    expect(rep.json().paid).toBe(Math.ceil(rc.ore * config.items.repair_cost_fraction * 0.9));

    // Geologia I: więcej rudy na liście tras; Hydraulika I: mniej pary
    const before = (await app.inject({ url: '/dives/routes', headers: h })).json()[0];
    await post(h, '/research/geologia_1/start', 'tech-res-0002');
    tick(tech('geologia_1').seconds);
    await post(h, '/research/hydraulika_1/start', 'tech-res-0003');
    tick(tech('hydraulika_1').seconds);
    const after = (await app.inject({ url: '/dives/routes', headers: h })).json();
    expect(after[1].ore[1]).toBeGreaterThan(0);
    expect(after[0].steam).toBeLessThanOrEqual(before.steam);
    expect(after[3].steam).toBe(Math.ceil(config.dives.routes[3]!.steam * 0.96));
    expect(await auditLedger(db)).toEqual([]);
  });

  it('Organizacja robót obniża koszt ulepszeń', async () => {
    const { id, h } = await newPlayer();
    await setLab(id, 2);
    await grant(id, 5000);
    const cost0 = (await app.inject({ url: '/silo', headers: h })).json().buildings.find((b: { type: string }) => b.type === 'magazyn').next.cost;
    await post(h, '/research/ekonomika_prac_1/start', 'eco-res-0001');
    tick(tech('ekonomika_prac_1').seconds);
    await research(h);
    const cost1 = (await app.inject({ url: '/silo', headers: h })).json().buildings.find((b: { type: string }) => b.type === 'magazyn').next.cost;
    expect(cost1).toBeLessThan(cost0);
  });
});
