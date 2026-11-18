import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { FakeGoogleIdVerifier } from '../src/google-id.js';
import { migrate } from '../src/migrate.js';
import { accountCode } from '../src/services/account.js';
import { handleRequest, listRequests } from '../src/services/deletion-requests.js';

/** Usuwanie konta przez stronę WWW (docs/superpowers/specs/2026-11-18-usuwanie-konta-www-design.md). */
const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const clock = new Date('2026-04-01T10:00:00Z');
const verifier = new FakeGoogleIdVerifier();
const google = { verifier, requireNonce: false };
const deps = { db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1, google, authRateLimitPerMinute: 1000 };
const CLIENT_ID = '123-test.apps.googleusercontent.com';
const app = buildApp({ ...deps, googleWebClientId: CLIENT_ID });
const limited = buildApp({ ...deps, authRateLimitPerMinute: 2 });
const noGoogle = buildApp({ ...deps, google: null, contactEmail: 'pomoc@lastsilo.test' });

beforeAll(async () => {
  await migrate(pool);
});
beforeEach(() => verifier.tokens.clear());
afterAll(async () => {
  for (const a of [app, limited, noGoogle]) await a.close();
  await db.destroy();
});

let n = 0;
let k = 0;
async function player(a = app) {
  const reg = (await a.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  const nickname = `Www${Date.now() % 100000}${++n}`;
  const r = await a.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname, archetype: 'gornik' } });
  expect(r.statusCode).toBe(201);
  return { id: reg.userId as string, h, nickname };
}
const run = Date.now().toString(36); // baza testowa nie jest czyszczona między plikami: sub unikalny na uruchomienie
function idToken(sub: string) {
  sub = `${sub}-${run}`;
  const t = `google-id-token-${sub}-${++k}`;
  verifier.tokens.set(t, { sub, nonce: null });
  return t;
}
async function linked(sub: string) {
  const p = await player();
  const r = await app.inject({ method: 'POST', url: '/account/google/link', headers: { ...p.h, 'idempotency-key': `www-link-${++k}-xxxx` }, payload: { idToken: idToken(sub) } });
  expect(r.statusCode).toBe(200);
  return p;
}
const delByGoogle = (payload: object, a = app) => a.inject({ method: 'POST', url: '/account/delete-by-google', payload });
const request = (payload: object, a = app) => a.inject({ method: 'POST', url: '/account/deletion-requests', payload });
const userExists = async (id: string) => !!(await db.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst());
const requestRow = (nickname: string, code: string) =>
  db.selectFrom('deletion_requests').selectAll().where('nickname', '=', nickname).where('code', '=', code).executeTakeFirstOrThrow();

describe('kod konta', () => {
  it('accountCode: pierwsze 8 znaków userId wielkimi literami, z myślnikiem', () => {
    expect(accountCode('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe('1A2B-3C4D');
  });

  it('GET /account zwraca code', async () => {
    const p = await player();
    expect((await app.inject({ url: '/account', headers: p.h })).json().code).toBe(accountCode(p.id));
  });
});

describe('POST /account/delete-by-google', () => {
  it('konto połączone: usunięte od razu; drugi raz no_linked_account', async () => {
    const p = await linked('www-sub-a');
    const r = await delByGoogle({ idToken: idToken('www-sub-a'), confirm: 'USUN' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ deleted: true, hadActiveSubscription: false });
    expect(await userExists(p.id)).toBe(false);
    const again = await delByGoogle({ idToken: idToken('www-sub-a'), confirm: 'USUN' });
    expect(again.statusCode).toBe(404);
    expect(again.json().error).toBe('no_linked_account');
  });

  it('bez potwierdzenia USUN → 400, konto zostaje', async () => {
    const p = await linked('www-sub-b');
    expect((await delByGoogle({ idToken: idToken('www-sub-b') })).statusCode).toBe(400);
    expect((await delByGoogle({ idToken: idToken('www-sub-b'), confirm: 'tak' })).statusCode).toBe(400);
    expect(await userExists(p.id)).toBe(true);
  });

  it('zły token → 401 bad_google_token', async () => {
    const r = await delByGoogle({ idToken: 'nieznany-token-0000', confirm: 'USUN' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('bad_google_token');
  });

  it('limit prób na IP → 429', async () => {
    for (let i = 0; i < 2; i++) expect((await delByGoogle({ idToken: 'nieznany-token-0000', confirm: 'USUN' }, limited)).statusCode).toBe(401);
    const r = await delByGoogle({ idToken: 'nieznany-token-0000', confirm: 'USUN' }, limited);
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toBe('too_many_requests');
  });
});

describe('POST /account/deletion-requests', () => {
  it('pseudonim i kod pasują (kod małymi literami, z myślnikiem) → 202, prośba z user_id', async () => {
    const p = await player();
    const code = accountCode(p.id).toLowerCase();
    const r = await request({ nickname: p.nickname, code, message: 'Proszę o usunięcie' });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ received: true });
    const row = await requestRow(p.nickname, code);
    expect(row).toMatchObject({ user_id: p.id, nickname: p.nickname, message: 'Proszę o usunięcie', handled_at: null });
    expect(row.created_at.toISOString()).toBe(clock.toISOString());
    expect(await userExists(p.id)).toBe(true); // prośba niczego nie usuwa
  });

  it('pseudonim z kodem innego gracza → ta sama odpowiedź, user_id NULL', async () => {
    const a = await player();
    const b = await player();
    const ok = await request({ nickname: a.nickname, code: accountCode(a.id).replace('-', '') });
    const bad = await request({ nickname: a.nickname, code: accountCode(b.id) });
    expect(bad.statusCode).toBe(ok.statusCode);
    expect(bad.json()).toEqual(ok.json());
    expect((await requestRow(a.nickname, accountCode(b.id))).user_id).toBeNull();
    expect((await requestRow(a.nickname, accountCode(a.id).replace('-', ''))).user_id).toBe(a.id);
  });

  it('puste pola i za długa wiadomość → 400 bad_request', async () => {
    expect((await request({ nickname: '', code: '1A2B-3C4D' })).statusCode).toBe(400);
    expect((await request({ nickname: 'Ktoś', code: '' })).statusCode).toBe(400);
    const r = await request({ nickname: 'Ktoś', code: '1A2B-3C4D', message: 'x'.repeat(1001) });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('bad_request');
  });

  it('limit prób na IP → 429', async () => {
    for (let i = 0; i < 2; i++) expect((await request({ nickname: 'Ktoś', code: '1A2B-3C4D' }, limited)).statusCode).toBe(202);
    expect((await request({ nickname: 'Ktoś', code: '1A2B-3C4D' }, limited)).statusCode).toBe(429);
  });
});

describe('strony WWW', () => {
  it('/usun-konto: HTML z identyfikatorem klienta Google i domyślnym kontaktem', async () => {
    const r = await app.inject({ url: '/usun-konto' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.body).toContain('accounts.google.com/gsi/client');
    expect(r.body).toContain(CLIENT_ID);
    expect(r.body).toContain('kontakt@example.com');
    expect(r.body).toContain('/account/deletion-requests');
    expect(r.body).not.toContain('{{');
  });

  it('bez Google: bez skryptu GIS i sekcji Google, własny kontakt; delete-by-google → 503', async () => {
    const r = await noGoogle.inject({ url: '/usun-konto' });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('accounts.google.com/gsi/client');
    expect(r.body).not.toContain('Konto połączone z Google');
    expect(r.body).toContain('pomoc@lastsilo.test');
    expect(r.body).toContain('Konto gościa');
    const d = await noGoogle.inject({ method: 'POST', url: '/account/delete-by-google', payload: { idToken: 'x', confirm: 'USUN' } });
    expect(d.statusCode).toBe(503);
  });

  it('/prywatnosc: HTML z linkiem do /usun-konto i kontaktem', async () => {
    const r = await noGoogle.inject({ url: '/prywatnosc' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.body).toContain('href="/usun-konto"');
    expect(r.body).toContain('pomoc@lastsilo.test');
    expect(r.body).not.toContain('{{');
  });
});

describe('obsługa próśb (skrypt deletion-requests)', () => {
  const ctx = { db, config, now: () => clock, scheduler: { schedule: async () => undefined } };
  const open = async (nickname: string) => (await listRequests(ctx)).find((r) => r.nickname === nickname);

  it('delete dla dopasowanej: konto usunięte, prośba obsłużona i znika z listy', async () => {
    const p = await player();
    await request({ nickname: p.nickname, code: accountCode(p.id) });
    const row = await open(p.nickname);
    expect(row?.userId).toBe(p.id);
    expect(await handleRequest(ctx, row!.id, 'delete')).toBe('deleted');
    expect(await userExists(p.id)).toBe(false);
    expect(await open(p.nickname)).toBeUndefined();
    expect((await db.selectFrom('deletion_requests').select('handled_at').where('id', '=', row!.id).executeTakeFirstOrThrow()).handled_at).not.toBeNull();
  });

  it('delete dla niedopasowanej: no_match, nic nie znika, prośba zostaje otwarta', async () => {
    const p = await player();
    await request({ nickname: p.nickname, code: '0000-0000' });
    const row = await open(p.nickname);
    expect(row?.userId).toBeNull();
    expect(await handleRequest(ctx, row!.id, 'delete')).toBe('no_match');
    expect(await userExists(p.id)).toBe(true);
    expect(await open(p.nickname)).toBeDefined();
  });

  it('reject: obsłużona bez usuwania', async () => {
    const p = await player();
    await request({ nickname: p.nickname, code: accountCode(p.id) });
    const row = await open(p.nickname);
    expect(await handleRequest(ctx, row!.id, 'reject')).toBe('rejected');
    expect(await userExists(p.id)).toBe(true);
    expect(await open(p.nickname)).toBeUndefined();
  });
});
