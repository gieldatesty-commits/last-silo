import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, Db } from '../db.js';
import { BUILDING_TYPES, type BuildingType, type GameConfig } from '../config.js';
import { advance, type PendingUpgrade, type SiloState } from '../game/silo.js';
import { initialLevels, maxLevelOf, oreCap, orePerHour, protectedShare, steamCap, steamRegen, upgradeCost, upgradeSeconds, type Levels } from '../game/formulas.js';
import { rng } from '../game/rng.js';
import { addXp, diveChance, queueCheck, regenPool, resolveDive, routeRewards, steamCost, xpToNext, type Route, type Stats } from '../game/dive.js';
import { describeProfile, geologyProfile } from '../game/geology.js';
import { placeSilo, rollLocalDeposit, type LatLon } from '../game/world.js';
import { applyLedger, walletBalance, InsufficientFunds } from '../ledger.js';
import { resolveDueRaids } from './raids.js';
import { resolveDueShipments } from './caravans.js';
import { resolveDueContracts } from './contracts.js';
import { equippedBonus, loadEffects, wearEquipped } from './gear.js';
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

export type Trx = Transaction<Database>;

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
    // każdy nowy silos dokłada swój udział do wspólnych pul stref
    for (const [zone, z] of Object.entries(cfg.dives.zones)) {
      await trx
        .insertInto('world_pools')
        .values({ zone, resource: 'ore', total: z.pool_per_player, remaining: z.pool_per_player })
        .onConflict((oc) => oc.columns(['zone', 'resource']).doUpdateSet({ total: sql`world_pools.total + ${z.pool_per_player}` as never, remaining: sql`world_pools.remaining + ${z.pool_per_player}` as never }))
        .execute();
    }
    const carry = (await trx.selectFrom('players').select('carry_bonus_ore').where('user_id', '=', userId).executeTakeFirstOrThrow()).carry_bonus_ore;
    await applyLedger(trx, userId, [{ resource: 'ore', delta: cfg.economy.start_ore, reason: 'starting_grant', ref: 'start' }, ...(carry > 0 ? [{ resource: 'ore', delta: Math.min(carry, cfg.season.max_bonus_ore), reason: 'starting_grant' as const, ref: 'season_bonus' }] : [])], cfg.version);
    if (carry > 0) await trx.updateTable('players').set({ carry_bonus_ore: 0 }).where('user_id', '=', userId).execute();
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
  // najpierw najazdy, które dotarły (blokują oba silosy w stałej kolejności), potem zwykłe rozliczenie
  await resolveDueRaids(trx, cfg, userId, now);
  await resolveDueShipments(trx, cfg, userId, now);
  await resolveDueContracts(trx, cfg, userId, now);
  return settleCore(trx, cfg, userId, now);
}

/** Rozlicza jeden silos bez ruszania najazdów (używane też przy rozstrzyganiu najazdu dla drugiej strony). */
export async function settleCore(trx: Trx, cfg: GameConfig, userId: string, now: Date): Promise<Settled> {
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
  const doneTech = await trx.updateTable('research').set({ state: 'done' }).where('user_id', '=', userId).where('state', '=', 'active').where('ends_at', '<=', now).returning('tech_id').execute();
  for (const t of doneTech) {
    await trx.insertInto('notifications').values({ user_id: userId, type: 'research_done', payload: JSON.stringify({ tech: t.tech_id }), sent_at: null, read_at: null }).execute();
    await trx.insertInto('events_log').values({ user_id: userId, name: 'research_done', props: JSON.stringify({ tech: t.tech_id }) }).execute();
  }
  const diveOre = await resolveDueDives(trx, cfg, userId, now);
  return { state, oreInt: Math.max(whole, oreInt) + diveOre, done };
}

const ZONE_RESOURCE = 'ore';

async function lockPool(trx: Trx, cfg: GameConfig, route: Route, now: Date) {
  await trx
    .insertInto('world_pools')
    .values({ zone: route.zone, resource: ZONE_RESOURCE, total: 0, remaining: 0 })
    .onConflict((oc) => oc.columns(['zone', 'resource']).doNothing())
    .execute();
  const row = await trx.selectFrom('world_pools').selectAll().where('zone', '=', route.zone).where('resource', '=', ZONE_RESOURCE).forUpdate().executeTakeFirstOrThrow();
  const dt = now.getTime() - row.regen_at.getTime();
  if (dt <= 0) return row;
  const remaining = regenPool(cfg, route.zone, Number(row.remaining), Number(row.total), dt);
  await trx.updateTable('world_pools').set({ remaining, regen_at: now }).where('zone', '=', route.zone).where('resource', '=', ZONE_RESOURCE).execute();
  return { ...row, remaining };
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
    const pool = await lockPool(trx, cfg, route, now);
    const fx = await loadEffects(trx, cfg, userId);
    const bonus = (await equippedBonus(trx, cfg, userId)) + fx.divePower;
    const sRow = await trx.selectFrom('silos').select('seed').where('user_id', '=', userId).executeTakeFirstOrThrow();
    const profile = geologyProfile(cfg, { lat: p.silo_lat!, lon: p.silo_lon! }, Number(sRow.seed));
    const out = resolveDive(cfg, route, stats, arch.dive_ore_multiplier * fx.diveOre, Number(d.seed), { remaining: pool.remaining, total: pool.total }, bonus, fx.samples, profile);
    await wearEquipped(trx, userId);

    await applyLedger(
      trx,
      userId,
      [
        { resource: 'ore', delta: out.ore, reason: 'dive_reward', ref: `dive:${d.id}` },
        { resource: 'tokens', delta: out.tokens, reason: 'dive_reward', ref: `dive:${d.id}:tokens` },
        { resource: 'samples', delta: out.samples, reason: 'dive_reward', ref: `dive:${d.id}:samples` },
        ...Object.entries(out.materials).map(([m, n]) => ({ resource: m, delta: n, reason: 'dive_reward' as const, ref: `dive:${d.id}:mat:${m}` })),
      ],
      cfg.version,
    );
    oreTotal += out.ore;
    if (out.poolDraw > 0) await trx.updateTable('world_pools').set({ remaining: pool.remaining - out.poolDraw }).where('zone', '=', pool.zone).where('resource', '=', pool.resource).execute();
    const lv = addXp(cfg, p.level, Number(p.xp), out.xp);
    await trx.updateTable('players').set({ level: lv.level, xp: String(lv.xpInLevel), free_points: p.free_points + lv.points }).where('user_id', '=', userId).execute();
    if (!out.success) await trx.updateTable('silos').set({ winded_until: new Date(d.ends_at.getTime() + cfg.dives.winded_seconds * fx.winded * 1000) }).where('user_id', '=', userId).execute();
    const result = { success: out.success, chancePct: Math.round(out.chance * 100), ore: out.ore, tokens: out.tokens, samples: out.samples, materials: out.materials, xp: out.xp, level: lv.level, levelUp: lv.level > p.level };
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

/** Pojemność kolejki zjazdów: 2 bez abonamentu, 3 z abonamentem. */
export function queueSlots(cfg: GameConfig, subscriptionUntil: Date | null, now: Date): number {
  return subscriptionUntil && subscriptionUntil > now ? cfg.dives.queue_slots.subscriber : cfg.dives.queue_slots.free;
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
  const samples = await walletBalance(trx, userId, 'samples');
  const jobRow = await trx.selectFrom('jobs').selectAll().where('user_id', '=', userId).where('state', '=', 'pending').orderBy('ends_at').executeTakeFirst();
  const diveRows = await trx.selectFrom('dives').selectAll().where('user_id', '=', userId).where('state', '=', 'active').orderBy('ends_at').execute();
  const siloRow = await trx.selectFrom('silos').select('winded_until').where('user_id', '=', userId).executeTakeFirstOrThrow();
  const fx = await loadEffects(trx, cfg, userId);
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
    wallet: { ore: st.oreInt, steam: Math.floor(st.state.steam + EPS), tokens, samples, ...Object.fromEntries(await Promise.all(cfg.geology.materials.map(async (m) => [m, await walletBalance(trx, userId, m)]))) },
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
        maxLevel: maxLevelOf(cfg, b.id),
        next: level >= maxLevelOf(cfg, b.id) ? null : { level: next, cost: upgradeCost(cfg, b.id, next, arch.upgrade_cost_multiplier * fx.upgradeCost), seconds: upgradeSeconds(cfg, next) },
      };
    }),
    queue: diveRows.map((d) => ({ id: String(d.id), routeId: d.route_id, startsAt: d.started_at, endsAt: d.ends_at, running: d.started_at <= st.state.at })),
    queueSlots: queueSlots(cfg, p.subscription_until, st.state.at),
    // sloty ponad queue_slots.free (subskrypcja) przyjmują tylko trasy do tylu sekund
    queueExtraMaxSeconds: cfg.dives.queue_slots.subscriber_extra_max_seconds,
    radio: { level: lv.radiostacja, receiver: lv.radiostacja >= cfg.radio.levels.receiver, transmitter: lv.radiostacja >= cfg.radio.levels.transmitter, on: p.radio_on },
    protectedUntil: p.protected_until && p.protected_until > st.state.at ? p.protected_until : null,
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
  if (level >= maxLevelOf(cfg, type)) throw new GameError(409, 'max_level');
  const toLevel = level + 1;
  const p = await trx.selectFrom('players').select('archetype').where('user_id', '=', userId).executeTakeFirstOrThrow();
  const mult = cfg.archetypes.find((a) => a.id === p.archetype)!.upgrade_cost_multiplier * (await loadEffects(trx, cfg, userId)).upgradeCost;
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
  const pending = await trx.selectFrom('dives').select(['ends_at', 'route_id']).where('user_id', '=', userId).where('state', '=', 'active').orderBy('ends_at').execute();
  const subscriber = !!p.subscription_until && p.subscription_until > now;
  const secondsOf = (id: string) => cfg.dives.routes.find((r) => r.id === id)?.seconds ?? Number.MAX_SAFE_INTEGER;
  const q = queueCheck(cfg.dives.queue_slots, subscriber, pending.map((d) => secondsOf(d.route_id)), route.seconds);
  if (q !== 'ok') throw new GameError(409, q);
  const silo = await trx.selectFrom('silos').select(['steam', 'winded_until']).where('user_id', '=', userId).executeTakeFirstOrThrow();
  if (silo.winded_until && silo.winded_until > now) throw new GameError(409, 'winded');
  const arch = cfg.archetypes.find((a) => a.id === p.archetype)!;
  const cost = steamCost(route, arch.dive_steam_multiplier * (await loadEffects(trx, cfg, userId)).diveSteam);
  if (st.state.steam + EPS < cost) throw new GameError(402, 'insufficient_steam');
  await trx.updateTable('silos').set({ steam: silo.steam - cost }).where('user_id', '=', userId).execute();
  const seed = ctx.seed ? ctx.seed() : randomInt(1, 2 ** 31);
  // zjazd zaczyna się, gdy skończy się poprzedni w kolejce (albo od razu)
  const startsAt = pending.length ? new Date(Math.max(now.getTime(), pending[pending.length - 1]!.ends_at.getTime())) : now;
  const endsAt = new Date(startsAt.getTime() + route.seconds * 1000);
  const d = await trx
    .insertInto('dives')
    .values({ user_id: userId, route_id: route.id, started_at: startsAt, ends_at: endsAt, seed, steam_cost: cost, result: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx.insertInto('events_log').values({ user_id: userId, name: 'dive_started', props: JSON.stringify({ routeId: route.id, steam: cost }) }).execute();
  return { diveId: String(d.id), routeId: route.id, steamCost: cost, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), queuePosition: pending.length + 1 };
}

export async function listRoutes(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  await ctx.db.transaction().execute((trx) => settle(trx, cfg, userId, ctx.now()));
  const p = await ctx.db.selectFrom('players').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  if (!p.archetype) throw new GameError(409, 'no_player');
  const arch = cfg.archetypes.find((a) => a.id === p.archetype)!;
  const stats: Stats = { sila: p.sila!, technika: p.technika!, percepcja: p.percepcja!, wytrwalosc: p.wytrwalosc! };
  const pools = await ctx.db.selectFrom('world_pools').selectAll().execute();
  const fx = await loadEffects(ctx.db, cfg, userId);
  const bonus = (await equippedBonus(ctx.db, cfg, userId)) + fx.divePower;
  return cfg.dives.routes.map((r) => {
    const pool = pools.find((x) => x.zone === r.zone);
    return {
      id: r.id,
      name: r.name,
      zone: r.zone,
      minLevel: r.min_level,
      locked: p.level < r.min_level,
      seconds: r.seconds,
      steam: steamCost(r, arch.dive_steam_multiplier * fx.diveSteam),
      chancePct: Math.round(diveChance(stats, r.difficulty, bonus) * 100),
      ore: [Math.round(routeRewards(cfg, r).oreMin * arch.dive_ore_multiplier * fx.diveOre), Math.round(routeRewards(cfg, r).oreMax * arch.dive_ore_multiplier * fx.diveOre)],
      tokens: r.tokens,
      samples: r.samples,
      xp: routeRewards(cfg, r).xp,
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
