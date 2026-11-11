import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import type { GoogleIdVerifier } from '../google-id.js';
import { BENEFIT_STATES } from './subscription.js';
import { GameError, type Ctx, type Trx } from './silo.js';

/** Konto: urządzenia gościa, powiązanie z Google, usuwanie (docs/konto-google-v1.0.md). */
export interface GoogleAuth {
  verifier: GoogleIdVerifier;
  /** true = token bez nonce jest odrzucany (§3.3; decyzja po sprawdzeniu google_sign_in v7) */
  requireNonce: boolean;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const NONCE_TTL_MS = 10 * 60_000;
/** nick w zanonimizowanych wynikach sezonów po usunięciu konta */
export const DELETED_NICKNAME = 'Usunięty gracz';

/** Nowe konto gościa: użytkownik, pierwsze urządzenie i pusta postać. */
export async function createGuest(ctx: Ctx): Promise<{ userId: string; secret: string }> {
  const secret = randomBytes(32).toString('hex');
  const userId = await ctx.db.transaction().execute(async (trx) => {
    // guest_secret_hash zostaje wypełniane dla zgodności schematu; czytamy tylko user_devices
    const u = await trx.insertInto('users').values({ guest_secret_hash: sha256(secret), google_sub: null, google_linked_at: null }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('user_devices').values({ user_id: u.id, secret_hash: sha256(secret), created_at: ctx.now(), last_seen_at: ctx.now() }).execute();
    await trx.insertInto('players').values({ user_id: u.id, nickname: null, archetype: null, sila: null, technika: null, percepcja: null, wytrwalosc: null, silo_lat: null, silo_lon: null, config_version: null }).execute();
    await trx.insertInto('events_log').values({ user_id: u.id, name: 'account_created', props: JSON.stringify({ method: 'guest' }) }).execute();
    return u.id;
  });
  return { userId, secret };
}

/** Logowanie gościa: sekret dowolnego urządzenia tego konta. */
export async function deviceLogin(ctx: Ctx, userId: string, secret: string): Promise<boolean> {
  const want = Buffer.from(sha256(secret));
  const rows = await ctx.db.selectFrom('user_devices').select(['id', 'secret_hash']).where('user_id', '=', userId).execute();
  const hit = rows.find((r) => r.secret_hash.length === want.length && timingSafeEqual(Buffer.from(r.secret_hash), want));
  if (!hit) return false;
  await ctx.db.updateTable('user_devices').set({ last_seen_at: ctx.now() }).where('id', '=', hit.id).execute();
  return true;
}

/** GET /auth/google/nonce: jednorazowy nonce do podania przy logowaniu Google. */
export async function issueNonce(ctx: Ctx): Promise<string> {
  const now = ctx.now();
  const nonce = randomBytes(24).toString('base64url');
  await ctx.db.deleteFrom('auth_nonces').where('created_at', '<', new Date(now.getTime() - NONCE_TTL_MS)).execute();
  await ctx.db.insertInto('auth_nonces').values({ nonce, created_at: now }).execute();
  return nonce;
}

/** Token Google → `sub`; nonce (jeśli jest w tokenie albo wymagany) musi być nasz, świeży i nieużyty. */
async function verifiedSub(trx: Trx, ctx: Ctx, google: GoogleAuth, idToken: string): Promise<string> {
  const id = await google.verifier.verify(idToken);
  if (!id) throw new GameError(401, 'bad_google_token');
  if (id.nonce === null) {
    if (google.requireNonce) throw new GameError(401, 'bad_nonce');
    return id.sub;
  }
  const used = await trx
    .deleteFrom('auth_nonces')
    .where('nonce', '=', id.nonce)
    .where('created_at', '>=', new Date(ctx.now().getTime() - NONCE_TTL_MS))
    .returning('nonce')
    .executeTakeFirst();
  if (!used) throw new GameError(401, 'bad_nonce');
  return id.sub;
}

/** POST /account/google/link (§2.1): dowiązanie Google do zalogowanego konta. */
export async function linkGoogleTx(trx: Trx, ctx: Ctx, google: GoogleAuth, userId: string, idToken: string) {
  const sub = await verifiedSub(trx, ctx, google, idToken);
  const me = await trx.selectFrom('users').select(['google_sub']).where('id', '=', userId).forUpdate().executeTakeFirst();
  if (!me) throw new GameError(401, 'unauthorized');
  if (me.google_sub === sub) return accountViewTx(trx, userId);
  if (me.google_sub !== null) throw new GameError(409, 'account_already_linked');
  const other = await trx.selectFrom('users').select('id').where('google_sub', '=', sub).executeTakeFirst();
  if (other) throw new GameError(409, 'google_in_use');
  try {
    await trx.updateTable('users').set({ google_sub: sub, google_linked_at: ctx.now() }).where('id', '=', userId).execute();
  } catch (e) {
    // wyścig: ten sam Google dowiązywany równolegle do dwóch kont (UNIQUE na google_sub)
    if ((e as { code?: string }).code === '23505') throw new GameError(409, 'google_in_use');
    throw e;
  }
  await trx.insertInto('events_log').values({ user_id: userId, name: 'account_linked', props: JSON.stringify({ provider: 'google' }) }).execute();
  return accountViewTx(trx, userId);
}

/** POST /auth/google (§2.2): logowanie na nowym urządzeniu. Nie zakłada konta; dodaje urządzenie. */
export async function googleLogin(ctx: Ctx, google: GoogleAuth, idToken: string): Promise<{ userId: string; deviceSecret: string }> {
  return ctx.db.transaction().execute(async (trx) => {
    const sub = await verifiedSub(trx, ctx, google, idToken);
    const u = await trx.selectFrom('users').select('id').where('google_sub', '=', sub).executeTakeFirst();
    if (!u) throw new GameError(404, 'no_linked_account');
    const secret = randomBytes(32).toString('hex');
    await trx.insertInto('user_devices').values({ user_id: u.id, secret_hash: sha256(secret), created_at: ctx.now(), last_seen_at: ctx.now() }).execute();
    await trx.insertInto('events_log').values({ user_id: u.id, name: 'device_added', props: JSON.stringify({ method: 'google' }) }).execute();
    return { userId: u.id, deviceSecret: secret };
  });
}

/** GET /account */
export async function accountView(ctx: Ctx, userId: string) {
  return ctx.db.transaction().execute((trx) => accountViewTx(trx, userId));
}

async function accountViewTx(trx: Trx, userId: string) {
  const u = await trx.selectFrom('users').select(['id', 'google_sub', 'google_linked_at', 'created_at']).where('id', '=', userId).executeTakeFirst();
  if (!u) throw new GameError(401, 'unauthorized');
  const devices = await trx.selectFrom('user_devices').select((e) => e.fn.countAll<string>().as('n')).where('user_id', '=', userId).executeTakeFirstOrThrow();
  return { userId: u.id, createdAt: u.created_at, google: u.google_sub !== null, googleLinkedAt: u.google_linked_at, devices: Number(devices.n) };
}

/**
 * DELETE /account (§2.5): usuwa konto i dane gracza. Historia innych graczy zostaje spójna:
 * zakupy usuniętego kupującego nie stają się „transakcjami botów” (bot_trade), wyniki sezonów są anonimizowane,
 * archiwum dziennika z poprzednich sezonów jest czyszczone. Subskrypcji w Google Play to NIE anuluje.
 */
export async function deleteAccount(ctx: Ctx, userId: string) {
  return ctx.db.transaction().execute(async (trx) => {
    const u = await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().executeTakeFirst();
    if (!u) throw new GameError(401, 'unauthorized');
    const now = ctx.now();
    const sub = await trx
      .selectFrom('subscriptions')
      .select('id')
      .where('user_id', '=', userId)
      .where('state', 'in', BENEFIT_STATES)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    await trx.updateTable('season_results').set({ user_id: null, nickname: DELETED_NICKNAME }).where('user_id', '=', userId).execute();
    await sql`DELETE FROM ledger_archive WHERE user_id = ${userId}`.execute(trx);
    // market_trades.buyer_id → NULL (FK), ale bot_trade zostaje false; reszta kaskadowo (FK ON DELETE CASCADE)
    await trx.deleteFrom('users').where('id', '=', userId).execute();
    await trx.insertInto('events_log').values({ user_id: null, name: 'account_deleted', props: JSON.stringify({ hadActiveSubscription: !!sub }) }).execute();
    return { deleted: true, hadActiveSubscription: !!sub };
  });
}
