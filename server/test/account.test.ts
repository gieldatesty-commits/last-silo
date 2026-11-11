import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { FakePlayBilling } from '../src/billing.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { FakeGoogleIdVerifier } from '../src/google-id.js';
import { migrate } from '../src/migrate.js';
import { auditLedger } from '../src/ledger.js';
import { DELETED_NICKNAME } from '../src/services/account.js';
import { seasonTick } from '../src/services/season.js';
import { obfuscatedAccountId, type Billing } from '../src/services/subscription.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const T0 = new Date('2026-04-01T10:00:00Z');
const DAY = 86_400_000;
let clock = T0;
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const verifier = new FakeGoogleIdVerifier();
const google = { verifier, requireNonce: false };
const fakePlay = new FakePlayBilling();
const billing: Billing = { client: fakePlay, accountKey: 'test-account-key-123456', packageName: 'pl.lastsilo.lastsilo' };
const deps = { db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1, billing, google, authRateLimitPerMinute: 1000 };
const app = buildApp(deps);
const strict = buildApp({ ...deps, google: { verifier, requireNonce: true } });
const limited = buildApp({ ...deps, authRateLimitPerMinute: 2 });
const noGoogle = buildApp({ ...deps, google: null });
const ctx = { db, config, now: () => clock, scheduler: { schedule: async () => undefined } };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const LEGACY_ID = '11111111-1111-4111-8111-111111111111';
const LEGACY_SECRET = 'legacy-secret-0123456789abcdef';

beforeAll(async () => {
  // test migracji 015: konto założone przed nią (tylko users.guest_secret_hash) musi dalej się logować
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '015') break;
    await pool.query(readFileSync(join(dir, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  }
  await pool.query('INSERT INTO users (id, guest_secret_hash) VALUES ($1, $2)', [LEGACY_ID, sha256(LEGACY_SECRET)]);
  await pool.query('INSERT INTO players (user_id) VALUES ($1)', [LEGACY_ID]);
  expect(await migrate(pool)).toContain('015_google_account.sql');
});
beforeEach(() => {
  clock = T0;
  verifier.tokens.clear();
  fakePlay.purchases.clear();
});
afterAll(async () => {
  for (const a of [app, strict, limited, noGoogle]) await a.close();
  await db.destroy();
});

let n = 0;
let k = 0;
async function guest(a = app) {
  const reg = (await a.inject({ method: 'POST', url: '/auth/guest' })).json();
  return { id: reg.userId as string, secret: reg.guestSecret as string, h: { authorization: `Bearer ${reg.token}` } };
}
async function player(a = app) {
  const g = await guest(a);
  const r = await a.inject({ method: 'POST', url: '/players', headers: g.h, payload: { nickname: `Konto${++n}`, archetype: 'gornik' } });
  expect(r.statusCode).toBe(201);
  return g;
}
/** token ID Google w atrapie: `tok-<sub>-<nr>` → {sub, nonce} */
function idToken(sub: string, nonce: string | null = null) {
  const t = `google-id-token-${sub}-${++k}`;
  verifier.tokens.set(t, { sub, nonce });
  return t;
}
const link = (h: Record<string, string>, token: string, key = `link-${++k}-xxxx`, a = app) =>
  a.inject({ method: 'POST', url: '/account/google/link', headers: { ...h, 'idempotency-key': key }, payload: { idToken: token } });
const login = (token: string, a = app) => a.inject({ method: 'POST', url: '/auth/google', payload: { idToken: token } });
const nonce = async (a = app) => (await a.inject({ url: '/auth/google/nonce' })).json().nonce as string;
const guestLogin = (userId: string, guestSecret: string) => app.inject({ method: 'POST', url: '/auth/guest', payload: { userId, guestSecret } });

describe('migracja 015', () => {
  it('konto sprzed migracji loguje się starym sekretem (przeniesionym do user_devices)', async () => {
    const r = await guestLogin(LEGACY_ID, LEGACY_SECRET);
    expect(r.statusCode).toBe(200);
    expect(r.json().userId).toBe(LEGACY_ID);
    expect((await guestLogin(LEGACY_ID, 'zly-sekret-0123456789')).statusCode).toBe(401);
  });
});

describe('powiązanie z Google (§2.1)', () => {
  it('udane; GET /account pokazuje google=true', async () => {
    const a = await guest();
    expect((await app.inject({ url: '/account', headers: a.h })).json()).toMatchObject({ google: false, devices: 1 });
    const r = await link(a.h, idToken('sub-a'));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ userId: a.id, google: true, devices: 1 });
    expect(r.json().googleLinkedAt).toBe(T0.toISOString());
  });

  it('ponowienie z tym samym kluczem zwraca zapisaną odpowiedź; ten sam Google drugi raz to sukces bez zmian', async () => {
    const a = await guest();
    const t = idToken('sub-b');
    const r1 = await link(a.h, t, 'link-staly-0001');
    const r2 = await link(a.h, t, 'link-staly-0001');
    expect(r2.headers['idempotent-replay']).toBe('true');
    expect(r2.json()).toEqual(r1.json());
    expect((await link(a.h, idToken('sub-b'))).statusCode).toBe(200);
  });

  it('account_already_linked i google_in_use', async () => {
    const a = await guest();
    const b = await guest();
    await link(a.h, idToken('sub-c'));
    const r1 = await link(a.h, idToken('sub-d'));
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error).toBe('account_already_linked');
    const r2 = await link(b.h, idToken('sub-c'));
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error).toBe('google_in_use');
    expect((await app.inject({ url: '/account', headers: b.h })).json().google).toBe(false);
  });
});

describe('weryfikacja tokenu i nonce (§3)', () => {
  it('zły token (podpis, aud, iss, exp: atrapa zwraca null) → bad_google_token', async () => {
    const a = await guest();
    const r = await link(a.h, 'nieprawidlowy-token-0123456789');
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('bad_google_token');
    expect((await login('nieprawidlowy-token-0123456789')).json().error).toBe('bad_google_token');
  });

  it('nonce: poprawny przechodzi raz; obcy, użyty ponownie i przeterminowany → bad_nonce', async () => {
    const a = await guest();
    const nn = await nonce();
    expect((await link(a.h, idToken('sub-n', nn))).statusCode).toBe(200);
    // ten sam nonce drugi raz (odtworzony token)
    const again = await login(idToken('sub-n', nn));
    expect(again.statusCode).toBe(401);
    expect(again.json().error).toBe('bad_nonce');
    expect((await login(idToken('sub-n', 'nonce-ktorego-nie-wydalismy'))).json().error).toBe('bad_nonce');
    const old = await nonce();
    clock = new Date(T0.getTime() + 11 * 60_000);
    expect((await login(idToken('sub-n', old))).json().error).toBe('bad_nonce');
    // nieudana weryfikacja nie zużywa nonce: po błędnym tokenie świeży nonce dalej działa
    const fresh = await nonce();
    expect((await login('nieprawidlowy-token-0123456789')).statusCode).toBe(401);
    expect((await login(idToken('sub-n', fresh))).statusCode).toBe(200);
  });

  it('GOOGLE_REQUIRE_NONCE=1: token bez nonce odrzucony, z nonce przyjęty', async () => {
    const a = await guest(strict);
    expect((await link(a.h, idToken('sub-s'), undefined, strict)).json().error).toBe('bad_nonce');
    expect((await link(a.h, idToken('sub-s', await nonce(strict)), undefined, strict)).statusCode).toBe(200);
  });

  it('bez GOOGLE_WEB_CLIENT_ID: 503 google_disabled, gra jako gość działa', async () => {
    const a = await guest(noGoogle);
    expect((await noGoogle.inject({ url: '/auth/google/nonce' })).statusCode).toBe(503);
    expect((await login(idToken('sub-x'), noGoogle)).json().error).toBe('google_disabled');
    expect((await link(a.h, idToken('sub-x'), undefined, noGoogle)).json().error).toBe('google_disabled');
  });

  it('limit prób: trzecie logowanie w minucie → 429, po minucie znów można', async () => {
    const t = () => idToken('sub-limit');
    expect((await login(t(), limited)).statusCode).toBe(404);
    expect((await login(t(), limited)).statusCode).toBe(404);
    expect((await login(t(), limited)).statusCode).toBe(429);
    clock = new Date(T0.getTime() + 61_000);
    expect((await login(t(), limited)).statusCode).toBe(404);
  });
});

describe('logowanie na nowym urządzeniu (§2.2)', () => {
  it('to samo konto i postać, nowy sekret; stare urządzenie dalej loguje się jako gość', async () => {
    const a = await player();
    await link(a.h, idToken('sub-dev'));
    const r = await login(idToken('sub-dev'));
    expect(r.statusCode).toBe(200);
    const nd = r.json();
    expect(nd.userId).toBe(a.id);
    expect(nd.guestSecret).not.toBe(a.secret);
    expect((await app.inject({ url: '/me', headers: { authorization: `Bearer ${nd.token}` } })).json().player.nickname).toMatch(/^Konto/);
    expect((await guestLogin(a.id, a.secret)).statusCode).toBe(200); // stary telefon
    expect((await guestLogin(a.id, nd.guestSecret)).statusCode).toBe(200); // nowy telefon bez ponownego Google
    expect((await app.inject({ url: '/account', headers: a.h })).json().devices).toBe(2);
  });

  it('nieznany Google → 404 no_linked_account; nie zakłada konta', async () => {
    const before = Number((await pool.query('SELECT count(*) FROM users')).rows[0].count);
    const r = await login(idToken('sub-nikt'));
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('no_linked_account');
    expect(Number((await pool.query('SELECT count(*) FROM users')).rows[0].count)).toBe(before);
  });

  it('subskrypcja po zalogowaniu na nowym urządzeniu: ten sam token zakupu przechodzi, 3 sloty', async () => {
    const a = await player();
    await link(a.h, idToken('sub-pay'));
    fakePlay.set('play-tok', { productId: config.subscription.product_ids[0]!, expiryTime: at(30), obfuscatedAccountId: obfuscatedAccountId(billing.accountKey, a.id) });
    expect((await app.inject({ method: 'POST', url: '/subscription/verify', headers: { ...a.h, 'idempotency-key': 'sub-old-0001' }, payload: { productId: config.subscription.product_ids[0], purchaseToken: 'play-tok' } })).statusCode).toBe(200);
    const nd = (await login(idToken('sub-pay'))).json();
    const h2 = { authorization: `Bearer ${nd.token}` };
    // po reinstalacji klient przywraca zakupy z Play i zgłasza je ponownie
    const r = await app.inject({ method: 'POST', url: '/subscription/verify', headers: { ...h2, 'idempotency-key': 'sub-new-0001' }, payload: { productId: config.subscription.product_ids[0], purchaseToken: 'play-tok' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().active).toBe(true);
    expect((await app.inject({ url: '/silo', headers: h2 })).json().queueSlots).toBe(config.dives.queue_slots.subscriber);
  });
});

describe('usuwanie konta (§2.5)', () => {
  it('wymaga potwierdzenia', async () => {
    const a = await player();
    expect((await app.inject({ method: 'DELETE', url: '/account', headers: a.h, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/account', headers: a.h, payload: { confirm: 'tak' } })).statusCode).toBe(400);
  });

  it('usuwa postać, portfel, urządzenia, subskrypcję i archiwum dziennika; historia innych zostaje spójna', async () => {
    const buyer = await player();
    const seller = await player();
    await link(buyer.h, idToken('sub-del'));
    fakePlay.set('play-del', { productId: config.subscription.product_ids[0]!, expiryTime: at(30), obfuscatedAccountId: obfuscatedAccountId(billing.accountKey, buyer.id) });
    await app.inject({ method: 'POST', url: '/subscription/verify', headers: { ...buyer.h, 'idempotency-key': 'sub-del-0001' }, payload: { productId: config.subscription.product_ids[0], purchaseToken: 'play-del' } });
    // transakcja gracz→gracz i wynik zamkniętego sezonu i wpis archiwum dziennika
    await db.insertInto('market_trades').values({ listing_id: null, buyer_id: buyer.id, seller_id: seller.id, material: 'miedz', qty: 3, unit_price: 100, gross: 300, fee: 15, created_at: clock }).execute();
    await db.insertInto('seasons').values({ id: 99, started_at: at(-200), ends_at: at(-20), state: 'ended', closed_at: at(-20) }).onConflict((oc) => oc.doNothing()).execute();
    await db.insertInto('season_results').values({ season_id: 99, user_id: buyer.id, nickname: 'Kupiec', rank: 1, players_total: 2, power: 50, level: 10, loot: '0', title: null, start_bonus_ore: 0 }).execute();
    await db.insertInto('season_results').values({ season_id: 99, user_id: seller.id, nickname: 'Sprzedawca', rank: 2, players_total: 2, power: 40, level: 9, loot: '0', title: null, start_bonus_ore: 0 }).execute();
    await pool.query("INSERT INTO ledger_archive (id, user_id, resource, delta, reason, ref, config_version, created_at, season_id) VALUES (999999, $1, 'ore', 10, 'production', NULL, '1.0.0', now(), 99)", [buyer.id]);

    const r = await app.inject({ method: 'DELETE', url: '/account', headers: buyer.h, payload: { confirm: 'USUN' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ deleted: true, hadActiveSubscription: true });

    for (const t of ['players', 'wallets', 'user_devices', 'subscriptions', 'ledger_entries']) {
      expect(Number((await pool.query(`SELECT count(*) FROM ${t} WHERE user_id = $1`, [buyer.id])).rows[0].count)).toBe(0);
    }
    expect(Number((await pool.query('SELECT count(*) FROM ledger_archive WHERE user_id = $1', [buyer.id])).rows[0].count)).toBe(0);
    // stary JWT i sekret gościa już nie działają; Google można dowiązać od nowa do innego konta
    expect((await app.inject({ url: '/me', headers: buyer.h })).statusCode).toBe(401);
    expect((await guestLogin(buyer.id, buyer.secret)).statusCode).toBe(401);
    expect((await login(idToken('sub-del'))).json().error).toBe('no_linked_account');

    // sprzedawca: transakcja dalej „gracz”, nie „bot”, i nie zjada dziennego limitu skupu botów
    const trades = await db.selectFrom('market_trades').selectAll().where('seller_id', '=', seller.id).execute();
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ buyer_id: null, bot_trade: false });
    // ranking sezonu: wiersz zostaje, zanonimizowany
    const res = await db.selectFrom('season_results').selectAll().where('season_id', '=', 99).orderBy('rank').execute();
    expect(res.map((x) => [x.rank, x.nickname, x.user_id])).toEqual([[1, DELETED_NICKNAME, null], [2, 'Sprzedawca', seller.id]]);
    expect(await auditLedger(db)).toEqual([]);
  });

  it('bez subskrypcji: hadActiveSubscription=false', async () => {
    const a = await player();
    expect((await app.inject({ method: 'DELETE', url: '/account', headers: a.h, payload: { confirm: 'USUN' } })).json()).toEqual({ deleted: true, hadActiveSubscription: false });
  });
});

describe('sezon', () => {
  it('reset sezonu nie rusza powiązania z Google ani urządzeń; powiązanie działa w przerwie', async () => {
    await pool.query('TRUNCATE seasons CASCADE');
    const a = await player();
    await seasonTick(ctx);
    clock = at(config.season.length_days + 0.1);
    expect((await seasonTick(ctx)).action).toBe('closed');
    expect((await link(a.h, idToken('sub-season'))).statusCode).toBe(200); // przerwa: akcje gry zablokowane, konto nie
    clock = at(config.season.length_days + config.season.intermission_hours / 24 + 0.2);
    expect((await seasonTick(ctx)).action).toBe('started');
    expect((await app.inject({ url: '/account', headers: a.h })).json()).toMatchObject({ google: true, devices: 1 });
    expect((await login(idToken('sub-season'))).json().userId).toBe(a.id);
  });
});
