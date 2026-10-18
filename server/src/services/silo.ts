import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, Db } from '../db.js';
import { BUILDING_TYPES, type BuildingType, type GameConfig } from '../config.js';
import { advance, type PendingUpgrade, type SiloState } from '../game/silo.js';
import { initialLevels, oreCap, orePerHour, protectedShare, steamCap, steamRegen, upgradeCost, upgradeSeconds, type Levels } from '../game/formulas.js';
import { rng } from '../game/rng.js';
import { addXp, diveChance, poolTotal, resolveDive, steamCost, xpToNext, type Route, type Stats } from '../game/dive.js';
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
  /** ziarno zjazdu; w testach można podstawić */
  seed?: () => number;
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
  const diveOre = await resolveDueDives(trx, cfg, userId, now);
  return { state, oreInt: Math.max(whole, oreInt) + diveOre, done };
}

const ZONE_RESOURCE = 'ore';

async function lockPool(trx: Trx, cfg: GameConfig, route: Route) {
  await trx
    .insertInto('world_pools')
    .values({ zone: route.zone, resource: ZONE_RESOURCE, total: poolTotal(cfg, route), remaining: poolTotal(cfg, route) })
    .onConflict((oc) => oc.columns(['zone', 'resource']).doNothing())
    .execute();
  return trx.selectFrom('world_pools').selectAll().where('zone', '=', route.zone).where('resource', '=', ZONE_RESOURCE).forUpdate().executeTakeFirstOrThrow();
}

/** Rozstrzyga zjazdy, których czas minął. Zwraca sumę przyznanej rudy (do widoku). */
async function resolveDueDives(trx: Trx, cfg: GameConfig, userId: string, now: Date): Promise<number> {
  const due = await trx.selectFrom('dives').selectAll().where('user_id', '=', userId).where('state', '=', 'active').where('ends_at', '<=', now).orderBy('ends_at').execute();
  let oreTotal = 0;
  for (const d of due) {
    const route = cfg.dives.routes.find((r) => r.id === d.route_id)!;
    const p = await trx.selectFrom('players').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
    const arch = cfg.archetypes.find((a) => a.id === p.archetype)!;
    const stats: Stats = { sila: p.sila!, technika: p.technika!, percepcja: p.percepcja!, wytrwalosc: p.wytrwalosc! };
    const pool = await lockPool(trx, cfg, route);
    const out = resolveDive(cfg, route, stats, arch.dive_ore_multiplier, Number(d.seed), { remaining: pool.remaining, total: pool.total });

    await applyLedger(
      trx,
      userId,
      [
        { resource: 'ore', delta: out.ore, reason: 'dive_reward', ref: `dive:${d.id}` },
        { resource: 'tokens', delta: out.tokens, reason: 'dive_reward', ref: `dive:${d.id}:tokens` },
      ],
      cfg.version,
    );
    oreTotal += out.ore;
    if (out.poolDraw > 0) await trx.updateTable('world_pools').set({ remaining: pool.remaining - out.poolDraw }).where('zone', '=', pool.zone).where('resource', '=', pool.resource).execute();
    const lv = addXp(cfg, p.level, Number(p.xp), out.xp);
    await trx.updateTable('players').set({ level: lv.level, xp: String(lv.xpInLevel), free_points: p.free_points + lv.points }).where('user_id', '=', userId).execute();
    if (!out.success) await trx.updateTable('silos').set({ winded_until: new Date(d.ends_at.getTime() + cfg.dives.winded_seconds * 1000) }).where('user_id', '=', userId).execute();
    const result = { success: out.success, chancePct: Math.round(out.chance * 100), ore: out.ore, tokens: out.tokens, xp: out.xp, level: lv.level, levelUp: lv.level > p.level };
    await trx.updateTable('dives').set({ state: 'resolved', result: JSON.stringify(result) }).where('id', '=', d.id).execute();
    await trx.insertInto('notifications').values({ user_id: userId, type: 'dive_done', payload: JSON.stringify({ routeId: route.id, ...result }), sent_at: null, read_at: null }).execute();
    await trx.insertInto('events_log').values({ user_id: userId, name: 'dive_done', props: JSON.stringify({ routeId: route.id, ...result }) }).execute();
  }
  return oreTotal;
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
  const diveRow = await trx.selectFrom('dives').selectAll().where('user_id', '=', userId).where('state', '=', 'active').executeTakeFirst();
  const siloRow = await trx.selectFrom('silos').select('winded_until').where('user_id', '=', userId).executeTakeFirstOrThrow();
  const lv = st.state.levels;
  const x = Math.max(cfg.economy.deposit.floor_fraction, st.state.depositRemaining / st.state.depositTotal);
  return {
    player: {
      nickname: p.nickname,
      archetype: p.archetype,
      level: p.level,
      xp: Number(p.xp),
      xpToNext: p.level >= cfg.progression.max_level ? null : xpToNext(cfg, p.level),
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
    dive: diveRow ? { routeId: diveRow.route_id, endsAt: diveRow.ends_at } : null,
    windedUntil: siloRow.winded_until && siloRow.winded_until > st.state.at ? siloRow.winded_until : null,
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


export async function startDiveTx(trx: Trx, ctx: Ctx, userId: string, routeId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  const route = cfg.dives.routes.find((r) => r.id === routeId);
  if (!route) throw new GameError(400, 'unknown_route');
  const st = await settle(trx, cfg, userId, now);
  const p = await trx.selectFrom('players').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  if (p.level < route.min_level) throw new GameError(409, 'level_too_low');
  const active = await trx.selectFrom('dives').select('id').where('user_id', '=', userId).where('state', '=', 'active').executeTakeFirst();
  if (active) throw new GameError(409, 'dive_active');
  const silo = await trx.selectFrom('silos').select(['steam', 'winded_until']).where('user_id', '=', userId).executeTakeFirstOrThrow();
  if (silo.winded_until && silo.winded_until > now) throw new GameError(409, 'winded');
  const arch = cfg.archetypes.find((a) => a.id === p.archetype)!;
  const cost = steamCost(route, arch.dive_steam_multiplier);
  if (st.state.steam + EPS < cost) throw new GameError(402, 'insufficient_steam');
  await trx.updateTable('silos').set({ steam: silo.steam - cost }).where('user_id', '=', userId).execute();
  const seed = ctx.seed ? ctx.seed() : randomInt(1, 2 ** 31);
  const endsAt = new Date(now.getTime() + route.seconds * 1000);
  const d = await trx
    .insertInto('dives')
    .values({ user_id: userId, route_id: route.id, started_at: now, ends_at: endsAt, seed, steam_cost: cost, result: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx.insertInto('events_log').values({ user_id: userId, name: 'dive_started', props: JSON.stringify({ routeId: route.id, steam: cost }) }).execute();
  return { diveId: String(d.id), routeId: route.id, steamCost: cost, endsAt: endsAt.toISOString() };
}

export async function listRoutes(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  const p = await ctx.db.selectFrom('players').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  if (!p.archetype) throw new GameError(409, 'no_player');
  const arch = cfg.archetypes.find((a) => a.id === p.archetype)!;
  const stats: Stats = { sila: p.sila!, technika: p.technika!, percepcja: p.percepcja!, wytrwalosc: p.wytrwalosc! };
  const pools = await ctx.db.selectFrom('world_pools').selectAll().execute();
  return cfg.dives.routes.map((r) => {
    const pool = pools.find((x) => x.zone === r.zone);
    return {
      id: r.id,
      name: r.name,
      zone: r.zone,
      minLevel: r.min_level,
      locked: p.level < r.min_level,
      seconds: r.seconds,
      steam: steamCost(r, arch.dive_steam_multiplier),
      chancePct: Math.round(diveChance(stats, r.difficulty) * 100),
      ore: [Math.round(r.ore[0] * arch.dive_ore_multiplier), Math.round(r.ore[1] * arch.dive_ore_multiplier)],
      tokens: r.tokens,
      xp: r.xp,
      zoneRichness: pool ? depositHint(pool.remaining, pool.total, cfg.dives.pool_floor_fraction) : 'bogate',
    };
  });
}

export async function diveHistory(ctx: Ctx, userId: string, limit = 10) {
  const rows = await ctx.db.selectFrom('dives').selectAll().where('user_id', '=', userId).where('state', '=', 'resolved').orderBy('ends_at', 'desc').limit(limit).execute();
  return rows.map((d) => ({ id: String(d.id), routeId: d.route_id, endedAt: d.ends_at, result: d.result }));
}

export async function spendPoints(ctx: Ctx, userId: string, add: Stats) {
  const total = add.sila + add.technika + add.percepcja + add.wytrwalosc;
  if (total <= 0) throw new GameError(400, 'bad_request');
  await ctx.db.transaction().execute(async (trx) => {
    const p = await trx.selectFrom('players').selectAll().where('user_id', '=', userId).forUpdate().executeTakeFirstOrThrow();
    if (!p.archetype) throw new GameError(409, 'no_player');
    if (total > p.free_points) throw new GameError(409, 'not_enough_points');
    await trx
      .updateTable('players')
      .set({ sila: p.sila! + add.sila, technika: p.technika! + add.technika, percepcja: p.percepcja! + add.percepcja, wytrwalosc: p.wytrwalosc! + add.wytrwalosc, free_points: p.free_points - total })
      .where('user_id', '=', userId)
      .execute();
    await trx.insertInto('events_log').values({ user_id: userId, name: 'points_spent', props: JSON.stringify(add) }).execute();
  });
  return getSilo(ctx, userId);
}

export async function afterDiveCommitted(ctx: Ctx, userId: string, endsAt: string) {
  await ctx.scheduler.schedule(userId, new Date(endsAt)).catch(() => undefined);
}

export type { Kysely, Levels };
