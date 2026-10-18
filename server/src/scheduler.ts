import { PgBoss } from 'pg-boss';
import type { Ctx, Scheduler } from './services/silo.js';
import { settleUser } from './services/silo.js';

const QUEUE = 'settle-silo';

export interface RunningScheduler extends Scheduler {
  stop(): Promise<void>;
}

/** Timery na pg-boss: o `ends_at` budzimy worker, który rozlicza silos. Rozliczenie jest idempotentne. */
export async function startScheduler(ctx: Omit<Ctx, 'scheduler'>, connectionString: string): Promise<RunningScheduler> {
  const boss = new PgBoss(connectionString);
  boss.on('error', (e) => console.error('pg-boss', e));
  await boss.start();
  await boss.createQueue(QUEUE);

  const self: RunningScheduler = {
    async schedule(userId, at) {
      await boss.send(QUEUE, { userId }, { startAfter: at, retryLimit: 5, retryDelay: 10 });
    },
    stop: () => boss.stop({ graceful: true }),
  };
  const full: Ctx = { ...ctx, scheduler: self };

  await boss.work<{ userId: string }>(QUEUE, async (jobs) => {
    for (const j of jobs) await settleUser(full, j.data.userId);
  });

  // po restarcie: zaplanuj ponownie wszystkie niezakończone zadania
  const pending = await ctx.db.selectFrom('jobs').select(['user_id', 'ends_at']).where('state', '=', 'pending').execute();
  for (const j of pending) await self.schedule(j.user_id, j.ends_at);
  return self;
}
