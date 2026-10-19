import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.js';
import { BUILDING_TYPES, type GameConfig } from './config.js';
import { idempotent } from './idempotency.js';
import { afterDiveCommitted, afterUpgradeCommitted, createPlayer, diveHistory, GameError, getSilo, listRoutes, spendPoints, startDiveTx, startUpgradeTx, type Ctx, type Scheduler } from './services/silo.js';
import { afterRaidCommitted, listRaids, listTargets, startRaidTx } from './services/raids.js';
import { contactTx, getRadio, ranking, setBroadcast } from './services/radio.js';
import { exchangeBuyTx, getGeology } from './services/trade.js';
import { getCodex } from './services/codex.js';
import { listResearch, startResearchTx } from './services/research.js';
import { craftTx, equipTx, listItems, repairTx, upgradeTx } from './services/items.js';

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
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

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
      const row = await db.selectFrom('users').select(['id', 'guest_secret_hash']).where('id', '=', userId).executeTakeFirst();
      const ok = row && timingSafeEqual(Buffer.from(row.guest_secret_hash), Buffer.from(sha256(guestSecret)));
      if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
      return { userId, token: app.jwt.sign({ sub: userId }) };
    }

    const secret = randomBytes(32).toString('hex');
    const id = await db.transaction().execute(async (trx) => {
      const u = await trx.insertInto('users').values({ guest_secret_hash: sha256(secret), google_sub: null }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('players').values({ user_id: u.id, nickname: null, archetype: null, sila: null, technika: null, percepcja: null, wytrwalosc: null, silo_lat: null, silo_lon: null, config_version: null }).execute();
      await trx.insertInto('events_log').values({ user_id: u.id, name: 'account_created', props: JSON.stringify({ method: 'guest' }) }).execute();
      return u.id;
    });
    return reply.code(201).send({ userId: id, guestSecret: secret, token: app.jwt.sign({ sub: id }) });
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
      const key = req.headers['idempotency-key'];
      if (!idemRoute(req.user.sub, key)) return reply.code(400).send({ error: 'missing_idempotency_key' });
      const userId = req.user.sub;
      const res = await idempotent(db, userId, key as string, async (trx) => ({
        status: 200,
        body: action === 'repair' ? await repairTx(trx, ctx, userId, id) : action === 'upgrade' ? await upgradeTx(trx, ctx, userId, id) : await equipTx(trx, ctx, userId, id, action === 'equip'),
      }));
      return reply.code(res.status).header('idempotent-replay', String(res.replay)).send(res.body);
    });
  }

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

  // Rozdanie wolnych punktów statystyk
  app.post('/players/stats', { onRequest: auth }, async (req) => {
    const n = z.number().int().min(0).max(1000).default(0);
    const body = z.object({ sila: n, technika: n, percepcja: n, wytrwalosc: n }).parse(req.body);
    return spendPoints(ctx, req.user.sub, body);
  });

  return app;
}
