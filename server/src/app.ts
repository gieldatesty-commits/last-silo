import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import type { Transaction } from 'kysely';
import type { Database, Db } from './db.js';
import { BUILDING_TYPES, type GameConfig } from './config.js';
import { idempotent } from './idempotency.js';
import { afterDiveCommitted, afterUpgradeCommitted, createPlayer, diveHistory, GameError, getSilo, listRoutes, spendPoints, startDiveTx, startUpgradeTx, type Ctx, type Scheduler } from './services/silo.js';
import { afterRaidCommitted, listRaids, listTargets, startRaidTx } from './services/raids.js';
import { contactTx, getRadio, ranking, setBroadcast } from './services/radio.js';
import { exchangeBuyTx, getGeology } from './services/trade.js';
import { getCodex } from './services/codex.js';
import { listResearch, startResearchTx } from './services/research.js';
import { buyListingTx, cancelListingTx, createListingTx, listListings, marketOverview, myMarket, sellToBotTx } from './services/market.js';
import { acceptContractTx, listContracts } from './services/contracts.js';
import { listShipments } from './services/caravans.js';
import { currentSeason, seasonResults, seasonTick, seasonView } from './services/season.js';
import { activateLoadoutTx, craftTx, equipTx, listItems, repairTx, upgradeTx } from './services/items.js';
import { BillingUnavailable } from './billing.js';
import { subscriptionView, syncToken, verifySubscriptionTx, type Billing } from './services/subscription.js';
import { accountView, createGuest, deleteAccount, deviceLogin, googleLogin, issueNonce, linkGoogleTx, type GoogleAuth } from './services/account.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export interface AppDeps {
  db: Db;
  config: GameConfig;
  jwtSecret: string;
  now?: () => Date;
  scheduler?: Scheduler;
  seed?: () => number;
  /** Google Play Billing; brak = płatności wyłączone (verify/rtdn zwracają 503 billing_disabled) */
  billing?: Billing | null;
  /** Google Sign-In; brak = trasy Google zwracają 503 google_disabled */
  google?: GoogleAuth | null;
  /** limit prób logowania/powiązania Google na minutę (na IP albo konto) */
  authRateLimitPerMinute?: number;
}

const GoogleBody = z.object({ idToken: z.string().min(20).max(8192) });

/** Prosty limit w pamięci procesu (jeden VPS): najwyżej `perMinute` zdarzeń na klucz w oknie 60 s. */
function rateLimiter(perMinute: number, now: () => Date) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now().getTime();
    const recent = (hits.get(key) ?? []).filter((x) => x > t - 60_000 && x <= t);
    if (recent.length >= perMinute) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((x) => x > t - 60_000)) hits.delete(k);
    return true;
  };
}

/** Koperta Pub/Sub push z RTDN (docs: developer.android.com/google/play/billing/rtdn-reference). */
const RtdnEnvelope = z.object({ message: z.object({ data: z.string().min(1), messageId: z.string().optional() }), subscription: z.string().optional() });
const DeveloperNotification = z.object({
  packageName: z.string().optional(),
  subscriptionNotification: z.object({ notificationType: z.number().int(), purchaseToken: z.string().min(1) }).optional(),
  voidedPurchaseNotification: z.object({ purchaseToken: z.string().min(1), productType: z.number().int().optional() }).optional(),
  testNotification: z.object({}).passthrough().optional(),
});
/** SUBSCRIPTION_REVOKED */
const RTDN_REVOKED = 12;


const GuestBody = z
  .object({ userId: z.uuid(), guestSecret: z.string().min(16) })
  .partial()
  .refine((b) => (b.userId === undefined) === (b.guestSecret === undefined), {
    message: 'podaj userId i guestSecret razem albo wcale',
  });

const PlayerBody = z.object({
  nickname: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[\p{L}\p{N}_ -]+$/u),
  archetype: z.string().min(1),
});

export function buildApp(deps: AppDeps) {
  const { db, config, jwtSecret } = deps;
  const ctx: Ctx = { db, config, now: deps.now ?? (() => new Date()), scheduler: deps.scheduler ?? { schedule: async () => undefined }, seed: deps.seed };
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: jwtSecret, sign: { expiresIn: '30d' } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.code(err.status).send({ error: err.code });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'bad_request' });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: 'bad_request' });
    console.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  // Bramka sezonu: po końcu sezonu akcje zmieniające stan są zablokowane do startu następnego (przerwa na podsumowanie).
  let seasonCache: { endsAt: number; active: boolean; checkedAt: number } | null = null;
  app.addHook('onRequest', async (req, reply) => {
    // płatności działają także w przerwie między sezonami (subskrypcja przeżywa reset, Google wysyła RTDN o każdej porze)
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.url.startsWith('/auth') || req.url.startsWith('/subscription') || req.url.startsWith('/billing') || req.url.startsWith('/account')) return;
    const nowMs = ctx.now().getTime();
    if (!seasonCache || !seasonCache.active || nowMs >= seasonCache.endsAt || nowMs - seasonCache.checkedAt > 30_000 || nowMs < seasonCache.checkedAt) {
      await seasonTick(ctx);
      const s = await currentSeason(ctx);
      seasonCache = { endsAt: s.ends_at.getTime(), active: s.state === 'active' && nowMs < s.ends_at.getTime(), checkedAt: nowMs };
    }
    if (!seasonCache.active) return reply.code(409).send({ error: 'season_ended' });
  });

  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  };

  app.get('/health', async () => ({ ok: true, configVersion: config.version }));

  // Gość: bez body tworzy konto; z userId+guestSecret loguje ponownie.
  app.post('/auth/guest', async (req, reply) => {
    const parsed = GuestBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const { userId, guestSecret } = parsed.data;

    if (userId && guestSecret) {
      if (!(await deviceLogin(ctx, userId, guestSecret))) return reply.code(401).send({ error: 'invalid_credentials' });
      return { userId, token: app.jwt.sign({ sub: userId }) };
    }
    const g = await createGuest(ctx);
    return reply.code(201).send({ userId: g.userId, guestSecret: g.secret, token: app.jwt.sign({ sub: g.userId }) });
  });

  // Konto Google (docs/konto-google-v1.0.md). Bez GOOGLE_WEB_CLIENT_ID: 503 google_disabled, gra jako gość działa dalej.
  const google = deps.google ?? null;
  const limiter = rateLimiter(deps.authRateLimitPerMinute ?? 10, ctx.now);
  app.get('/auth/google/nonce', async (req, reply) => {
    if (!google) return reply.code(503).send({ error: 'google_disabled' });
    if (!limiter(`nonce:${req.ip}`)) return reply.code(429).send({ error: 'too_many_requests' });
    return { nonce: await issueNonce(ctx) };
  });
  app.post('/auth/google', async (req, reply) => {
    if (!google) return reply.code(503).send({ error: 'google_disabled' });
    if (!limiter(`google:${req.ip}`)) return reply.code(429).send({ error: 'too_many_requests' });
    const { idToken } = GoogleBody.parse(req.body);
    const r = await googleLogin(ctx, google, idToken);
    // deviceSecret to nowy sekret gościa dla tego urządzenia: dalej loguje się przez /auth/guest
    return { userId: r.userId, guestSecret: r.deviceSecret, token: app.jwt.sign({ sub: r.userId }) };
  });
  app.get('/account', { onRequest: auth }, async (req) => accountView(ctx, req.user.sub));
  app.post('/account/google/link', { onRequest: auth }, async (req, reply) => {
    if (!google) return reply.code(503).send({ error: 'google_disabled' });
    if (!limiter(`link:${req.user.sub}`)) return reply.code(429).send({ error: 'too_many_requests' });
    const { idToken } = GoogleBody.parse(req.body);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 200, body: await linkGoogleTx(trx, ctx, google, userId, idToken) }));
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });
  // Usunięcie konta (wymóg Google Play). Nie anuluje subskrypcji w Play: klient ostrzega przed potwierdzeniem.
  app.delete('/account', { onRequest: auth }, async (req) => {
    z.object({ confirm: z.literal('USUN') }).parse(req.body ?? {});
    return deleteAccount(ctx, req.user.sub);
  });

  app.get('/me', { onRequest: auth }, async (req, reply) => {
    const id = req.user.sub;
    const row = await db
      .selectFrom('users')
      .innerJoin('players', 'players.user_id', 'users.id')
      .select(['users.id', 'users.created_at', 'players.nickname', 'players.archetype'])
      .where('users.id', '=', id)
      .executeTakeFirst();
    if (!row) return reply.code(401).send({ error: 'unauthorized' });
    return { id: row.id, createdAt: row.created_at, player: { nickname: row.nickname, archetype: row.archetype }, configVersion: config.version };
  });

  // Tworzenie postaci (raz): nick + archetyp
  app.post('/players', { onRequest: auth }, async (req, reply) => {
    const body = PlayerBody.parse(req.body);
    await createPlayer(ctx, req.user.sub, body.nickname, body.archetype);
    return reply.code(201).send(await getSilo(ctx, req.user.sub));
  });

  // Stan silosu (rozlicza produkcję i ukończone ulepszenia)
  app.get('/silo', { onRequest: auth }, async (req) => getSilo(ctx, req.user.sub));

  app.post('/buildings/:type/upgrade', { onRequest: auth }, async (req, reply) => {
    const { type } = z.object({ type: z.enum(BUILDING_TYPES) }).parse(req.params);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key, async (trx) => ({ status: 201, body: await startUpgradeTx(trx, ctx, userId, type) }));
    if (!res.replay) await afterUpgradeCommitted(ctx, userId, (res.body as { endsAt: string }).endsAt);
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });

  app.get('/dives/routes', { onRequest: auth }, async (req) => listRoutes(ctx, req.user.sub));
  app.get('/dives/history', { onRequest: auth }, async (req) => diveHistory(ctx, req.user.sub));

  app.post('/dives', { onRequest: auth }, async (req, reply) => {
    const { routeId } = z.object({ routeId: z.string().min(1) }).parse(req.body);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key, async (trx) => ({ status: 201, body: await startDiveTx(trx, ctx, userId, routeId) }));
    if (!res.replay) await afterDiveCommitted(ctx, userId, (res.body as { endsAt: string }).endsAt);
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });

  const idemRoute = (userId: string, key: unknown) => typeof key === 'string' && key.length >= 8 && key.length <= 100;

  app.get('/items', { onRequest: auth }, async (req) => listItems(ctx, req.user.sub));

  app.post('/items/craft', { onRequest: auth }, async (req, reply) => {
    const { recipeId } = z.object({ recipeId: z.string().min(1) }).parse(req.body);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 201, body: await craftTx(trx, ctx, userId, recipeId) }));
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });

  for (const action of ['equip', 'unequip', 'repair', 'upgrade'] as const) {
    app.post(`/items/:id/${action}`, { onRequest: auth }, async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1).max(20) }).parse(req.params);
      const { loadout } = z.object({ loadout: z.union([z.literal(1), z.literal(2)]).optional() }).parse(req.body ?? {});
      const key = req.headers['idempotency-key'];
      if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
      const userId = req.user.sub;
      const res = await idempotent(db, userId, key as string, async (trx) => ({
        status: 200,
        body: action === 'repair' ? await repairTx(trx, ctx, userId, id) : action === 'upgrade' ? await upgradeTx(trx, ctx, userId, id) : await equipTx(trx, ctx, userId, id, action === 'equip', loadout),
      }));
      return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
    });
  }

  app.post('/loadouts/:n/activate', { onRequest: auth }, async (req, reply) => {
    const { n } = z.object({ n: z.string().max(3) }).parse(req.params);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 200, body: await activateLoadoutTx(trx, ctx, userId, Number(n)) }));
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });

  app.get('/radio', { onRequest: auth }, async (req) => getRadio(ctx, req.user.sub));
  app.post('/radio/contact', { onRequest: auth }, async (req, reply) => {
    const { signalId } = z.object({ signalId: z.string().uuid() }).parse(req.body);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 200, body: await contactTx(trx, ctx, userId, signalId) }));
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });
  app.post('/radio/broadcast', { onRequest: auth }, async (req) => {
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    return setBroadcast(ctx, req.user.sub, on);
  });
  // Rynek graczy (materiały za rudę); wymaga Radiostacji `market.radio` i poziomu `market.min_level`
  const idemPost = (path: string, status: number, run: (userId: string, params: Record<string, string>, body: unknown, trx: Transaction<Database>) => Promise<unknown>) =>
    app.post(path, { onRequest: auth }, async (req, reply) => {
      const key = req.headers['idempotency-key'];
      if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
      const userId = req.user.sub;
      const res = await idempotent(db, userId, key as string, async (trx) => ({ status, body: await run(userId, req.params as Record<string, string>, req.body, trx) }));
      return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
    });
  app.get('/market', { onRequest: auth }, async (req) => marketOverview(ctx, req.user.sub));
  app.get('/market/listings', { onRequest: auth }, async (req) => listListings(ctx, req.user.sub, z.object({ material: z.string().optional() }).parse(req.query).material));
  app.get('/contracts', { onRequest: auth }, async (req) => listContracts(ctx, req.user.sub));
  idemPost('/contracts/:day/:slot/accept', 200, (u, p, b, trx) => {
    const x = z.object({ insure: z.boolean().default(false) }).parse(b ?? {});
    const prm = z.object({ day: z.coerce.number().int(), slot: z.coerce.number().int() }).parse(p);
    return acceptContractTx(trx, ctx, u, prm.day, prm.slot, x.insure);
  });
  app.get('/market/shipments', { onRequest: auth }, async (req) => listShipments(ctx, req.user.sub));
  app.get('/market/mine', { onRequest: auth }, async (req) => myMarket(ctx, req.user.sub));
  idemPost('/market/listings', 201, (u, _p, b, trx) => createListingTx(trx, ctx, u, z.object({ material: z.string().min(1), qty: z.number().int(), unitPrice: z.number().int() }).parse(b)));
  idemPost('/market/listings/:id/buy', 200, (u, p, b, trx) => buyListingTx(trx, ctx, u, p.id!, ...((x) => [x.qty, x.insure] as const)(z.object({ qty: z.number().int(), insure: z.boolean().default(false) }).parse(b))));
  idemPost('/market/sell-npc', 200, (u, _p, b, trx) => {
    const x = z.object({ material: z.string().min(1), qty: z.number().int() }).parse(b);
    return sellToBotTx(trx, ctx, u, x.material, x.qty);
  });
  app.delete('/market/listings/:id', { onRequest: auth }, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(20) }).parse(req.params);
    return ctx.db.transaction().execute((trx) => cancelListingTx(trx, ctx, req.user.sub, id));
  });

  app.get('/season', { onRequest: auth }, async (req) => seasonView(ctx, req.user.sub));
  app.get('/season/results', { onRequest: auth }, async (req) => seasonResults(ctx, req.user.sub));

  app.get('/ranking', { onRequest: auth }, async (req) => {
    const { type } = z.object({ type: z.enum(['power', 'loot']).default('power') }).parse(req.query);
    return ranking(ctx, req.user.sub, type);
  });
  app.get('/raids/targets', { onRequest: auth }, async (req) => listTargets(ctx, req.user.sub));
  app.get('/raids', { onRequest: auth }, async (req) => listRaids(ctx, req.user.sub));
  app.post('/raids', { onRequest: auth }, async (req, reply) => {
    const { targetId } = z.object({ targetId: z.string().uuid() }).parse(req.body);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 201, body: await startRaidTx(trx, ctx, userId, targetId) }));
    if (!res.replay) await afterRaidCommitted(ctx, userId, targetId, (res.body as { endsAt: string }).endsAt);
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });
  app.get('/geology', { onRequest: auth }, async (req) => getGeology(ctx, req.user.sub));
  app.post('/exchange/buy', { onRequest: auth }, async (req, reply) => {
    const { material, qty } = z.object({ material: z.string().min(1), qty: z.number().int().min(1).max(500) }).parse(req.body);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 201, body: await exchangeBuyTx(trx, ctx, userId, material, qty) }));
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });
  app.get('/codex', { onRequest: auth }, async (req) => getCodex(ctx, req.user.sub));
  app.get('/research', { onRequest: auth }, async (req) => listResearch(ctx, req.user.sub));
  app.post('/research/:id/start', { onRequest: auth }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(req.params);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 201, body: await startResearchTx(trx, ctx, userId, id) }));
    if (!res.replay) await ctx.scheduler.schedule(userId, new Date((res.body as { endsAt: string }).endsAt)).catch(() => undefined);
    return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
  });

  // Subskrypcja „Wygoda” (docs/subskrypcja-v1.0.md): wygoda, nie siła; stan zawsze z Google Play
  const billing = deps.billing ?? null;
  app.get('/subscription', { onRequest: auth }, async (req) => subscriptionView(ctx, billing, req.user.sub));
  app.post('/subscription/verify', { onRequest: auth }, async (req, reply) => {
    if (!billing) return reply.code(503).send({ error: 'billing_disabled' });
    const body = z.object({ productId: z.string().min(1).max(100), purchaseToken: z.string().min(1).max(4096) }).parse(req.body);
    const key = req.headers['idempotency-key'];
    if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
    const userId = req.user.sub;
    try {
      const res = await idempotent(db, userId, key as string, async (trx) => ({ status: 200, body: await verifySubscriptionTx(trx, ctx, billing, userId, body.productId, body.purchaseToken) }));
      return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
    } catch (e) {
      if (e instanceof BillingUnavailable) return reply.code(503).send({ error: 'billing_unavailable' });
      throw e;
    }
  });
  // Odbiornik RTDN (Pub/Sub push). Treść to tylko sygnał „sprawdź ten token”; stan pobieramy z Google.
  // 2xx = Pub/Sub nie ponawia; 5xx przy awarii Google = ponowienie później.
  app.post('/billing/rtdn', async (req, reply) => {
    if (!billing) return reply.code(503).send({ error: 'billing_disabled' });
    if (!(await billing.client.verifyPushAuth(req.headers.authorization))) return reply.code(401).send({ error: 'unauthorized' });
    const env = RtdnEnvelope.safeParse(req.body);
    if (!env.success) return reply.code(204).send();
    let n: z.infer<typeof DeveloperNotification>;
    try {
      n = DeveloperNotification.parse(JSON.parse(Buffer.from(env.data.message.data, 'base64').toString('utf8')));
    } catch {
      return reply.code(204).send(); // śmieć: nie ma sensu ponawiać
    }
    if (n.packageName !== undefined && n.packageName !== billing.packageName) return reply.code(204).send();
    const token = n.subscriptionNotification?.purchaseToken ?? (n.voidedPurchaseNotification?.productType === 2 ? undefined : n.voidedPurchaseNotification?.purchaseToken);
    if (!token) return reply.code(204).send(); // test, zakup jednorazowy albo inny typ
    const revoked = n.subscriptionNotification?.notificationType === RTDN_REVOKED || n.voidedPurchaseNotification !== undefined;
    try {
      await syncToken(ctx, billing, token, revoked);
    } catch (e) {
      if (e instanceof BillingUnavailable) return reply.code(503).send({ error: 'billing_unavailable' });
      throw e;
    }
    return reply.code(204).send();
  });

  // Rozdanie wolnych punktów statystyk
  app.post('/players/stats', { onRequest: auth }, async (req) => {
    const n = z.number().int().min(0).max(1000).default(0);
    const body = z.object({ sila: n, technika: n, percepcja: n, wytrwalosc: n }).parse(req.body);
    return spendPoints(ctx, req.user.sub, body);
  });

  return app;
}
