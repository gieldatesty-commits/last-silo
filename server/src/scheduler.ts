import { PgBoss } from 'pg-boss';
import type { Ctx, Scheduler } from './services/silo.js';
import { settleUser } from './services/silo.js';
import { seasonTick } from './services/season.js';
import { syncDueSubscriptions, type Billing } from './services/subscription.js';

const QUEUE = 'settle-silo';
const SEASON_QUEUE = 'season-tick';
const SUB_QUEUE = 'subscription-sync';

export interface RunningScheduler extends Scheduler {
  stop(): Promise<void>;
}

/** Timery na pg-boss: o `ends_at` budzimy worker, który rozlicza silos. Rozliczenie jest idempotentne. */
export async function startScheduler(ctx: Omit<Ctx, 'scheduler'>, connectionString: string, billing: Billing | null = null): Promise<RunningScheduler> {
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
    // jeden zepsuty wpis (np. gracz skasowany przez reset sezonu) nie może wywracać całej paczki
    let firstError: unknown;
    for (const j of jobs) {
      try {
        await settleUser(full, j.data.userId);
      } catch (e) {
        if ((e as { code?: string }).code === 'no_player') continue;
        firstError ??= e;
      }
    }
    if (firstError) throw firstError;
  });

  // sezon: sprawdzaj co 5 minut (zamknięcie, start następnego)
  await boss.createQueue(SEASON_QUEUE);
  await boss.schedule(SEASON_QUEUE, '*/5 * * * *');
  await boss.work(SEASON_QUEUE, async () => {
    await seasonTick(full);
  });

  // subskrypcje: siatka bezpieczeństwa, gdy RTDN zawiedzie (wygasające w oknie, grace/on_hold, niepotwierdzone)
  if (billing) {
    await boss.createQueue(SUB_QUEUE);
    await boss.schedule(SUB_QUEUE, '17 * * * *');
    await boss.work(SUB_QUEUE, async () => {
      const r = await syncDueSubscriptions(full, billing);
      if (r.failed > 0) console.error(`subscription-sync: ${r.failed}/${r.checked} nieudanych`);
    });
  }

  // po restarcie: zaplanuj ponownie wszystkie niezakończone zadania
  const pending = await ctx.db.selectFrom('jobs').select(['user_id', 'ends_at']).where('state', '=', 'pending').execute();
  for (const j of pending) await self.schedule(j.user_id, j.ends_at);
  return self;
}
