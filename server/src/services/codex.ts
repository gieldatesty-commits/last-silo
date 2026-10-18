import { settle, type Ctx } from './silo.js';

/** Kodeks Rdzeniowców: treść wpisu widoczna dopiero po ukończeniu powiązanego badania. */
export async function getCodex(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  await ctx.db.transaction().execute((trx) => settle(trx, cfg, userId, ctx.now()));
  const done = new Set((await ctx.db.selectFrom('research').select('tech_id').where('user_id', '=', userId).where('state', '=', 'done').execute()).map((r) => r.tech_id));
  const entries = cfg.codex.map((c, i) => {
    const t = cfg.research.techs.find((x) => x.id === c.tech)!;
    return done.has(c.tech)
      ? { id: c.id, order: i + 1, unlocked: true, title: c.title, text: c.text }
      : { id: c.id, order: i + 1, unlocked: false, hint: `Wymaga badania: ${t.name}` };
  });
  return { unlocked: entries.filter((e) => e.unlocked).length, total: entries.length, entries };
}
