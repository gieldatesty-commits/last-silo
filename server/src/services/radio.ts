import type { GameConfig } from '../config.js';
import { initialLevels } from '../game/formulas.js';
import { audible, bearingSector, distanceBand, distanceKm, hasCipher, hasReceiver, hasRelays, hasTransmitter, isBroadcasting, listenRangeKm, playerPower } from '../game/radio.js';
import { GameError, settle, type Ctx, type Trx } from './silo.js';
import { InsufficientFunds } from '../ledger.js';

interface Peer {
  id: string;
  nickname: string;
  level: number;
  radio: number;
  on: boolean;
  lat: number;
  lon: number;
  power: number;
}

export async function loadPeers(db: Trx | Ctx['db']): Promise<Peer[]> {
  const players = await db.selectFrom('players').selectAll().where('archetype', 'is not', null).where('silo_lat', 'is not', null).execute();
  const blds = await db.selectFrom('buildings').select(['user_id', 'type', 'level']).execute();
  const by = new Map<string, Record<string, number>>();
  for (const b of blds) {
    const m = by.get(b.user_id) ?? { ...(initialLevels() as Record<string, number>) };
    m[b.type] = b.level;
    by.set(b.user_id, m);
  }
  return players.map((p) => {
    const lv = by.get(p.user_id) ?? (initialLevels() as Record<string, number>);
    return {
      id: p.user_id,
      nickname: p.nickname ?? '',
      level: p.level,
      radio: lv.radiostacja ?? 1,
      on: p.radio_on,
      lat: p.silo_lat!,
      lon: p.silo_lon!,
      power: playerPower({ sila: p.sila!, technika: p.technika!, percepcja: p.percepcja!, wytrwalosc: p.wytrwalosc! }, lv),
    };
  });
}

export async function getRadio(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await settle(trx, cfg, userId, now);
    const peers = await loadPeers(trx);
    const me = peers.find((p) => p.id === userId);
    if (!me) throw new GameError(409, 'no_player');
    const contacts = new Set((await trx.selectFrom('contacts').select('target_id').where('user_id', '=', userId).execute()).map((c) => c.target_id));
    const L = me.radio;
    const signals = hasReceiver(cfg, L)
      ? peers
          .filter((p) => p.id !== userId && isBroadcasting(cfg, p.radio, p.on))
          .map((p) => ({ p, km: distanceKm({ lat: me.lat, lon: me.lon }, { lat: p.lat, lon: p.lon }, cfg.world.radius_km) }))
          .filter(({ p, km }) => audible(cfg, L, p.radio, km))
          .map(({ p, km }) => ({
            id: p.id,
            sector: bearingSector({ lat: me.lat, lon: me.lon }, { lat: p.lat, lon: p.lon }),
            distanceKm: distanceBand(cfg, km),
            contacted: contacts.has(p.id),
            nickname: contacts.has(p.id) ? p.nickname : null,
            level: contacts.has(p.id) ? p.level : null,
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)
      : [];
    return {
      level: L,
      receiver: hasReceiver(cfg, L),
      transmitter: hasTransmitter(cfg, L),
      cipher: hasCipher(cfg, L),
      relays: hasRelays(cfg, L),
      on: me.on,
      broadcasting: isBroadcasting(cfg, L, me.on),
      rangeKm: Math.round(listenRangeKm(cfg, L)),
      contactSteam: cfg.radio.contact_steam,
      signals,
    };
  });
}

/** Namierzenie: koszt pary, po którym znamy nick i poziom nadającego silosu (kontakt trwały). */
export async function contactTx(trx: Trx, ctx: Ctx, userId: string, targetId: string) {
  const cfg = ctx.config;
  const st = await settle(trx, cfg, userId, ctx.now());
  const peers = await loadPeers(trx);
  const me = peers.find((p) => p.id === userId);
  const t = peers.find((p) => p.id === targetId);
  if (!me) throw new GameError(409, 'no_player');
  if (!hasReceiver(cfg, me.radio)) throw new GameError(409, 'no_receiver');
  if (!t || t.id === userId) throw new GameError(404, 'no_signal');
  const km = distanceKm({ lat: me.lat, lon: me.lon }, { lat: t.lat, lon: t.lon }, cfg.world.radius_km);
  if (!isBroadcasting(cfg, t.radio, t.on) || !audible(cfg, me.radio, t.radio, km)) throw new GameError(404, 'no_signal');
  const known = await trx.selectFrom('contacts').select('target_id').where('user_id', '=', userId).where('target_id', '=', targetId).executeTakeFirst();
  let paid = 0;
  if (!known) {
    const silo = await trx.selectFrom('silos').select('steam').where('user_id', '=', userId).executeTakeFirstOrThrow();
    if (st.state.steam + 1e-9 < cfg.radio.contact_steam) throw new GameError(402, 'insufficient_steam');
    await trx.updateTable('silos').set({ steam: silo.steam - cfg.radio.contact_steam }).where('user_id', '=', userId).execute();
    await trx.insertInto('contacts').values({ user_id: userId, target_id: targetId }).execute();
    await trx.insertInto('events_log').values({ user_id: userId, name: 'contact_made', props: JSON.stringify({ targetId }) }).execute();
    paid = cfg.radio.contact_steam;
  }
  return { id: t.id, nickname: t.nickname, level: t.level, sector: bearingSector({ lat: me.lat, lon: me.lon }, { lat: t.lat, lon: t.lon }), distanceKm: distanceBand(cfg, km), steamPaid: paid };
}

export async function setBroadcast(ctx: Ctx, userId: string, on: boolean) {
  const cfg = ctx.config;
  return ctx.db.transaction().execute(async (trx) => {
    await settle(trx, cfg, userId, ctx.now());
    const peers = await loadPeers(trx);
    const me = peers.find((p) => p.id === userId);
    if (!me) throw new GameError(409, 'no_player');
    if (!hasTransmitter(cfg, me.radio)) throw new GameError(409, 'no_transmitter');
    await trx.updateTable('players').set({ radio_on: on }).where('user_id', '=', userId).execute();
    return { on, broadcasting: on };
  });
}

/** Ranking widoczny dla nadających (Nadajnik): moc i łupy z najazdów z ostatnich 7 dni. */
export async function ranking(ctx: Ctx, userId: string, type: 'power' | 'loot') {
  const cfg = ctx.config;
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await settle(trx, cfg, userId, now);
    const peers = await loadPeers(trx);
    const me = peers.find((p) => p.id === userId);
    if (!me) throw new GameError(409, 'no_player');
    if (!isBroadcasting(cfg, me.radio, me.on)) throw new GameError(409, 'not_transmitting');
    const pool = peers.filter((p) => isBroadcasting(cfg, p.radio, p.on));
    let rows: { id: string; nickname: string; level: number; value: number }[];
    if (type === 'power') {
      rows = pool.map((p) => ({ id: p.id, nickname: p.nickname, level: p.level, value: Math.round(p.power) }));
    } else {
      const since = new Date(now.getTime() - 7 * 86_400_000);
      const raids = await trx.selectFrom('raids').select(['attacker_id', 'result']).where('state', '=', 'resolved').where('ends_at', '>', since).execute();
      const loot = new Map<string, number>();
      for (const r of raids) {
        const res = r.result as { win: boolean; ore: number } | null;
        if (res?.win) loot.set(r.attacker_id, (loot.get(r.attacker_id) ?? 0) + res.ore);
      }
      rows = pool.map((p) => ({ id: p.id, nickname: p.nickname, level: p.level, value: loot.get(p.id) ?? 0 }));
    }
    rows.sort((a, b) => b.value - a.value || a.nickname.localeCompare(b.nickname));
    const ranked = rows.map((r, i) => ({ rank: i + 1, nickname: r.nickname, level: r.level, value: r.value, me: r.id === userId }));
    return { type, top: ranked.slice(0, 20), me: ranked.find((r) => r.me) ?? null, total: ranked.length };
  });
}

export { InsufficientFunds };
