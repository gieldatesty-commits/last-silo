import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { applyLedger, InsufficientFunds } from '../ledger.js';
import { researchSeconds } from '../game/research.js';
import { GameError, settle, type Ctx } from './silo.js';
import { radioLevel } from './items.js';

type Trx = Transaction<Database>;

async function labLevel(db: Trx | Ctx['db'], userId: string) {
  return (await db.selectFrom('buildings').select('level').where('user_id', '=', userId).where('type', '=', 'laboratorium').executeTakeFirst())?.level ?? 1;
}

/** Drzewo badań: stan każdego badania i powód blokady. */
export async function listResearch(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  // rozlicz ukończone badania (lekko, w transakcji z blokadą silosu)
  await ctx.db.transaction().execute((trx) => settle(trx, cfg, userId, ctx.now()));
  const rows = await ctx.db.selectFrom('research').selectAll().where('user_id', '=', userId).execute();
  const lab = await labLevel(ctx.db, userId);
  const rl = await radioLevel(ctx.db, userId);
  const done = new Set(rows.filter((r) => r.state === 'done').map((r) => r.tech_id));
  const active = rows.find((r) => r.state === 'active');
  return {
    labLevel: lab,
    active: active ? { techId: active.tech_id, endsAt: active.ends_at } : null,
    techs: cfg.research.techs.map((t) => {
      const missing = t.requires.filter((q) => !done.has(q));
      const state = done.has(t.id) ? 'done' : active?.tech_id === t.id ? 'active' : missing.length || lab < t.lab || (!!t.radio && rl < t.radio) ? 'locked' : 'available';
      return {
        id: t.id,
        name: t.name,
        branch: t.branch,
        state,
        labRequired: t.lab,
        requires: t.requires,
        missing,
        ore: t.ore,
        tokens: t.tokens,
        samples: t.samples,
        materials: t.materials,
        radioRequired: t.radio ?? null,
        seconds: researchSeconds(cfg, t.seconds, lab),
        effect: t.effect,
        unlocks: t.unlocks,
      };
    }),
  };
}

export async function startResearchTx(trx: Trx, ctx: Ctx, userId: string, techId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  const t = cfg.research.techs.find((x) => x.id === techId);
  if (!t) throw new GameError(400, 'unknown_tech');
  await settle(trx, cfg, userId, now);
  const rows = await trx.selectFrom('research').selectAll().where('user_id', '=', userId).execute();
  if (rows.some((r) => r.tech_id === t.id && r.state === 'done')) throw new GameError(409, 'already_researched');
  if (rows.some((r) => r.state === 'active')) throw new GameError(409, 'research_busy');
  const done = new Set(rows.filter((r) => r.state === 'done').map((r) => r.tech_id));
  if (t.requires.some((q) => !done.has(q))) throw new GameError(409, 'prerequisites_missing');
  const lab = await labLevel(trx, userId);
  if (lab < t.lab) throw new GameError(409, 'lab_too_low');
  if (t.radio && (await radioLevel(trx, userId)) < t.radio) throw new GameError(409, 'radio_too_low');
  const endsAt = new Date(now.getTime() + researchSeconds(cfg, t.seconds, lab) * 1000);
  await trx.insertInto('research').values({ user_id: userId, tech_id: t.id, state: 'active', ends_at: endsAt }).execute();
  try {
    await applyLedger(
      trx,
      userId,
      [
        { resource: 'ore', delta: -t.ore, reason: 'research_cost', ref: `research:${t.id}` },
        { resource: 'tokens', delta: -t.tokens, reason: 'research_cost', ref: `research:${t.id}:tokens` },
        { resource: 'samples', delta: -t.samples, reason: 'research_cost', ref: `research:${t.id}:samples` },
        ...Object.entries(t.materials).map(([m, n]) => ({ resource: m, delta: -n, reason: 'research_cost' as const, ref: `research:${t.id}:mat:${m}` })),
      ],
      cfg.version,
    );
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, `insufficient_${e.resource}`);
    throw e;
  }
  await trx.insertInto('events_log').values({ user_id: userId, name: 'research_started', props: JSON.stringify({ tech: t.id }) }).execute();
  return { techId: t.id, endsAt: endsAt.toISOString() };
}
