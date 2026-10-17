import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.js';
import type { GameConfig } from './config.js';

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
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const GuestBody = z
  .object({ userId: z.uuid(), guestSecret: z.string().min(16) })
  .partial()
  .refine((b) => (b.userId === undefined) === (b.guestSecret === undefined), {
    message: 'podaj userId i guestSecret razem albo wcale',
  });

export function buildApp({ db, config, jwtSecret }: AppDeps) {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: jwtSecret, sign: { expiresIn: '30d' } });

  app.get('/health', async () => ({ ok: true, configVersion: config.version }));

  // Gość: bez body tworzy konto; z userId+guestSecret loguje ponownie.
  app.post('/auth/guest', async (req, reply) => {
    const parsed = GuestBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const { userId, guestSecret } = parsed.data;

    if (userId && guestSecret) {
      const row = await db.selectFrom('users').select(['id', 'guest_secret_hash']).where('id', '=', userId).executeTakeFirst();
      const ok =
        row &&
        timingSafeEqual(Buffer.from(row.guest_secret_hash), Buffer.from(sha256(guestSecret)));
      if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
      return { userId, token: app.jwt.sign({ sub: userId }) };
    }

    const secret = randomBytes(32).toString('hex');
    const id = await db.transaction().execute(async (trx) => {
      const u = await trx
        .insertInto('users')
        .values({ guest_secret_hash: sha256(secret) } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('players').values({ user_id: u.id } as never).execute();
      await trx
        .insertInto('events_log')
        .values({ user_id: u.id, name: 'account_created', props: JSON.stringify({ method: 'guest' }) } as never)
        .execute();
      return u.id;
    });
    return reply.code(201).send({ userId: id, guestSecret: secret, token: app.jwt.sign({ sub: id }) });
  });

  app.get(
    '/me',
    { onRequest: async (req, reply) => req.jwtVerify().catch(() => reply.code(401).send({ error: 'unauthorized' })) },
    async (req, reply) => {
      const id = req.user.sub;
      const row = await db
        .selectFrom('users')
        .innerJoin('players', 'players.user_id', 'users.id')
        .select(['users.id', 'users.created_at', 'players.nickname', 'players.archetype'])
        .where('users.id', '=', id)
        .executeTakeFirst();
      if (!row) return reply.code(401).send({ error: 'unauthorized' });
      return {
        id: row.id,
        createdAt: row.created_at,
        player: { nickname: row.nickname, archetype: row.archetype },
        configVersion: config.version,
      };
    },
  );

  return app;
}
