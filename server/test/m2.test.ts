import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { auditLedger } from '../src/ledger.js';
import { resolveDive, routeRewards, xpToNext } from '../src/game/dive.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-04-01T10:00:00Z');
let nextSeed = 1;
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => nextSeed });
const tick = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000));
const plytki = config.dives.routes.find((r) => r.id === 'plytki')!;
const PX = routeRewards(config, plytki).xp;
const gornik = { sila: 5, technika: 3, percepcja: 2, wytrwalosc: 4 };
const fullPool = { remaining: 1000, total: 1000 };

const findSeed = (success: boolean) => {
  for (let s = 1; s < 1000; s++) if (resolveDive(config, plytki, gornik, 1.1, s, fullPool).success === success) return s;
  throw new Error('brak ziarna');
};

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

async function newPlayer(nickname = 'Zjazdowiec', archetype = 'gornik') {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname, archetype } });
  return { id: reg.userId as string, h };
}
const dive = (h: Record<string, string>, routeId: string, key: string) => app.inject({ method: 'POST', url: '/dives', headers: { ...h, 'idempotency-key': key }, payload: { routeId } });
const silo = async (h: Record<string, string>) => (await app.inject({ url: '/silo', headers: h })).json();

describe('zjazdy', () => {
  it('lista tras: szansa dla gracza, blokada poziomem, bez liczb o puli', async () => {
    const { h } = await newPlayer();
    const res = await app.inject({ url: '/dives/routes', headers: h });
    const routes = res.json();
    expect(routes).toHaveLength(config.dives.routes.length);
    expect(routes[0]).toMatchObject({ id: 'plytki', locked: false, chancePct: 58, steam: 3 });
    expect(routes[1].locked).toBe(true);
    expect(res.body).not.toMatch(/remaining|pool|total/i);
  });

  it('start: para schodzi, kolejka 2 zjazdy, trzeci odrzucony, idempotencja', async () => {
    const { h } = await newPlayer();
    const a = await dive(h, 'plytki', 'zjazd-0001');
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ routeId: 'plytki', steamCost: 3, queuePosition: 1 });
    const b = await dive(h, 'plytki', 'zjazd-0002');
    expect(b.statusCode).toBe(201);
    expect(b.json().queuePosition).toBe(2);
    expect(b.json().startsAt).toBe(a.json().endsAt); // drugi startuje po pierwszym
    expect((await dive(h, 'plytki', 'zjazd-0003')).json().error).toBe('queue_full');
    expect((await silo(h)).wallet.steam).toBe(94);
    const again = await dive(h, 'plytki', 'zjazd-0001');
    expect(again.headers['idempotent-replay']).toBe('true');
    const v = await silo(h);
    expect(v.wallet.steam).toBe(94);
    expect(v.queueSlots).toBe(2);
    expect(v.queue).toHaveLength(2);
    expect(v.queue.map((q: { running: boolean }) => q.running)).toEqual([true, false]);
  });

  it('abonament: 3 zjazdy w kolejce; wygasły abonament wraca do 2', async () => {
    const { id, h } = await newPlayer();
    await db.updateTable('players').set({ subscription_until: new Date(clock.getTime() + 30 * 86400_000) }).where('user_id', '=', id).execute();
    for (let i = 1; i <= 3; i++) expect((await dive(h, 'plytki', `abo-${i}-xxxxxx`)).statusCode).toBe(201);
    expect((await dive(h, 'plytki', 'abo-4-xxxxxx')).json().error).toBe('queue_full');
    expect((await silo(h)).queueSlots).toBe(3);
    tick(31 * 86400); // abonament wygasł, kolejka opróżniona
    const v = await silo(h);
    expect(v.queueSlots).toBe(2);
    expect(v.queue).toHaveLength(0);
  });

  it('kolejka rozlicza zjazdy po kolei, każdy z własnym wynikiem', async () => {
    const { id, h } = await newPlayer();
    nextSeed = findSeed(true);
    await dive(h, 'plytki', 'kol-1-xxxxxx');
    await dive(h, 'plytki', 'kol-2-xxxxxx');
    tick(181);
    let v = await silo(h);
    expect(v.queue).toHaveLength(1);
    expect(v.queue[0].running).toBe(true);
    tick(181);
    v = await silo(h);
    expect(v.queue).toHaveLength(0);
    const done = await db.selectFrom('dives').selectAll().where('user_id', '=', id).where('state', '=', 'resolved').execute();
    expect(done).toHaveLength(2);
    expect(v.player.xp).toBe(2 * PX);
  });

  it('walidacja: poziom, nieznana trasa, brak pary', async () => {
    const { id, h } = await newPlayer();
    expect((await dive(h, 'sredni', 'zjazd-0003')).json().error).toBe('level_too_low');
    expect((await dive(h, 'nie-ma', 'zjazd-0004')).json().error).toBe('unknown_route');
    await db.updateTable('silos').set({ steam: 2 }).where('user_id', '=', id).execute();
    expect((await dive(h, 'plytki', 'zjazd-0005')).statusCode).toBe(402);
    expect((await silo(h)).wallet.steam).toBe(2);
  });

  it('sukces: nagroda w rudzie przez ledger, XP, powiadomienie, historia', async () => {
    const { id, h } = await newPlayer();
    nextSeed = findSeed(true);
    await dive(h, 'plytki', 'zjazd-0006');
    const before = (await silo(h)).wallet.ore;
    tick(181);
    const expected = resolveDive(config, plytki, gornik, 1.1, nextSeed, fullPool);
    const v = await silo(h);
    expect(v.queue).toHaveLength(0);
    expect(v.wallet.ore - before).toBeGreaterThanOrEqual(expected.ore); // plus drobna produkcja szybu
    expect(v.wallet.ore - before).toBeLessThanOrEqual(expected.ore + 3);
    expect(v.player.xp).toBe(PX);
    const n = await db.selectFrom('notifications').selectAll().where('user_id', '=', id).where('type', '=', 'dive_done').execute();
    expect(n).toHaveLength(1);
    const hist = (await app.inject({ url: '/dives/history', headers: h })).json();
    expect(hist).toHaveLength(1);
    expect(hist[0].result).toMatchObject({ success: true, ore: expected.ore, xp: PX });
    const ledger = await db.selectFrom('ledger_entries').selectAll().where('user_id', '=', id).where('reason', '=', 'dive_reward').execute();
    expect(ledger).toHaveLength(1); // żetony = 0 na Płytkim, więc brak wpisu
  });

  it('porażka: zadyszka blokuje kolejny zjazd, potem znów można', async () => {
    const { h } = await newPlayer();
    nextSeed = findSeed(false);
    await dive(h, 'plytki', 'zjazd-0007');
    tick(181);
    const v = await silo(h);
    expect(v.player.xp).toBe(Math.round(PX * config.dives.fail_reward_fraction));
    expect(v.windedUntil).not.toBeNull();
    expect((await dive(h, 'plytki', 'zjazd-0008')).json().error).toBe('winded');
    tick(301);
    expect((await dive(h, 'plytki', 'zjazd-0009')).statusCode).toBe(201);
  });

  it('awans: punkty statystyk, rozdanie, limity', async () => {
    const { id, h } = await newPlayer();
    await db.updateTable('players').set({ xp: String(xpToNext(config, 1) - 1) }).where('user_id', '=', id).execute();
    nextSeed = findSeed(true);
    await dive(h, 'plytki', 'zjazd-0010');
    tick(181);
    const v = await silo(h);
    expect(v.player).toMatchObject({ level: 2, xp: xpToNext(config, 1) - 1 + PX - xpToNext(config, 1), freePoints: 3 });
    const bad = await app.inject({ method: 'POST', url: '/players/stats', headers: h, payload: { technika: 4 } });
    expect(bad.json().error).toBe('not_enough_points');
    const ok = await app.inject({ method: 'POST', url: '/players/stats', headers: h, payload: { technika: 2, percepcja: 1 } });
    expect(ok.json().player).toMatchObject({ freePoints: 0, stats: { sila: 5, technika: 5, percepcja: 3, wytrwalosc: 4 } });
    expect((await app.inject({ method: 'POST', url: '/players/stats', headers: h, payload: {} })).statusCode).toBe(400);
  });

  it('każdy nowy silos dokłada swój udział do wspólnych pul', async () => {
    await newPlayer('Pierwszy');
    await newPlayer('Drugi');
    await newPlayer('Trzeci');
    const pools = await db.selectFrom('world_pools').selectAll().execute();
    for (const [zone, z] of Object.entries(config.dives.zones)) {
      const row = pools.find((p) => p.zone === zone)!;
      expect(row.total).toBe(3 * z.pool_per_player);
      expect(row.remaining).toBe(3 * z.pool_per_player);
    }
  });

  it('wspólna pula: nagroda maleje z jej wyczerpaniem, poniżej podłogi pula stoi', async () => {
    const { h } = await newPlayer();
    const zone = plytki.zone;
    const total = (await db.selectFrom('world_pools').select('total').where('zone', '=', zone).executeTakeFirstOrThrow()).total;
    await db.updateTable('world_pools').set({ remaining: total * 0.5 }).where('zone', '=', zone).execute();
    nextSeed = findSeed(true);
    await dive(h, 'plytki', 'zjazd-0011');
    tick(181);
    await silo(h);
    const expected = resolveDive(config, plytki, gornik, 1.1, nextSeed, { remaining: total * 0.5, total });
    const p1 = await db.selectFrom('world_pools').selectAll().where('zone', '=', zone).executeTakeFirstOrThrow();
    expect(p1.remaining).toBeCloseTo(total * 0.5 - expected.ore, 6);

    await db.updateTable('world_pools').set({ remaining: total * 0.05 }).where('zone', '=', zone).execute();
    await dive(h, 'plytki', 'zjazd-0012');
    tick(181);
    await silo(h);
    const p2 = await db.selectFrom('world_pools').selectAll().where('zone', '=', zone).executeTakeFirstOrThrow();
    expect(p2.remaining).toBeCloseTo(total * 0.05, 6); // ślady bez ubywania
  });

  it('dwóch graczy rozlicza się na jednej puli bez utraty rudy', async () => {
    const a = await newPlayer('Pierwszy');
    const b = await newPlayer('Drugi');
    nextSeed = findSeed(true);
    await Promise.all([dive(a.h, 'plytki', 'rownol-a1'), dive(b.h, 'plytki', 'rownol-b1')]);
    tick(181);
    await Promise.all([silo(a.h), silo(b.h)]);
    const pools = await db.selectFrom('world_pools').selectAll().execute();
    const drawn = pools.reduce((s, p) => s + (p.total - p.remaining), 0);
    const rewards = await db.selectFrom('ledger_entries').select((e) => e.fn.sum('delta').as('t')).where('reason', '=', 'dive_reward').executeTakeFirstOrThrow();
    expect(Math.round(drawn)).toBe(Number(rewards.t)); // ile ubyło z puli = ile wypłacono
    expect(await auditLedger(db)).toEqual([]);
  });

  it('równoległe starty tego gracza: tyle zjazdów, ile mieści kolejka', async () => {
    const { h, id } = await newPlayer();
    const rs = await Promise.all([1, 2, 3, 4].map((i) => dive(h, 'plytki', `rownol-s${i}-xx`)));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(2); // pojemność kolejki
    expect((await db.selectFrom('dives').selectAll().where('user_id', '=', id).execute()).length).toBe(2);
    expect((await silo(h)).wallet.steam).toBe(94);
  });

  it('ten sam stan niezależnie od częstości odświeżania', async () => {
    const a = await newPlayer('Czesto');
    const b = await newPlayer('Rzadko');
    nextSeed = findSeed(true);
    await dive(a.h, 'plytki', 'cz-a1-xxxx');
    await dive(b.h, 'plytki', 'cz-b1-xxxx');
    for (let i = 0; i < 30; i++) {
      tick(60);
      await silo(a.h);
    }
    const va = await silo(a.h);
    const vb = await silo(b.h);
    expect(vb.wallet).toEqual(va.wallet);
    expect(vb.player.xp).toBe(va.player.xp);
  });
});
