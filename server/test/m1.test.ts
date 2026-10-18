import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger } from '../src/ledger.js';
import { startScheduler, type RunningScheduler } from '../src/scheduler.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-03-01T10:00:00Z');
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock });
const tick = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000));

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
  clock = new Date('2026-03-01T10:00:00Z');
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

async function newPlayer(nickname = 'Kopacz', archetype = 'gornik') {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  const r = await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname, archetype } });
  return { id: reg.userId as string, h, res: r };
}
const upgrade = (h: Record<string, string>, type: string, key: string) =>
  app.inject({ method: 'POST', url: `/buildings/${type}/upgrade`, headers: { ...h, 'idempotency-key': key } });

describe('postać i silos', () => {
  it('tworzy postać ze statystykami, silosem i rudą startową; nie zdradza ukrytych liczb', async () => {
    const { res } = await newPlayer();
    expect(res.statusCode).toBe(201);
    const v = res.json();
    expect(v.player).toMatchObject({ nickname: 'Kopacz', archetype: 'gornik', level: 1, stats: { sila: 5, technika: 3, percepcja: 2, wytrwalosc: 4 } });
    expect(v.wallet).toEqual({ ore: 300, steam: 100, tokens: 0 });
    expect(v.buildings).toHaveLength(5);
    expect(v.buildings.every((b: { level: number }) => b.level === 1)).toBe(true);
    expect(v.silo.lat).toBeGreaterThanOrEqual(-90);
    expect(['bogate', 'srednie', 'ubogie', 'na_wyczerpaniu']).toContain(v.silo.deposit);
    const raw = JSON.stringify(v);
    expect(raw).not.toMatch(/deposit_|depositTotal|depositRemaining|remaining/);
  });

  it('walidacja: nick zajęty (bez względu na wielkość liter), zły archetyp, drugi raz', async () => {
    const a = await newPlayer('Kopacz');
    expect(a.res.statusCode).toBe(201);
    const b = await newPlayer('kopacz');
    expect(b.res.statusCode).toBe(409);
    expect(b.res.json().error).toBe('nickname_taken');
    const c = await newPlayer('Inny', 'nieistnieje');
    expect(c.res.json().error).toBe('unknown_archetype');
    const d = await app.inject({ method: 'POST', url: '/players', headers: a.h, payload: { nickname: 'Drugi', archetype: 'gornik' } });
    expect(d.json().error).toBe('already_created');
    const e = await app.inject({ method: 'POST', url: '/players', headers: (await newPlayer('Ok')).h, payload: { nickname: 'x', archetype: 'gornik' } });
    expect(e.statusCode).toBe(400);
  });

  it('silosy dostają różne pozycje', async () => {
    const ps = [];
    for (let i = 0; i < 8; i++) ps.push((await newPlayer(`Gracz${i}`)).res.json().silo);
    const keys = new Set(ps.map((s) => `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`));
    expect(keys.size).toBe(8);
  });
});

describe('produkcja i ulepszenia', () => {
  it('produkuje rudę w czasie, z limitem magazynu', async () => {
    const { h } = await newPlayer();
    tick(3600);
    let v = (await app.inject({ url: '/silo', headers: h })).json();
    expect(v.wallet.ore).toBeGreaterThanOrEqual(338); // 300 + ~40/h (minus lekki ubytek złoża)
    expect(v.wallet.ore).toBeLessThanOrEqual(340);
    tick(100 * 3600);
    v = (await app.inject({ url: '/silo', headers: h })).json();
    expect(v.wallet.ore).toBe(1000); // cap Magazynu L1
  });

  it('ulepszenie: koszt, kolejka 1 slot, ukończenie po czasie, powiadomienie', async () => {
    const { id, h } = await newPlayer();
    const r1 = await upgrade(h, 'szyb_glowny', 'klucz-0001');
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ type: 'szyb_glowny', toLevel: 2, cost: 80 }); // 50*1.6, Górnik bez zniżki
    const mid = (await app.inject({ url: '/silo', headers: h })).json();
    expect(mid.wallet.ore).toBe(220);
    expect(mid.job).toMatchObject({ type: 'szyb_glowny', toLevel: 2 });

    const r2 = await upgrade(h, 'magazyn', 'klucz-0002');
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error).toBe('queue_full');

    tick(181);
    const done = (await app.inject({ url: '/silo', headers: h })).json();
    expect(done.job).toBeNull();
    expect(done.buildings.find((b: { type: string }) => b.type === 'szyb_glowny').level).toBe(2);
    const n = await db.selectFrom('notifications').selectAll().where('user_id', '=', id).execute();
    expect(n).toHaveLength(1);
    expect(n[0]!.type).toBe('building_done');
  });

  it('Inżynier płaci mniej', async () => {
    const { h } = await newPlayer('Inz', 'inzynier');
    const r = await upgrade(h, 'szyb_glowny', 'klucz-0003');
    expect(r.json().cost).toBe(72); // ceil(80 * 0.9)
  });

  it('brak rudy = 402, nic nie jest zapisane', async () => {
    const { id, h } = await newPlayer();
    await db.transaction().execute((trx) => applyLedger(trx, id, [{ resource: 'ore', delta: -290, reason: 'admin_adjust', ref: 't1' }], config.version));
    const r = await upgrade(h, 'szyb_glowny', 'klucz-0004');
    expect(r.statusCode).toBe(402);
    expect((await db.selectFrom('jobs').selectAll().where('user_id', '=', id).execute()).length).toBe(0);
    expect((await app.inject({ url: '/silo', headers: h })).json().wallet.ore).toBe(10);
  });

  it('wymaga Idempotency-Key', async () => {
    const { h } = await newPlayer();
    const r = await app.inject({ method: 'POST', url: '/buildings/szyb_glowny/upgrade', headers: h });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/buildings/nic/upgrade', headers: { ...h, 'idempotency-key': 'klucz-0005' } })).statusCode).toBe(400);
  });

  it('ten sam klucz = jedna opłata i ta sama odpowiedź', async () => {
    const { h } = await newPlayer();
    const a = await upgrade(h, 'szyb_glowny', 'klucz-0006');
    const b = await upgrade(h, 'szyb_glowny', 'klucz-0006');
    expect(b.statusCode).toBe(201);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.json()).toEqual(a.json());
    expect((await app.inject({ url: '/silo', headers: h })).json().wallet.ore).toBe(220);
  });

  it('równoległe żądania: dokładnie jedno ulepszenie, jedna opłata', async () => {
    const { id, h } = await newPlayer();
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => upgrade(h, i % 2 ? 'szyb_glowny' : 'magazyn', `rownolegle-${i}`)));
    const codes = rs.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect((await db.selectFrom('jobs').selectAll().where('user_id', '=', id).execute()).length).toBe(1);
  });

  it('ten sam klucz równolegle: jedna opłata', async () => {
    const { h } = await newPlayer();
    const rs = await Promise.all([1, 2, 3, 4].map(() => upgrade(h, 'szyb_glowny', 'ten-sam-klucz')));
    expect(rs.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.json().jobId)).size).toBe(1);
    expect((await app.inject({ url: '/silo', headers: h })).json().wallet.ore).toBe(220);
  });

  it('cała kampania: wiele ulepszeń, a audyt ledgera zgodny z portfelami', async () => {
    const { h } = await newPlayer('Audytowany');
    for (let i = 0; i < 6; i++) {
      tick(6 * 3600);
      await upgrade(h, i % 2 ? 'magazyn' : 'szyb_glowny', `kamp-${i}`);
      tick(Number(((await app.inject({ url: '/silo', headers: h })).json().job ? 2 * 3600 : 0)));
    }
    tick(24 * 3600);
    await app.inject({ url: '/silo', headers: h });
    expect(await auditLedger(db)).toEqual([]);
    const total = await db.selectFrom('ledger_entries').select((e) => e.fn.sum('delta').as('t')).where('resource', '=', 'ore').executeTakeFirstOrThrow();
    const wallet = await db.selectFrom('wallets').select('balance').where('resource', '=', 'ore').executeTakeFirstOrThrow();
    expect(Number(total.t)).toBe(Number(wallet.balance));
  });

  it('rozliczenia o różnych porach dają ten sam stan (idempotentny settle)', async () => {
    const a = await newPlayer('Jeden');
    const b = await newPlayer('Dwa');
    await upgrade(a.h, 'szyb_glowny', 'idem-a1');
    await upgrade(b.h, 'szyb_glowny', 'idem-b1');
    for (let i = 0; i < 40; i++) {
      tick(300);
      await app.inject({ url: '/silo', headers: a.h }); // A często odświeża
    }
    tick(0);
    const va = (await app.inject({ url: '/silo', headers: a.h })).json();
    const vb = (await app.inject({ url: '/silo', headers: b.h })).json(); // B pierwszy raz po całym czasie
    expect(vb.wallet.ore).toBe(va.wallet.ore);
    expect(vb.buildings).toEqual(va.buildings);
  });
});

describe('scheduler pg-boss', () => {
  let sch: RunningScheduler;
  afterAll(async () => sch?.stop());

  it('o czasie rozlicza ukończone ulepszenie bez udziału klienta', async () => {
    const real = new Date();
    const app2 = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => new Date() });
    const reg = (await app2.inject({ method: 'POST', url: '/auth/guest' })).json();
    const h = { authorization: `Bearer ${reg.token}` };
    await app2.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: 'Zegar', archetype: 'gornik' } });
    const endsAt = new Date(real.getTime() + 2500);
    const job = await db.insertInto('jobs').values({ user_id: reg.userId, kind: 'building', building_type: 'magazyn', to_level: 2, ends_at: endsAt }).returning('id').executeTakeFirstOrThrow();

    sch = await startScheduler({ db, config, now: () => new Date() }, url);
    await sch.schedule(reg.userId, endsAt);

    let state = 'pending';
    for (let i = 0; i < 40 && state !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      state = (await db.selectFrom('jobs').select('state').where('id', '=', job.id).executeTakeFirstOrThrow()).state;
    }
    expect(state).toBe('done');
    const lvl = await db.selectFrom('buildings').select('level').where('user_id', '=', reg.userId).where('type', '=', 'magazyn').executeTakeFirstOrThrow();
    expect(lvl.level).toBe(2);
    await app2.close();
  });
});
