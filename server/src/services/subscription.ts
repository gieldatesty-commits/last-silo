import { createHmac } from 'node:crypto';
import { sql } from 'kysely';
import type { PlayBillingClient, PlaySubscription } from '../billing.js';
import type { SubscriptionState } from '../db.js';
import { GameError, type Ctx, type Trx } from './silo.js';

/**
 * Subskrypcja „Wygoda” (docs/subskrypcja-v1.0.md). Źródłem prawdy jest Google Play: każdy zapis stanu
 * pochodzi z odpowiedzi Play Developer API, nigdy z treści żądania ani powiadomienia.
 */
export interface Billing {
  client: PlayBillingClient;
  /** klucz HMAC zaciemnionego identyfikatora konta */
  accountKey: string;
  /** nazwa pakietu aplikacji; RTDN dla innego pakietu jest ignorowane */
  packageName: string;
}

/** Stany, które dają korzyści (do `expires_at`). */
export const BENEFIT_STATES: readonly SubscriptionState[] = ['active', 'grace', 'canceled_active'];
/** Stany, które mogą się jeszcze zmienić; odświeża je subscription-sync. */
const LIVE_STATES: readonly SubscriptionState[] = ['active', 'grace', 'on_hold', 'canceled_active', 'pending'];

/**
 * Zaciemniony identyfikator konta dla Google Play (`obfuscatedAccountId` przy zakupie).
 * HMAC-SHA256 z userId: Google nie widzi naszego id, a cudzy token nie przejdzie weryfikacji na innym koncie. 64 znaki hex.
 */
export function obfuscatedAccountId(key: string, userId: string): string {
  return createHmac('sha256', key).update(`lastsilo:account:${userId}`).digest('hex');
}

/** subscriptionState z Google → nasz stan. Nieznane wartości traktujemy jak brak dostępu. */
export function mapPlayState(p: PlaySubscription, now: Date): SubscriptionState {
  switch (p.state) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'active';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'grace';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
      return 'on_hold';
    case 'SUBSCRIPTION_STATE_CANCELED':
      // anulowana, ale opłacony okres trwa: dostęp do końca okresu
      return p.expiryTime > now ? 'canceled_active' : 'expired';
    case 'SUBSCRIPTION_STATE_PENDING':
      return 'pending';
    default:
      return 'expired';
  }
}

const tokenLock = (trx: Trx, token: string) => sql`SELECT pg_advisory_xact_lock(7003, hashtext(${token}))`.execute(trx);

/**
 * Jedyne miejsce, które zapisuje `players.subscription_until`: max(expires_at) wpisów z korzyściami.
 * Wygaśnięcie nie wymaga zapisu: queueSlots porównuje z bieżącym czasem.
 */
export async function recomputeSubscription(trx: Trx, userId: string): Promise<Date | null> {
  const row = await trx
    .selectFrom('subscriptions')
    .select((e) => e.fn.max('expires_at').as('until'))
    .where('user_id', '=', userId)
    .where('state', 'in', BENEFIT_STATES)
    .executeTakeFirst();
  const until = row?.until ? new Date(row.until as unknown as string | Date) : null;
  await trx.updateTable('players').set({ subscription_until: until }).where('user_id', '=', userId).execute();
  return until;
}

/** Zapis stanu z Google dla tokenu należącego do `userId` + przeliczenie cache. */
async function store(trx: Trx, ctx: Ctx, userId: string, token: string, p: PlaySubscription, state: SubscriptionState) {
  const now = ctx.now();
  const values = {
    product_id: p.productId,
    state,
    started_at: p.startTime,
    expires_at: p.expiryTime,
    auto_renewing: p.autoRenewing,
    linked_purchase_token: p.linkedPurchaseToken,
    acknowledged: p.acknowledged,
    last_synced_at: now,
    raw: JSON.stringify(p.raw),
  };
  const prev = await trx.selectFrom('subscriptions').select(['id', 'state', 'expires_at', 'acknowledged']).where('purchase_token', '=', token).executeTakeFirst();
  if (prev) {
    // potwierdzenie po naszej stronie nie cofa się, nawet jeśli Google jeszcze go nie odnotował
    await trx.updateTable('subscriptions').set({ ...values, acknowledged: prev.acknowledged || p.acknowledged }).where('id', '=', prev.id).execute();
  } else {
    await trx.insertInto('subscriptions').values({ user_id: userId, purchase_token: token, ...values }).execute();
  }
  // zmiana planu / ponowna subskrypcja: stary token jest unieważniony przez Google
  if (p.linkedPurchaseToken) {
    await trx.updateTable('subscriptions').set({ state: 'expired', last_synced_at: now }).where('purchase_token', '=', p.linkedPurchaseToken).where('user_id', '=', userId).where('state', '!=', 'revoked').execute();
  }
  if (!prev || prev.state !== state || prev.expires_at.getTime() !== p.expiryTime.getTime()) {
    await trx
      .insertInto('events_log')
      .values({ user_id: userId, name: 'subscription_state', props: JSON.stringify({ productId: p.productId, from: prev?.state ?? null, to: state, expiresAt: p.expiryTime.toISOString(), test: p.testPurchase }) })
      .execute();
  }
  await recomputeSubscription(trx, userId);
}

/** Potwierdza zakup w Google, jeśli trzeba. Błąd nie psuje weryfikacji: subscription-sync spróbuje ponownie. */
async function acknowledgeIfNeeded(trx: Trx, billing: Billing, token: string, productId: string, state: SubscriptionState, acknowledged: boolean) {
  if (acknowledged || !BENEFIT_STATES.includes(state)) return;
  try {
    await billing.client.acknowledge(productId, token);
    await trx.updateTable('subscriptions').set({ acknowledged: true }).where('purchase_token', '=', token).execute();
  } catch (e) {
    console.error('subscription acknowledge', (e as Error).message);
  }
}

/**
 * POST /subscription/verify: klient zgłasza zakup, serwer pobiera stan z Google i wiąże token z kontem.
 * Wymaga zgodności obfuscatedAccountId z kontem (albo, przy ponownej subskrypcji bez identyfikatora, poprzedniego tokenu tego konta).
 */
export async function verifySubscriptionTx(trx: Trx, ctx: Ctx, billing: Billing, userId: string, productId: string, token: string) {
  const cfg = ctx.config.subscription;
  if (!cfg.product_ids.includes(productId)) throw new GameError(400, 'unknown_product');
  await tokenLock(trx, token);

  const owner = await trx.selectFrom('subscriptions').select('user_id').where('purchase_token', '=', token).executeTakeFirst();
  if (owner && owner.user_id !== userId) throw new GameError(409, 'token_in_use');

  const p = await billing.client.getSubscription(token);
  if (!p) throw new GameError(404, 'purchase_not_found');
  if (p.productId !== productId) throw new GameError(400, 'product_mismatch');

  const expected = obfuscatedAccountId(billing.accountKey, userId);
  if (p.obfuscatedAccountId !== expected) {
    const viaLinked =
      p.obfuscatedAccountId === null &&
      p.linkedPurchaseToken !== null &&
      (await trx.selectFrom('subscriptions').select('user_id').where('purchase_token', '=', p.linkedPurchaseToken).executeTakeFirst())?.user_id === userId;
    if (!viaLinked) throw new GameError(403, 'account_mismatch');
  }

  const state = mapPlayState(p, ctx.now());
  await store(trx, ctx, userId, token, p, state);
  await acknowledgeIfNeeded(trx, billing, token, p.productId, state, p.acknowledged);
  return subscriptionViewTx(trx, ctx, billing, userId);
}

export type SyncResult = 'updated' | 'unknown_token';

/**
 * Odświeża jeden token z Google (RTDN, subscription-sync). Treść powiadomienia służy tylko za sygnał:
 * `revokedHint` (zwrot/cofnięcie) zmienia etykietę na `revoked` wyłącznie wtedy, gdy Google potwierdza brak dostępu.
 * Kolejność i duplikaty zdarzeń nie mają znaczenia, bo zawsze zapisujemy bieżący stan z API.
 */
export async function syncToken(ctx: Ctx, billing: Billing, token: string, revokedHint = false): Promise<SyncResult> {
  return ctx.db.transaction().execute(async (trx) => {
    await tokenLock(trx, token);
    const row = await trx.selectFrom('subscriptions').select(['user_id', 'state', 'product_id']).where('purchase_token', '=', token).executeTakeFirst();
    // Token, którego klient jeszcze nie zgłosił: nie wiemy, czyje to konto, więc czekamy na /subscription/verify.
    if (!row) return 'unknown_token';
    const now = ctx.now();
    const p = await billing.client.getSubscription(token);
    if (!p) {
      // Google już nie zna tokenu (ponad 60 dni po wygaśnięciu): brak dostępu
      await trx.updateTable('subscriptions').set({ state: row.state === 'revoked' ? 'revoked' : 'expired', last_synced_at: now }).where('purchase_token', '=', token).execute();
      await recomputeSubscription(trx, row.user_id);
      return 'updated';
    }
    let state = mapPlayState(p, now);
    const entitled = BENEFIT_STATES.includes(state) && p.expiryTime > now;
    if (!entitled && (revokedHint || row.state === 'revoked')) state = 'revoked';
    await store(trx, ctx, row.user_id, token, p, state);
    await acknowledgeIfNeeded(trx, billing, token, p.productId, state, p.acknowledged);
    return 'updated';
  });
}

/** Zadanie subscription-sync: wpisy wygasające w oknie `sync_lookahead_hours`, zawieszone i niepotwierdzone. */
export async function syncDueSubscriptions(ctx: Ctx, billing: Billing): Promise<{ checked: number; failed: number }> {
  const now = ctx.now();
  const horizon = new Date(now.getTime() + ctx.config.subscription.sync_lookahead_hours * 3_600_000);
  const rows = await ctx.db
    .selectFrom('subscriptions')
    .select('purchase_token')
    .where((eb) =>
      eb.or([
        eb.and([eb('state', 'in', LIVE_STATES), eb('expires_at', '<', horizon)]),
        eb('state', 'in', ['grace', 'on_hold', 'pending']),
        eb.and([eb('acknowledged', '=', false), eb('state', 'in', BENEFIT_STATES)]),
      ]),
    )
    .orderBy('expires_at')
    .execute();
  let failed = 0;
  for (const r of rows) {
    try {
      await syncToken(ctx, billing, r.purchase_token);
    } catch (e) {
      failed++;
      console.error('subscription-sync', (e as Error).message);
    }
  }
  return { checked: rows.length, failed };
}

/** GET /subscription: stan dla gracza. `accountId` klient podaje jako obfuscatedAccountId przy zakupie. */
export async function subscriptionView(ctx: Ctx, billing: Billing | null, userId: string) {
  return ctx.db.transaction().execute((trx) => subscriptionViewTx(trx, ctx, billing, userId));
}

async function subscriptionViewTx(trx: Trx, ctx: Ctx, billing: Billing | null, userId: string) {
  const now = ctx.now();
  const p = await trx.selectFrom('players').select('subscription_until').where('user_id', '=', userId).executeTakeFirst();
  if (!p) throw new GameError(401, 'unauthorized');
  const rows = await trx.selectFrom('subscriptions').selectAll().where('user_id', '=', userId).orderBy('expires_at', 'desc').execute();
  // najpierw wpis dający dostęp, potem najnowszy
  const best = rows.find((r) => BENEFIT_STATES.includes(r.state) && r.expires_at > now) ?? rows[0];
  const active = !!p.subscription_until && p.subscription_until > now;
  return {
    enabled: billing !== null,
    active,
    // wpis z korzyściami po terminie to już wygaśnięcie (bez czekania na sync)
    state: best ? (BENEFIT_STATES.includes(best.state) && best.expires_at <= now ? 'expired' : best.state) : null,
    productId: best?.product_id ?? null,
    expiresAt: active ? p.subscription_until!.toISOString() : (best?.expires_at.toISOString() ?? null),
    autoRenewing: best?.auto_renewing ?? false,
    perks: ctx.config.subscription.perks,
    productIds: ctx.config.subscription.product_ids,
    accountId: billing ? obfuscatedAccountId(billing.accountKey, userId) : null,
  };
}
