import { randomInt } from 'node:crypto';
import type { Database } from '../db.js';
import type { GameConfig } from '../config.js';
import { applyLedger, walletBalance } from '../ledger.js';
import { protectedShare, initialLevels } from '../game/formulas.js';
import { addXp } from '../game/dive.js';
import { rng } from '../game/rng.js';
import { attackPower, audible, defensePower, distanceKm, inLeague, isBroadcasting, hasReceiver, playerPower, raidWinChance, travelMinutes, distanceBand, bearingSector } from '../game/radio.js';
import { GameError, settle, settleCore, type Ctx, type Trx } from './silo.js';
import { activeLoadout, loadoutProfile, siloDefense, wearLoadout, type LoadoutNo } from './gear.js';
import type { Profile } from '../game/upgrade.js';

type Levels = ReturnType<typeof initialLevels>;
const DAY = 86_400_000;

async function levelsOf(trx: Trx, userId: string): Promise<Levels> {
  const l = initialLevels();
  const rows = await trx.selectFrom('buildings').select(['type', 'level']).where('user_id', '=', userId).execute();
  for (const r of rows) (l as Record<string, number>)[r.type] = r.level;
  return l;
}

async function playerRow(trx: Trx, userId: string) {
  return trx.selectFrom('players').selectAll().where('user_id', '=', userId).executeTakeFirst();
}

const statsOf = (p: { sila: number | null; technika: number | null; percepcja: number | null; wytrwalosc: number | null }) => ({ sila: p.sila ?? 0, technika: p.technika ?? 0, percepcja: p.percepcja ?? 0, wytrwalosc: p.wytrwalosc ?? 0 });

/** Rozstrzyga najazdy, które dotarły do celu (gdzie `userId` jest stroną). Wołane na początku każdego rozliczenia. */
export async function resolveDueRaids(trx: Trx, cfg: GameConfig, userId: string, now: Date): Promise<void> {
  const due = await trx
    .selectFrom('raids')
    .select('id')
    .where('state', '=', 'active')
    .where('ends_at', '<=', now)
    .where((eb) => eb.or([eb('attacker_id', '=', userId), eb('defender_id', '=', userId)]))
    .orderBy('ends_at')
    .orderBy('id')
    .execute();
  for (const d of due) await resolveRaid(trx, cfg, d.id);
}

async function resolveRaid(trx: Trx, cfg: GameConfig, raidId: string): Promise<void> {
  const peek = await trx.selectFrom('raids').selectAll().where('id', '=', raidId).where('state', '=', 'active').executeTakeFirst();
  if (!peek) return;
  // blokady w stałej kolejności (po id użytkownika) => brak zakleszczeń między stronami
  for (const u of [peek.attacker_id, peek.defender_id].sort()) await trx.selectFrom('silos').select('user_id').where('user_id', '=', u).forUpdate().execute();
  const raid = await trx.selectFrom('raids').selectAll().where('id', '=', raidId).where('state', '=', 'active').forUpdate().executeTakeFirst();
  if (!raid) return;

  // obie strony rozliczone do chwili dotarcia (żeby łup liczył się od faktycznego stanu magazynu)
  await settleCore(trx, cfg, raid.attacker_id, raid.ends_at);
  await settleCore(trx, cfg, raid.defender_id, raid.ends_at);

  const att = (await playerRow(trx, raid.attacker_id))!;
  const def = (await playerRow(trx, raid.defender_id))!;
  const defLv = await levelsOf(trx, raid.defender_id);
  // atak: zrzut z chwili wysłania (najazdy sprzed migracji 016: same statystyki); obrona: aktywny zestaw obrońcy teraz
  const A = raid.attack_power ?? attackPower(statsOf(att));
  const defLoadout = await activeLoadout(trx, raid.defender_id);
  const D = defensePower(cfg, statsOf(def), defLv.wartownia) + (await siloDefense(trx, cfg, raid.defender_id, defLoadout));
  const chance = raidWinChance(A, D);
  const win = rng(Number(raid.seed))() < chance;

  let ore = 0;
  let tokens = 0;
  if (win) {
    const share = protectedShare(cfg, defLv.magazyn);
    const defOre = await walletBalance(trx, raid.defender_id, 'ore');
    const defTok = await walletBalance(trx, raid.defender_id, 'tokens');
    ore = Math.min(cfg.raids.loot_cap_ore, Math.floor(cfg.raids.loot_fraction * Math.floor(defOre * (1 - share))));
    tokens = Math.min(cfg.raids.loot_cap_tokens, Math.floor(cfg.raids.loot_fraction * Math.floor(defTok * (1 - share))));
    await applyLedger(
      trx,
      raid.defender_id,
      [
        { resource: 'ore', delta: -ore, reason: 'raid_loss', ref: `raid:${raid.id}` },
        { resource: 'tokens', delta: -tokens, reason: 'raid_loss', ref: `raid:${raid.id}:tokens` },
      ],
      cfg.version,
    );
    await applyLedger(
      trx,
      raid.attacker_id,
      [
        { resource: 'ore', delta: ore, reason: 'raid_loot', ref: `raid:${raid.id}` },
        { resource: 'tokens', delta: tokens, reason: 'raid_loot', ref: `raid:${raid.id}:tokens` },
      ],
      cfg.version,
    );
    await trx
      .updateTable('players')
      .set({ protected_until: new Date(raid.ends_at.getTime() + cfg.raids.protection_minutes * 60_000) })
      .where('user_id', '=', raid.defender_id)
      .execute();
  }

  const attXp = addXp(cfg, att.level, Number(att.xp), win ? cfg.raids.xp_win : cfg.raids.xp_loss);
  await trx.updateTable('players').set({ level: attXp.level, xp: String(attXp.xpInLevel), free_points: att.free_points + attXp.points }).where('user_id', '=', raid.attacker_id).execute();
  if (!win) {
    const defXp = addXp(cfg, def.level, Number(def.xp), cfg.raids.defender_xp_win);
    await trx.updateTable('players').set({ level: defXp.level, xp: String(defXp.xpInLevel), free_points: def.free_points + defXp.points }).where('user_id', '=', raid.defender_id).execute();
  }

  await wearLoadout(trx, raid.attacker_id, (raid.attacker_loadout === 2 ? 2 : 1) as LoadoutNo);
  await wearLoadout(trx, raid.defender_id, defLoadout);

  const result = { win, chancePct: Math.round(chance * 100), ore, tokens };
  await trx.updateTable('raids').set({ state: 'resolved', result: JSON.stringify(result) }).where('id', '=', raid.id).execute();
  await trx.insertInto('notifications').values({ user_id: raid.attacker_id, type: 'raid_done', payload: JSON.stringify({ raidId: String(raid.id), defender: def.nickname, ...result }), sent_at: null, read_at: null }).execute();
  await trx.insertInto('notifications').values({ user_id: raid.defender_id, type: 'raid_against', payload: JSON.stringify({ raidId: String(raid.id), attacker: att.nickname, win, ore, tokens }), sent_at: null, read_at: null }).execute();
  await trx.insertInto('events_log').values({ user_id: raid.attacker_id, name: 'raid_resolved', props: JSON.stringify({ raidId: String(raid.id), ...result }) }).execute();
}

interface Candidate {
  id: string;
  nickname: string;
  level: number;
  km: number;
  power: number;
  /** profil aktywnego zestawu (do mocy ligowej i ataku przy wysłaniu) */
  profile: Profile;
  loadout: LoadoutNo;
  radioLevel: number;
  broadcasting: boolean;
  protectedUntil: Date | null;
  lat: number;
  lon: number;
}

async function candidateOf(trx: Trx | Ctx['db'], cfg: GameConfig, userId: string): Promise<Omit<Candidate, 'km'> | null> {
  const p = await trx.selectFrom('players').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (!p || !p.archetype || p.silo_lat === null || p.silo_lon === null) return null;
  const lv = initialLevels() as Record<string, number>;
  for (const b of await trx.selectFrom('buildings').select(['type', 'level']).where('user_id', '=', userId).execute()) lv[b.type] = b.level;
  const loadout = await activeLoadout(trx, userId);
  const profile = await loadoutProfile(trx, cfg, userId, loadout);
  return {
    id: userId,
    nickname: p.nickname ?? '',
    level: p.level,
    // moc ligowa uwzględnia siłę bojową aktywnego zestawu (docs/ekwipunek-v1.0.md §2)
    power: playerPower({ sila: p.sila!, technika: p.technika!, percepcja: p.percepcja!, wytrwalosc: p.wytrwalosc! }, lv) + profile.attack + (await siloDefense(trx, cfg, userId, loadout)),
    profile,
    loadout,
    radioLevel: lv.radiostacja!,
    broadcasting: isBroadcasting(cfg, lv.radiostacja!, p.radio_on),
    protectedUntil: p.protected_until,
    lat: p.silo_lat,
    lon: p.silo_lon,
  };
}

/** Powód, dla którego `target` nie może być teraz celem (albo null, jeśli może). */
function targetBlock(cfg: GameConfig, me: Omit<Candidate, 'km'>, t: Candidate, now: Date): string | null {
  if (!t.broadcasting || !audible(cfg, me.radioLevel, t.radioLevel, t.km)) return 'target_silent';
  if (t.level < cfg.raids.beginner_protection_level || (t.protectedUntil && t.protectedUntil > now)) return 'target_protected';
  if (!inLeague(cfg, me.power, t.power)) return 'out_of_league';
  return null;
}

export async function startRaidTx(trx: Trx, ctx: Ctx, userId: string, targetId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  if (userId === targetId) throw new GameError(400, 'bad_target');
  const st = await settle(trx, cfg, userId, now);
  const me = await candidateOf(trx, cfg, userId);
  if (!me) throw new GameError(409, 'no_player');
  if (me.level < cfg.raids.min_level) throw new GameError(409, 'level_too_low');
  if (!hasReceiver(cfg, me.radioLevel)) throw new GameError(409, 'no_receiver');
  const contact = await trx.selectFrom('contacts').select('target_id').where('user_id', '=', userId).where('target_id', '=', targetId).executeTakeFirst();
  if (!contact) throw new GameError(409, 'no_contact');
  const tBase = await candidateOf(trx, cfg, targetId);
  if (!tBase) throw new GameError(404, 'no_target');
  const km = distanceKm({ lat: me.lat, lon: me.lon }, { lat: tBase.lat, lon: tBase.lon }, cfg.world.radius_km);
  const t: Candidate = { ...tBase, km };
  const block = targetBlock(cfg, me, t, now);
  if (block) throw new GameError(409, block);

  const active = await trx.selectFrom('raids').select('id').where('attacker_id', '=', userId).where('state', '=', 'active').executeTakeFirst();
  if (active) throw new GameError(409, 'raid_in_progress');
  const sinceDay = new Date(now.getTime() - DAY);
  const mine = await trx.selectFrom('raids').select(['defender_id', 'started_at']).where('attacker_id', '=', userId).where('started_at', '>', sinceDay).execute();
  if (mine.length >= cfg.raids.attacker_per_day) throw new GameError(409, 'daily_limit');
  const same = mine.filter((r) => r.defender_id === targetId);
  if (same.length >= cfg.raids.same_target_per_day) throw new GameError(409, 'target_daily_limit');
  const cooldown = new Date(now.getTime() - cfg.raids.same_target_cooldown_minutes * 60_000);
  if (same.some((r) => r.started_at > cooldown)) throw new GameError(409, 'target_cooldown');

  const cost = cfg.raids.steam;
  const silo = await trx.selectFrom('silos').select('steam').where('user_id', '=', userId).executeTakeFirstOrThrow();
  if (st.state.steam + 1e-9 < cost) throw new GameError(402, 'insufficient_steam');
  await trx.updateTable('silos').set({ steam: silo.steam - cost }).where('user_id', '=', userId).execute();

  const minutes = travelMinutes(cfg, km);
  const endsAt = new Date(now.getTime() + minutes * 60_000);
  const seed = ctx.seed ? ctx.seed() : randomInt(1, 2 ** 31);
  const raid = await trx
    .insertInto('raids')
    .values({ attacker_id: userId, defender_id: targetId, started_at: now, ends_at: endsAt, seed, steam_cost: cost, result: null, attack_power: attackPower(statsOf((await playerRow(trx, userId))!)) + me.profile.attack, attacker_loadout: me.loadout })
    .returning('id')
    .executeTakeFirstOrThrow();
  // atakujący traci ochronę (nie można napadać spod parasola)
  await trx.updateTable('players').set({ protected_until: null }).where('user_id', '=', userId).execute();
  await trx.insertInto('events_log').values({ user_id: userId, name: 'raid_started', props: JSON.stringify({ raidId: String(raid.id) }) }).execute();
  return { raidId: String(raid.id), targetId, steamCost: cost, travelMinutes: Math.round(minutes * 10) / 10, endsAt: endsAt.toISOString() };
}

export async function afterRaidCommitted(ctx: Ctx, attackerId: string, targetId: string, endsAt: string) {
  const at = new Date(endsAt);
  await ctx.scheduler.schedule(attackerId, at).catch(() => undefined);
  await ctx.scheduler.schedule(targetId, at).catch(() => undefined);
}

/** Lista celów: nadające, słyszalne, znane (kontakt) silosy z ocenianą siłą względną. */
export async function listTargets(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await settle(trx, cfg, userId, now);
    const me = await candidateOf(trx, cfg, userId);
    if (!me) throw new GameError(409, 'no_player');
    const contacts = await trx.selectFrom('contacts').select('target_id').where('user_id', '=', userId).execute();
    const out = [];
    for (const c of contacts) {
      const tb = await candidateOf(trx, cfg, c.target_id);
      if (!tb) continue;
      const km = distanceKm({ lat: me.lat, lon: me.lon }, { lat: tb.lat, lon: tb.lon }, cfg.world.radius_km);
      const t: Candidate = { ...tb, km };
      if (!t.broadcasting || !audible(cfg, me.radioLevel, t.radioLevel, km)) continue; // zamilkł albo poza zasięgiem
      const ratio = t.power / me.power;
      const block = targetBlock(cfg, me, t, now) ?? (me.level < cfg.raids.min_level ? 'level_too_low' : null);
      out.push({
        id: t.id,
        nickname: t.nickname,
        level: t.level,
        sector: bearingSector({ lat: me.lat, lon: me.lon }, { lat: t.lat, lon: t.lon }),
        distanceKm: distanceBand(cfg, km),
        travelMinutes: Math.round(travelMinutes(cfg, km) * 10) / 10,
        strength: ratio < 0.85 ? 'slabszy' : ratio > 1.15 ? 'silniejszy' : 'rowny',
        canRaid: block === null,
        blockedBy: block,
      });
    }
    return out.sort((a, b) => a.distanceKm - b.distanceKm);
  });
}

export async function listRaids(ctx: Ctx, userId: string, limit = 20) {
  const cfg = ctx.config;
  await ctx.db.transaction().execute((trx) => settle(trx, cfg, userId, ctx.now()));
  const rows = await ctx.db
    .selectFrom('raids as r')
    .innerJoin('players as a', 'a.user_id', 'r.attacker_id')
    .innerJoin('players as d', 'd.user_id', 'r.defender_id')
    .select(['r.id', 'r.attacker_id', 'r.defender_id', 'r.started_at', 'r.ends_at', 'r.state', 'r.result', 'a.nickname as an', 'd.nickname as dn'])
    .where((eb) => eb.or([eb('r.attacker_id', '=', userId), eb('r.defender_id', '=', userId)]))
    .orderBy('r.id', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => {
    const mine = r.attacker_id === userId;
    const res = r.result as { win: boolean; ore: number; tokens: number; chancePct: number } | null;
    return {
      id: String(r.id),
      role: mine ? 'attacker' : 'defender',
      opponent: mine ? r.dn : r.an,
      state: r.state,
      endsAt: r.ends_at,
      result: res ? { won: mine ? res.win : !res.win, ore: mine ? res.ore : -res.ore, tokens: mine ? res.tokens : -res.tokens } : null,
    };
  });
}
