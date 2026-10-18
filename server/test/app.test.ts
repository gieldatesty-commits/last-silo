import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890' });

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('config', () => {
  it('wczytuje game.yaml', () => {
    expect(config.buildings).toHaveLength(6);
  });
  it('odrzuca zduplikowane id', () => {
    const y = readFileSync('../config/game.yaml', 'utf8').replace('- { id: magazyn, name: Magazyn, base_cost: 40 }', '- { id: szyb_glowny, name: X, base_cost: 40 }');
    expect(() => parseGameConfig(y)).toThrow();
  });
});

describe('API', () => {
  it('GET /health', async () => {
    const r = await app.inject('/health');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, configVersion: config.version });
  });

  it('GET /me bez tokenu = 401', async () => {
    expect((await app.inject('/me')).statusCode).toBe(401);
  });

  it('gość: rejestracja, /me i ponowne logowanie', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(reg.statusCode).toBe(201);
    const { userId, guestSecret, token } = reg.json();

    const me = await app.inject({ url: '/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(userId);
    expect(me.json().player).toEqual({ nickname: null, archetype: null });

    const again = await app.inject({ method: 'POST', url: '/auth/guest', payload: { userId, guestSecret } });
    expect(again.statusCode).toBe(200);
    expect(again.json().userId).toBe(userId);

    const bad = await app.inject({ method: 'POST', url: '/auth/guest', payload: { userId, guestSecret: 'x'.repeat(64) } });
    expect(bad.statusCode).toBe(401);
  });

  it('odrzuca userId bez guestSecret', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/guest', payload: { userId: crypto.randomUUID() } });
    expect(r.statusCode).toBe(400);
  });

  it('zapisuje zdarzenie account_created', async () => {
    await app.inject({ method: 'POST', url: '/auth/guest' });
    const rows = await db.selectFrom('events_log').selectAll().where('name', '=', 'account_created').execute();
    expect(rows).toHaveLength(1);
  });
});
