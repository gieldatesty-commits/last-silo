import { sql } from 'kysely';
import type { GameConfig } from '../config.js';
import { loadPeers } from './radio.js';
import { settle, type Ctx, type Trx } from './silo.js';

type Reward = GameConfig['season']['rewards'][number];

/** Tytuł i bonus startowy dla miejsca `rank` z `total` (pierwsza pasująca nagroda). */
export function rewardFor(cfg: GameConfig, rank: number, total: number, level: number): Reward | null {
  for (const r of cfg.season.rewards) {
    if (level < r.min_level) continue;
    const byRank = r.max_rank !== undefined && rank <= r.max_rank;
    const byPercent = r.top_percent !== undefined && rank <= Math.max(1, Math.ceil((total * r.top_percent) / 100));
    if (byRank || byPercent) return r;
  }
  return null;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type SeasonAction = 'none' | 'created' | 'closed' | 'started';

/**
 * Kolejny krok cyklu sezonu (idempotentny, serializowany blokadą): utwórz sezon 1 → zamknij po `ends_at`
 * (ranking, tytuły, bonusy) → po przerwie zresetuj świat i zacznij następny. Wołane z timera i przy pierwszym ruchu po terminie.
 */
export async function seasonTick(ctx: Ctx): Promise<{ action: SeasonAction; seasonId: number }> {
  const cfg = ctx.config;
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(7002)`.execute(trx);
    const cur = await trx.selectFrom('seasons').selectAll().orderBy('id', 'desc').limit(1).executeTakeFirst();
    if (!cur) {
      await trx.insertInto('seasons').values({ id: 1, started_at: now, ends_at: new Date(now.getTime() + cfg.season.length_days * DAY) }).execute();
      return { action: 'created' as const, seasonId: 1 };
    }
    if (cur.state === 'active') {
      if (now < cur.ends_at) return { action: 'none' as const, seasonId: cur.id };
      await closeSeason(trx, ctx, cur.id, now);
      return { action: 'closed' as const, seasonId: cur.id };
    }
    const startAt = new Date(cur.ends_at.getTime() + cfg.season.intermission_hours * HOUR);
    if (now < startAt) return { action: 'none' as const, seasonId: cur.id };
    await resetWorld(trx, cur.id);
    await trx.insertInto('seasons').values({ id: cur.id + 1, started_at: now, ends_at: new Date(now.getTime() + cfg.season.length_days * DAY) }).execute();
    return { action: 'started' as const, seasonId: cur.id + 1 };
  });
}

async function closeSeason(trx: Trx, ctx: Ctx, seasonId: number, now: Date) {
  const cfg = ctx.config;
  // rozlicz wszystkich do chwili zamknięcia (zjazdy i najazdy, które się skończyły)
  const ids = (await trx.selectFrom('players').select('user_id').where('archetype', 'is not', null).where('silo_lat', 'is not', null).orderBy('user_id').execute()).map((r) => r.user_id);
  for (const id of ids) await settle(trx, cfg, id, now);

  const peers = await loadPeers(trx);
  const raids = await trx.selectFrom('raids').select(['attacker_id', 'result']).where('state', '=', 'resolved').execute();
  const loot = new Map<string, number>();
  for (const r of raids) {
    const res = r.result as { win: boolean; ore: number } | null;
    if (res?.win) loot.set(r.attacker_id, (loot.get(r.attacker_id) ?? 0) + res.ore);
  }
  const rows = peers
    .map((p) => ({ ...p, power: Math.round(p.power), loot: loot.get(p.id) ?? 0 }))
    .sort((a, b) => b.power - a.power || b.loot - a.loot || a.nickname.localeCompare(b.nickname));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const reward = rewardFor(cfg, i + 1, rows.length, r.level);
    const bonus = Math.min(reward?.start_bonus_ore ?? 0, cfg.season.max_bonus_ore);
    await trx
      .insertInto('season_results')
      .values({ season_id: seasonId, user_id: r.id, nickname: r.nickname, rank: i + 1, players_total: rows.length, power: r.power, level: r.level, loot: String(r.loot), title: reward?.id ?? null, start_bonus_ore: bonus })
      .execute();
    if (bonus > 0) await trx.updateTable('players').set({ carry_bonus_ore: bonus }).where('user_id', '=', r.id).execute();
  }
  await trx.updateTable('seasons').set({ state: 'ended', closed_at: now }).where('id', '=', seasonId).execute();
  await trx.insertInto('events_log').values({ user_id: null, name: 'season_closed', props: JSON.stringify({ seasonId, players: rows.length }) }).execute();
}

/** Reset świata: księga trafia do archiwum, stan gry znika, konta i wyniki zostają. Gracze zakładają postać od nowa. */
async function resetWorld(trx: Trx, seasonId: number) {
  await sql`INSERT INTO ledger_archive SELECT e.*, ${seasonId}::integer FROM ledger_entries e`.execute(trx);
  await sql`TRUNCATE ledger_entries, wallets, dives, jobs, items, research, contacts, raids, silos, buildings, world_pools, shipments, market_listings, market_trades, idempotency_keys, notifications`.execute(trx);
  await sql`UPDATE players SET nickname = NULL, archetype = NULL, sila = NULL, technika = NULL, percepcja = NULL, wytrwalosc = NULL,
    free_points = 0, silo_lat = NULL, silo_lon = NULL, depth = 0, level = 1, xp = 0, config_version = NULL, radio_on = true, protected_until = NULL`.execute(trx);
  await trx.insertInto('events_log').values({ user_id: null, name: 'season_reset', props: JSON.stringify({ seasonId }) }).execute();
}

export async function currentSeason(ctx: Ctx) {
  let s = await ctx.db.selectFrom('seasons').selectAll().orderBy('id', 'desc').limit(1).executeTakeFirst();
  if (!s) {
    await seasonTick(ctx);
    s = await ctx.db.selectFrom('seasons').selectAll().orderBy('id', 'desc').limit(1).executeTakeFirstOrThrow();
  }
  return s;
}

/** Widok sezonu dla gracza: faza, dni, ostatni wynik i zdobyte tytuły. */
export async function seasonView(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  const s = await currentSeason(ctx);
  const ended = s.state === 'ended' || now >= s.ends_at;
  const nextStart = new Date(s.ends_at.getTime() + cfg.season.intermission_hours * HOUR);
  const titles = await ctx.db.selectFrom('season_results').select(['season_id', 'rank', 'players_total', 'title']).where('user_id', '=', userId).where('title', 'is not', null).orderBy('season_id').execute();
  const name = (id: string | null) => cfg.season.rewards.find((r) => r.id === id)?.name ?? null;
  const me = await ctx.db.selectFrom('players').select('carry_bonus_ore').where('user_id', '=', userId).executeTakeFirst();
  return {
    season: s.id,
    phase: ended ? ('intermission' as const) : ('active' as const),
    startedAt: s.started_at,
    endsAt: s.ends_at,
    day: Math.min(cfg.season.length_days, Math.max(1, Math.floor((now.getTime() - s.started_at.getTime()) / DAY) + 1)),
    lengthDays: cfg.season.length_days,
    daysLeft: ended ? 0 : Math.max(0, Math.ceil((s.ends_at.getTime() - now.getTime()) / DAY)),
    nextSeasonAt: ended ? nextStart : null,
    carryBonusOre: me?.carry_bonus_ore ?? 0,
    titles: titles.map((t) => ({ season: t.season_id, rank: t.rank, of: t.players_total, id: t.title, name: name(t.title) })),
  };
}

/** Wyniki ostatnio zamkniętego sezonu: top 10 i wynik gracza. */
export async function seasonResults(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  const last = await ctx.db.selectFrom('seasons').selectAll().where('state', '=', 'ended').orderBy('id', 'desc').limit(1).executeTakeFirst();
  if (!last) return { season: null, top: [], me: null, total: 0 };
  const name = (id: string | null) => cfg.season.rewards.find((r) => r.id === id)?.name ?? null;
  const top = await ctx.db.selectFrom('season_results').selectAll().where('season_id', '=', last.id).orderBy('rank').limit(10).execute();
  const mine = await ctx.db.selectFrom('season_results').selectAll().where('season_id', '=', last.id).where('user_id', '=', userId).executeTakeFirst();
  const row = (r: (typeof top)[number]) => ({ rank: r.rank, nickname: r.nickname, level: r.level, power: r.power, loot: Number(r.loot), title: name(r.title) });
  return { season: last.id, top: top.map(row), me: mine ? { ...row(mine), startBonusOre: mine.start_bonus_ore } : null, total: top[0]?.players_total ?? 0 };
}
