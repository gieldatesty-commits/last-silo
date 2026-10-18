import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, Db } from '../db.js';
import { BUILDING_TYPES, type BuildingType, type GameConfig } from '../config.js';
import { advance, type PendingUpgrade, type SiloState } from '../game/silo.js';
import { initialLevels, oreCap, orePerHour, protectedShare, steamCap, steamRegen, upgradeCost, upgradeSeconds, type Levels } from '../game/formulas.js';
import { rng } from '../game/rng.js';
import { placeSilo, rollLocalDeposit, type LatLon } from '../game/world.js';
import { applyLedger, walletBalance, InsufficientFunds } from '../ledger.js';
import { randomInt } from 'node:crypto';

export class GameError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export interface Scheduler {
  schedule(userId: string, at: Date): Promise<void>;
}

export interface Ctx {
  db: Db;
  config: GameConfig;
  now: () => Date;
  scheduler: Scheduler;
}

type Trx = Transaction<Database>;

const EPS = 1e-9;

/** Tworzy postać: statystyki z archetypu, pozycja silosu, ukryte złoże, budynki L1, ruda startowa. */
export async function createPlayer(ctx: Ctx, userId: string, nickname: string, archetypeId: string) {
  const { config: cfg } = ctx;
  const arch = cfg.archetypes.find((a) => a.id === archetypeId);
  if (!arch) throw new GameError(400, 'unknown_archetype');
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(7001)`.execute(trx);
    const me = await trx.selectFrom('players').select(['archetype']).where('user_id', '=', userId).forUpdate().executeTakeFirst();
    if (!me) throw new GameError(401, 'unauthorized');
    if (me.archetype) throw new GameError(409, 'already_created');
    const taken = await trx.selectFrom('players').select('user_id').where(sql<boolean>`lower(nickname) = lower(${nickname})`).executeTakeFirst();
    if (taken) throw new GameError(409, 'nickname_taken');

    const existing: LatLon[] = (await trx.selectFrom('players').select(['silo_lat', 'silo_lon']).where('silo_lat', 'is not', null).execute()).map((r) => ({
      lat: r.silo_lat!,
      lon: r.silo_lon!,
    }));
    const seed = randomInt(1, 2 ** 31);
    const r = rng(seed);
    const pos = placeSilo(cfg, existing, r);
    const total = rollLocalDeposit(cfg, r);

    await trx
      .updateTable('players')
      .set({
        nickname,
        archetype: arch.id,
        sila: arch.stats.sila,
        technika: arch.stats.technika,
        percepcja: arch.stats.percepcja,
        wytrwalosc: arch.stats.wytrwalosc,
        silo_lat: pos.lat,
        silo_lon: pos.lon,
        config_version: cfg.version,
      })
      .where('user_id', '=', userId)
      .execute();
    await trx
      .insertInto('silos')
      .values({ user_id: userId, steam: steamCap(cfg, 1), settled_at: now, deposit_total: total, deposit_remaining: total, seed })
      .execute();
    await trx
      .insertInto('buildings')
      .values(BUILDING_TYPES.map((t) => ({ user_id: userId, type: t, level: 1 })))
      .execute();
    await applyLedger(trx, userId, [{ resource: 'ore', delta: cfg.economy.start_ore, reason: 'starting_grant', ref: 'start' }], cfg.version);
    await trx
      .insertInto('events_log')
      .values({ user_id: userId, name: 'player_created', props: JSON.stringify({ archetype: arch.id }) })
      .execute();
  });
}

interface Settled {
  state: SiloState;
  oreInt: number;
  done: PendingUpgrade[];
}

/** Rozlicza silos do `now`: produkcja, para, ukończone ulepszenia. Idempotentne, serializowane blokadą wiersza. */
export async function settle(trx: Trx, cfg: GameConfig, userId: string, now: Date): Promise<Settled> {
  const silo = await trx.selectFrom('silos').selectAll().where('user_id', '=', userId).forUpdate().executeTakeFirst();
  if (!silo) throw new GameError(409, 'no_player');
  const rows = await trx.selectFrom('buildings').select(['type', 'level']).where('user_id', '=', userId).execute();
  const levels = initialLevels();
  for (const b of rows) levels[b.type as BuildingType] = b.level;
  const oreInt = await walletBalance(trx, userId, 'ore');
  const pendingRows = await trx.selectFrom('jobs').selectAll().where('user_id', '=', userId).where('state', '=', 'pending').where('kind', '=', 'building').execute();
  const pending: PendingUpgrade[] = pendingRows.map((j) => ({ id: Number(j.id), type: j.building_type as BuildingType, toLevel: j.to_level!, endsAt: j.ends_at }));

  const s0: SiloState = {
    levels,
    oreReal: oreInt + silo.ore_carry,
    steam: silo.steam,
    depositTotal: silo.deposit_total,
    depositRemaining: silo.deposit_remaining,
    at: silo.settled_at,
  };
  const { state, done } = advance(s0, cfg, now, pending);

  const whole = Math.floor(state.oreReal + EPS);
  const gained = Math.max(0, whole - oreInt);
  if (gained > 0) await applyLedger(trx, userId, [{ resource: 'ore', delta: gained, reason: 'production', ref: `prod:${state.at.toISOString()}` }], cfg.version);
  const carry = Math.max(0, state.oreReal - Math.max(whole, oreInt));

  await trx
    .updateTable('silos')
    .set({ steam: state.steam, ore_carry: carry, settled_at: state.at, deposit_remaining: state.depositRemaining })
    .where('user_id', '=', userId)
    .execute();

  for (const u of done) {
    await trx.updateTable('buildings').set({ level: u.toLevel }).where('user_id', '=', userId).where('type', '=', u.type).execute();
    await trx.updateTable('jobs').set({ state: 'done' }).where('id', '=', String(u.id)).execute();
    await trx
      .insertInto('notifications')
      .values({ user_id: userId, type: 'building_done', payload: JSON.stringify({ building: u.type, level: u.toLevel }), sent_at: null, read_at: null })
      .execute();
    await trx
      .insertInto('events_log')
      .values({ user_id: userId, name: 'upgrade_done', props: JSON.stringify({ building: u.type, level: u.toLevel }) })
      .execute();
  }
  return { state, oreInt: Math.max(whole, oreInt), done };
}

/** Rozlicz bez widoku (używane przez scheduler). */
export async function settleUser(ctx: Ctx, userId: string): Promise<void> {
  await ctx.db.transaction().execute((trx) => settle(trx, ctx.config, userId, ctx.now()).then(() => undefined));
}

function depositHint(remaining: number, total: number, floor: number): 'bogate' | 'srednie' | 'ubogie' | 'na_wyczerpaniu' {
  const x = remaining / total;
  if (x > 0.7) return 'bogate';
  if (x > 0.35) return 'srednie';
  if (x > floor + 0.05) return 'ubogie';
  return 'na_wyczerpaniu';
}

async function buildView(trx: Trx, cfg: GameConfig, userId: string, st: Settled) {
  const p = await trx.selectFrom('players').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  const arch = cfg.archetypes.find((a) => a.id === p.archetype)!;
  const tokens = await walletBalance(trx, userId, 'tokens');
  const jobRow = await trx.selectFrom('jobs').selectAll().where('user_id', '=', userId).where('state', '=', 'pending').orderBy('ends_at').executeTakeFirst();
  const lv = st.state.levels;
  const x = Math.max(cfg.economy.deposit.floor_fraction, st.state.depositRemaining / st.state.depositTotal);
  return {
    player: {
      nickname: p.nickname,
      archetype: p.archetype,
      level: p.level,
      xp: Number(p.xp),
      stats: { sila: p.sila, technika: p.technika, percepcja: p.percepcja, wytrwalosc: p.wytrwalosc },
      freePoints: p.free_points,
    },
    silo: { lat: p.silo_lat, lon: p.silo_lon, depth: p.depth, deposit: depositHint(st.state.depositRemaining, st.state.depositTotal, cfg.economy.deposit.floor_fraction) },
    wallet: { ore: st.oreInt, steam: Math.floor(st.state.steam + EPS), tokens },
    caps: { ore: oreCap(cfg, lv.magazyn), steam: steamCap(cfg, lv.generator_pary) },
    rates: { orePerHour: Math.round(orePerHour(cfg, lv.szyb_glowny) * x * 100) / 100, steamPerMin: steamRegen(cfg, lv.generator_pary) },
    protectedShare: protectedShare(cfg, lv.magazyn),
    buildings: cfg.buildings.map((b) => {
      const level = lv[b.id];
      const next = level + 1;
      return {
        type: b.id,
        name: b.name,
        level,
        maxLevel: cfg.upgrades.max_level,
        next: level >= cfg.upgrades.max_level ? null : { level: next, cost: upgradeCost(cfg, b.id, next, arch.upgrade_cost_multiplier), seconds: upgradeSeconds(cfg, next) },
      };
    }),
    job: jobRow ? { type: jobRow.building_type, toLevel: jobRow.to_level, endsAt: jobRow.ends_at } : null,
    serverTime: st.state.at,
    configVersion: cfg.version,
  };
}

export async function getSilo(ctx: Ctx, userId: string) {
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => buildView(trx, ctx.config, userId, await settle(trx, ctx.config, userId, now)));
}

/** Rdzeń ulepszenia – wykonywany w transakcji wywołującego (potrzebne dla idempotencji). */
export async function startUpgradeTx(trx: Trx, ctx: Ctx, userId: string, type: BuildingType) {
  const cfg = ctx.config;
  const now = ctx.now();
  const st = await settle(trx, cfg, userId, now);
  const pendingCount = Number((await trx.selectFrom('jobs').select((e) => e.fn.countAll().as('n')).where('user_id', '=', userId).where('state', '=', 'pending').executeTakeFirstOrThrow()).n);
  if (pendingCount >= cfg.upgrades.queue_slots) throw new GameError(409, 'queue_full');
  const level = st.state.levels[type];
  if (level >= cfg.upgrades.max_level) throw new GameError(409, 'max_level');
  const toLevel = level + 1;
  const p = await trx.selectFrom('players').select('archetype').where('user_id', '=', userId).executeTakeFirstOrThrow();
  const mult = cfg.archetypes.find((a) => a.id === p.archetype)!.upgrade_cost_multiplier;
  const cost = upgradeCost(cfg, type, toLevel, mult);
  const endsAt = new Date(now.getTime() + upgradeSeconds(cfg, toLevel) * 1000);
  const job = await trx
    .insertInto('jobs')
    .values({ user_id: userId, kind: 'building', building_type: type, to_level: toLevel, ends_at: endsAt })
    .returning('id')
    .executeTakeFirstOrThrow();
  try {
    await applyLedger(trx, userId, [{ resource: 'ore', delta: -cost, reason: 'building_cost', ref: `job:${job.id}` }], cfg.version);
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, 'insufficient_ore');
    throw e;
  }
  await trx
    .insertInto('events_log')
    .values({ user_id: userId, name: 'upgrade_started', props: JSON.stringify({ building: type, level: toLevel, cost }) })
    .execute();
  return { jobId: String(job.id), type, toLevel, cost, endsAt: endsAt.toISOString() };
}

export async function afterUpgradeCommitted(ctx: Ctx, userId: string, endsAt: string) {
  // awaria schedulera nie psuje budowy: settle przy otwarciu aplikacji to dociągnie
  await ctx.scheduler.schedule(userId, new Date(endsAt)).catch(() => undefined);
}

export async function startUpgrade(ctx: Ctx, userId: string, type: BuildingType) {
  const r = await ctx.db.transaction().execute((trx) => startUpgradeTx(trx, ctx, userId, type));
  await afterUpgradeCommitted(ctx, userId, r.endsAt);
  return r;
}

export type { Kysely, Levels };
