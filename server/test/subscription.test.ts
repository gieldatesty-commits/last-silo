import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { FakePlayBilling } from '../src/billing.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { auditLedger } from '../src/ledger.js';
import { seasonTick } from '../src/services/season.js';
import { obfuscatedAccountId, syncDueSubscriptions, type Billing } from '../src/services/subscription.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const T0 = new Date('2026-04-01T10:00:00Z');
const DAY = 86_400_000;
let clock = T0;
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const fake = new FakePlayBilling();
const billing: Billing = { client: fake, accountKey: 'test-account-key-123456', packageName: 'pl.lastsilo.lastsilo' };
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1, billing });
const noBilling = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1 });
const ctx = { db, config, now: () => clock, scheduler: { schedule: async () => undefined } };
const PRODUCT = config.subscription.product_ids[0]!;

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE; TRUNCATE world_pools, seasons CASCADE');
  fake.purchases.clear();
  fake.acknowledged.length = 0;
  clock = T0;
});
afterAll(async () => {
  await app.close();
  await noBilling.close();
  await db.destroy();
});

let n = 0;
let k = 0;
async function newPlayer() {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  const r = await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Abon${++n}`, archetype: 'gornik' } });
  expect(r.statusCode).toBe(201);
  return { id: reg.userId as string, h, obf: obfuscatedAccountId(billing.accountKey, reg.userId) };
}
const verify = (h: Record<string, string>, purchaseToken: string, productId = PRODUCT, key = `verify-${++k}`) =>
  app.inject({ method: 'POST', url: '/subscription/verify', headers: { ...h, 'idempotency-key': key }, payload: { productId, purchaseToken } });
const sub = async (h: Record<string, string>) => (await app.inject({ url: '/subscription', headers: h })).json();
const slots = async (h: Record<string, string>) => (await app.inject({ url: '/silo', headers: h })).json().queueSlots as number;
const rtdn = (payload: object, auth = fake.pushAuth) =>
  app.inject({
    method: 'POST',
    url: '/billing/rtdn',
    headers: { authorization: auth },
    payload: { message: { data: Buffer.from(JSON.stringify({ version: '1.0', packageName: billing.packageName, eventTimeMillis: String(clock.getTime()), ...payload })).toString('base64'), messageId: String(++k) }, subscription: 'projects/x/subscriptions/rtdn' },
  });
const subEvent = (purchaseToken: string, notificationType: number) => rtdn({ subscriptionNotification: { version: '1.0', notificationType, purchaseToken } });
const rows = async (token: string) => db.selectFrom('subscriptions').selectAll().where('purchase_token', '=', token).execute();

describe('POST /subscription/verify', () => {
  it('udana weryfikacja: korzyść (slot kolejki), potwierdzenie w Google, stan w GET', async () => {
    const a = await newPlayer();
    expect(await slots(a.h)).toBe(config.dives.queue_slots.free);
    fake.set('tok-a', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: a.obf });
    const r = await verify(a.h, 'tok-a');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ enabled: true, active: true, state: 'active', productId: PRODUCT, expiresAt: at(30).toISOString(), autoRenewing: true, accountId: a.obf });
    expect(fake.acknowledged).toEqual(['tok-a']);
    expect((await rows('tok-a'))[0]!.acknowledged).toBe(true);
    expect(await slots(a.h)).toBe(config.dives.queue_slots.subscriber);
  });

  it('GET /subscription podaje accountId do zakupu, zanim cokolwiek kupiono', async () => {
    const a = await newPlayer();
    expect(await sub(a.h)).toMatchObject({ enabled: true, active: false, state: null, accountId: a.obf, perks: config.subscription.perks });
  });

  it('zły productId: spoza configu i niezgodny z zakupem w Google', async () => {
    const a = await newPlayer();
    fake.set('tok-p', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: a.obf });
    expect((await verify(a.h, 'tok-p', 'diamenty')).json().error).toBe('unknown_product');
    fake.set('tok-q', { productId: 'inny_produkt', expiryTime: at(30), obfuscatedAccountId: a.obf });
    expect((await verify(a.h, 'tok-q')).json().error).toBe('product_mismatch');
    expect((await verify(a.h, 'nie-istnieje')).json().error).toBe('purchase_not_found');
    expect(await slots(a.h)).toBe(config.dives.queue_slots.free);
  });

  it('cudze konto: zakup z obfuscatedAccountId innego gracza albo bez identyfikatora', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    fake.set('tok-a', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: a.obf });
    const r = await verify(b.h, 'tok-a');
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('account_mismatch');
    fake.set('tok-x', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: null });
    expect((await verify(b.h, 'tok-x')).json().error).toBe('account_mismatch');
    expect(await rows('tok-a')).toHaveLength(0);
  });

  it('ten sam token nie zasila drugiego konta (UNIQUE)', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    fake.set('tok-a', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: a.obf });
    expect((await verify(a.h, 'tok-a')).statusCode).toBe(200);
    const r = await verify(b.h, 'tok-a');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('token_in_use');
    expect(await slots(b.h)).toBe(config.dives.queue_slots.free);
    await expect(db.insertInto('subscriptions').values({ user_id: b.id, purchase_token: 'tok-a', product_id: PRODUCT, state: 'active', started_at: T0, expires_at: at(30), last_synced_at: T0 }).execute()).rejects.toThrow();
  });

  it('ponowienie z tym samym Idempotency-Key zwraca zapisaną odpowiedź', async () => {
    const a = await newPlayer();
    fake.set('tok-a', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: a.obf });
    const r1 = await verify(a.h, 'tok-a', PRODUCT, 'klucz-staly-1');
    // Google zmienia stan, ale powtórka z tym samym kluczem nie wykonuje operacji ponownie
    fake.set('tok-a', { productId: PRODUCT, expiryTime: at(60), obfuscatedAccountId: a.obf });
    const r2 = await verify(a.h, 'tok-a', PRODUCT, 'klucz-staly-1');
    expect(r2.headers['idempotent-replay']).toBe('true');
    expect(r2.json()).toEqual(r1.json());
    expect(await rows('tok-a')).toHaveLength(1);
    expect(fake.acknowledged).toHaveLength(1);
  });

  it('ponowna subskrypcja bez identyfikatora przez linkedPurchaseToken tego samego konta; stary token wygasa', async () => {
    const a = await newPlayer();
    fake.set('tok-old', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: a.obf });
    await verify(a.h, 'tok-old');
    fake.set('tok-new', { productId: PRODUCT, expiryTime: at(60), obfuscatedAccountId: null, linkedPurchaseToken: 'tok-old' });
    const r = await verify(a.h, 'tok-new');
    expect(r.statusCode).toBe(200);
    expect(r.json().expiresAt).toBe(at(60).toISOString());
    expect((await rows('tok-old'))[0]!.state).toBe('expired');
  });

  it('bez konfiguracji płatności: 503 billing_disabled, GET mówi enabled=false', async () => {
    const reg = (await noBilling.inject({ method: 'POST', url: '/auth/guest' })).json();
    const h = { authorization: `Bearer ${reg.token}` };
    await noBilling.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: 'BezPlatnosci', archetype: 'gornik' } });
    const r = await noBilling.inject({ method: 'POST', url: '/subscription/verify', headers: { ...h, 'idempotency-key': 'k-12345678' }, payload: { productId: PRODUCT, purchaseToken: 'x' } });
    expect(r.statusCode).toBe(503);
    expect((await noBilling.inject({ url: '/subscription', headers: h })).json()).toMatchObject({ enabled: false, active: false, accountId: null });
  });

  it('awaria Google: 503 billing_unavailable, klucz idempotencji niezużyty', async () => {
    const a = await newPlayer();
    fake.set('tok-a', { productId: PRODUCT, expiryTime: at(30), obfuscatedAccountId: a.obf });
    fake.failNext = true;
    expect((await verify(a.h, 'tok-a', PRODUCT, 'klucz-awaria-1')).statusCode).toBe(503);
    const r = await verify(a.h, 'tok-a', PRODUCT, 'klucz-awaria-1');
    expect(r.statusCode).toBe(200);
    expect(r.headers['idempotent-replay']).toBe('false');
  });
});

describe('cykl życia (RTDN i subscription-sync)', () => {
  async function subscribed(expiryDays = 30) {
    const a = await newPlayer();
    fake.set('tok', { productId: PRODUCT, expiryTime: at(expiryDays), obfuscatedAccountId: a.obf });
    expect((await verify(a.h, 'tok')).statusCode).toBe(200);
    return a;
  }

  it('odnowienie wydłuża expires_at (RTDN SUBSCRIPTION_RENEWED)', async () => {
    const a = await subscribed();
    fake.set('tok', { expiryTime: at(60), productId: PRODUCT });
    expect((await subEvent('tok', 2)).statusCode).toBe(204);
    expect((await sub(a.h)).expiresAt).toBe(at(60).toISOString());
    clock = at(45);
    expect(await slots(a.h)).toBe(config.dives.queue_slots.subscriber);
  });

  it('anulowanie: dostęp do końca opłaconego okresu, potem 2 sloty', async () => {
    const a = await subscribed();
    fake.set('tok', { productId: PRODUCT, expiryTime: at(30), state: 'SUBSCRIPTION_STATE_CANCELED', autoRenewing: false });
    await subEvent('tok', 3);
    expect(await sub(a.h)).toMatchObject({ active: true, state: 'canceled_active', autoRenewing: false });
    expect(await slots(a.h)).toBe(config.dives.queue_slots.subscriber);
    clock = at(30.01);
    expect(await sub(a.h)).toMatchObject({ active: false, state: 'expired' });
    expect(await slots(a.h)).toBe(config.dives.queue_slots.free);
  });

  it('grace daje korzyści, on_hold nie', async () => {
    const a = await subscribed();
    clock = at(30);
    fake.set('tok', { productId: PRODUCT, expiryTime: at(33), state: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' });
    await subEvent('tok', 6);
    expect(await sub(a.h)).toMatchObject({ active: true, state: 'grace' });
    expect(await slots(a.h)).toBe(config.dives.queue_slots.subscriber);
    clock = at(33);
    fake.set('tok', { productId: PRODUCT, expiryTime: at(32.9), state: 'SUBSCRIPTION_STATE_ON_HOLD' });
    await subEvent('tok', 5);
    expect(await sub(a.h)).toMatchObject({ active: false, state: 'on_hold' });
    expect(await slots(a.h)).toBe(config.dives.queue_slots.free);
    // płatność się udała: SUBSCRIPTION_RECOVERED
    fake.set('tok', { productId: PRODUCT, expiryTime: at(63), state: 'SUBSCRIPTION_STATE_ACTIVE' });
    await subEvent('tok', 1);
    expect(await sub(a.h)).toMatchObject({ active: true, state: 'active' });
  });

  it('revoked odbiera korzyści od razu, ale nie cofa zarobionej rudy', async () => {
    const a = await subscribed();
    clock = at(5);
    await app.inject({ url: '/silo', headers: a.h }); // rozliczenie produkcji do teraz
    const before = await db.selectFrom('wallets').select(['resource', 'balance']).where('user_id', '=', a.id).orderBy('resource').execute();
    fake.set('tok', { productId: PRODUCT, expiryTime: at(5), state: 'SUBSCRIPTION_STATE_EXPIRED', autoRenewing: false });
    await subEvent('tok', 12);
    expect(await sub(a.h)).toMatchObject({ active: false, state: 'revoked' });
    expect(await slots(a.h)).toBe(config.dives.queue_slots.free);
    // późniejsze zdarzenie (np. EXPIRED) nie zamazuje etykiety revoked
    await subEvent('tok', 13);
    expect((await rows('tok'))[0]!.state).toBe('revoked');
    await app.inject({ url: '/silo', headers: a.h });
    const after = await db.selectFrom('wallets').select(['resource', 'balance']).where('user_id', '=', a.id).orderBy('resource').execute();
    expect(after).toEqual(before);
  });

  it('voidedPurchaseNotification (zwrot) działa jak revoked; treść powiadomienia nie odbiera dostępu, gdy Google mówi active', async () => {
    const a = await subscribed();
    // fałszywy/nieaktualny sygnał: Google nadal raportuje aktywną subskrypcję, więc zostaje active
    await rtdn({ voidedPurchaseNotification: { purchaseToken: 'tok', orderId: 'GPA.1', productType: 1, refundType: 1 } });
    expect((await sub(a.h)).state).toBe('active');
    fake.set('tok', { productId: PRODUCT, expiryTime: T0, state: 'SUBSCRIPTION_STATE_EXPIRED' });
    await rtdn({ voidedPurchaseNotification: { purchaseToken: 'tok', orderId: 'GPA.1', productType: 1, refundType: 1 } });
    expect(await sub(a.h)).toMatchObject({ active: false, state: 'revoked' });
  });

  it('zdarzenia w złej kolejności i zduplikowane: zawsze wygrywa bieżący stan z Google', async () => {
    const a = await subscribed();
    fake.set('tok', { productId: PRODUCT, expiryTime: at(60) }); // Google: odnowiona
    // najpierw przychodzi spóźnione CANCELED, potem dwa razy RENEWED, potem znów stare IN_GRACE
    for (const t of [3, 2, 2, 6]) expect((await subEvent('tok', t)).statusCode).toBe(204);
    expect(await sub(a.h)).toMatchObject({ active: true, state: 'active', expiresAt: at(60).toISOString() });
    expect(await rows('tok')).toHaveLength(1);
    const ev = await db.selectFrom('events_log').select('props').where('name', '=', 'subscription_state').where('user_id', '=', a.id).execute();
    expect(ev).toHaveLength(2); // zakup + jedna rzeczywista zmiana (30 → 60 dni), duplikaty nic nie zapisują
  });

  it('RTDN: zły token OIDC = 401, nieznany token / test / inny pakiet = 204 bez zmian', async () => {
    await subscribed();
    expect((await rtdn({ subscriptionNotification: { notificationType: 2, purchaseToken: 'tok' } }, 'Bearer zly')).statusCode).toBe(401);
    expect((await rtdn({ subscriptionNotification: { notificationType: 4, purchaseToken: 'nikt-nie-zglosil' } })).statusCode).toBe(204);
    expect(await rows('nikt-nie-zglosil')).toHaveLength(0);
    expect((await rtdn({ testNotification: { version: '1.0' } })).statusCode).toBe(204);
    const other = await app.inject({ method: 'POST', url: '/billing/rtdn', headers: { authorization: fake.pushAuth }, payload: { message: { data: Buffer.from(JSON.stringify({ packageName: 'inna.gra', subscriptionNotification: { notificationType: 12, purchaseToken: 'tok' } })).toString('base64') } } });
    expect(other.statusCode).toBe(204);
    expect((await rows('tok'))[0]!.state).toBe('active');
    expect((await app.inject({ method: 'POST', url: '/billing/rtdn', headers: { authorization: fake.pushAuth }, payload: { message: { data: '!!!nie-base64-json' } } })).statusCode).toBe(204);
  });

  it('RTDN przy awarii Google: 503, żeby Pub/Sub ponowił', async () => {
    await subscribed();
    fake.failNext = true;
    expect((await subEvent('tok', 2)).statusCode).toBe(503);
  });

  it('wygaśnięcie bez żadnego zdarzenia: queueSlots wraca do 2, a trzeci zjazd w kolejce jest odrzucany', async () => {
    const a = await subscribed(1);
    const dive = (key: string) => app.inject({ method: 'POST', url: '/dives', headers: { ...a.h, 'idempotency-key': key }, payload: { routeId: 'plytki' } });
    clock = at(1.5);
    expect(await slots(a.h)).toBe(config.dives.queue_slots.free);
    expect((await dive('dive-0001')).statusCode).toBe(201);
    expect((await dive('dive-0002')).statusCode).toBe(201);
    expect((await dive('dive-0003')).json().error).toBe('queue_full');
  });

  it('subscription-sync: odnowienie bez RTDN i ponowne potwierdzenie, gdy acknowledge zawiódł', async () => {
    const a = await newPlayer();
    fake.set('tok', { productId: PRODUCT, expiryTime: at(1), obfuscatedAccountId: a.obf });
    const ack = fake.acknowledge.bind(fake);
    fake.acknowledge = async () => {
      throw new Error('ack padł');
    };
    expect((await verify(a.h, 'tok')).statusCode).toBe(200); // weryfikacja przechodzi mimo błędu potwierdzenia
    expect((await rows('tok'))[0]!.acknowledged).toBe(false);
    fake.acknowledge = ack;
    fake.set('tok', { productId: PRODUCT, expiryTime: at(31) });
    const r = await syncDueSubscriptions({ ...ctx }, billing);
    expect(r).toEqual({ checked: 1, failed: 0 });
    const row = (await rows('tok'))[0]!;
    expect(row.acknowledged).toBe(true);
    expect(row.expires_at.toISOString()).toBe(at(31).toISOString());
    // daleko od wygaśnięcia, potwierdzony: sync go nie rusza
    expect(await syncDueSubscriptions({ ...ctx }, billing)).toEqual({ checked: 0, failed: 0 });
  });

  it('reset sezonu nie kasuje subskrypcji; weryfikacja działa też w przerwie', async () => {
    const a = await subscribed(400);
    await seasonTick(ctx); // sezon 1 istnieje
    clock = at(config.season.length_days + 0.1);
    expect((await seasonTick(ctx)).action).toBe('closed');
    // przerwa: akcje gry są zablokowane, płatności nie
    fake.set('tok2', { productId: PRODUCT, expiryTime: at(420), obfuscatedAccountId: a.obf });
    expect((await verify(a.h, 'tok2')).statusCode).toBe(200);
    clock = at(config.season.length_days + config.season.intermission_hours / 24 + 0.2);
    expect((await seasonTick(ctx)).action).toBe('started');
    expect(await rows('tok')).toHaveLength(1);
    expect(await sub(a.h)).toMatchObject({ active: true, expiresAt: at(420).toISOString() });
    // nowa postać w nowym sezonie dostaje korzyść od razu
    const r = await app.inject({ method: 'POST', url: '/players', headers: a.h, payload: { nickname: 'PoResecie', archetype: 'gornik' } });
    expect(r.statusCode).toBe(201);
    expect(await slots(a.h)).toBe(config.dives.queue_slots.subscriber);
  });

  it('audyt dziennika bez różnic po całym cyklu', async () => {
    const a = await subscribed();
    await app.inject({ method: 'POST', url: '/dives', headers: { ...a.h, 'idempotency-key': 'dive-audit-1' }, payload: { routeId: 'plytki' } });
    fake.set('tok', { productId: PRODUCT, expiryTime: T0, state: 'SUBSCRIPTION_STATE_EXPIRED' });
    await subEvent('tok', 12);
    clock = at(2);
    await app.inject({ url: '/silo', headers: a.h });
    expect(await auditLedger(db)).toEqual([]);
  });
});

describe('parseSubscriptionV2 (kształt odpowiedzi purchases.subscriptionsv2.get)', () => {
  it('bierze pola z dokumentacji Google', async () => {
    const { parseSubscriptionV2 } = await import('../src/billing.js');
    const p = parseSubscriptionV2({
      subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
      startTime: '2026-04-01T10:00:00.000Z',
      linkedPurchaseToken: 'stary',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      testPurchase: {},
      externalAccountIdentifiers: { obfuscatedExternalAccountId: 'abc' },
      lineItems: [
        { productId: 'wygoda', expiryTime: '2026-05-01T10:00:00.000Z', autoRenewingPlan: { autoRenewEnabled: true } },
        { productId: 'wygoda', expiryTime: '2026-04-15T10:00:00.000Z' },
      ],
    });
    expect(p).toMatchObject({ productId: 'wygoda', state: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', autoRenewing: true, linkedPurchaseToken: 'stary', acknowledged: true, obfuscatedAccountId: 'abc', testPurchase: true });
    expect(p.expiryTime.toISOString()).toBe('2026-05-01T10:00:00.000Z');
    expect(() => parseSubscriptionV2({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' })).toThrow();
  });
});
