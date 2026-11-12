import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger, walletBalance } from '../src/ledger.js';
import { rng } from '../src/game/rng.js';
import { attackPower, audible, bearingSector, defensePower, inLeague, listenRangeKm, raidWinChance, travelMinutes } from '../src/game/radio.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-04-01T10:00:00Z');
let nextSeed = 1;
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => nextSeed });
const tick = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000));

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE; TRUNCATE world_pools');
  clock = new Date('2026-04-01T10:00:00Z');
  nextSeed = 1;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

let n = 0;
async function newPlayer(opts: { lat?: number; lon?: number; radio?: number; level?: number; stats?: [number, number, number, number]; on?: boolean } = {}) {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Radiowiec${++n}`, archetype: 'gornik' } });
  const id = reg.userId as string;
  const [s, t, p, w] = opts.stats ?? [10, 10, 10, 10];
  await pool.query('UPDATE players SET silo_lat=$2, silo_lon=$3, level=$4, sila=$5, technika=$6, percepcja=$7, wytrwalosc=$8, radio_on=$9 WHERE user_id=$1', [id, opts.lat ?? 0, opts.lon ?? 0, opts.level ?? 10, s, t, p, w, opts.on ?? true]);
  await pool.query("UPDATE buildings SET level=$2 WHERE user_id=$1 AND type='radiostacja'", [id, opts.radio ?? 3]);
  return { id, h };
}
const get = async (h: Record<string, string>, path: string) => (await app.inject({ url: path, headers: h })).json();
const post = (h: Record<string, string>, path: string, key: string, payload: unknown = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload: payload as object });
const silo = (h: Record<string, string>) => get(h, '/silo');
const grant = (id: string, ore: number, tokens = 0) =>
  db.transaction().execute((trx) => applyLedger(trx, id, [{ resource: 'ore', delta: ore, reason: 'admin_adjust', ref: `g-o-${id}-${ore}` }, { resource: 'tokens', delta: tokens, reason: 'admin_adjust', ref: `g-t-${id}-${tokens}-${ore}` }], 't'));
let k = 0;
const key = () => `m3-key-${String(++k).padStart(6, '0')}`;
const setRaidSeed = (win: boolean, chance: number) => {
  for (let s = 1; s < 10000; s++) if ((rng(s)() < chance) === win) return (nextSeed = s);
  throw new Error('brak ziarna');
};

describe('radio – formuły', () => {
  it('zasięg rośnie z poziomem, szyfr go skraca, bez odbiornika nic nie słychać', () => {
    expect(listenRangeKm(config, 1)).toBe(0);
    expect(listenRangeKm(config, 2)).toBe(config.radio.r0_km);
    expect(listenRangeKm(config, 3)).toBeCloseTo(config.radio.r0_km * config.radio.range_growth, 6);
    const km = config.radio.r0_km * 0.8;
    expect(audible(config, 2, 3, km)).toBe(true); // bez szyfru
    expect(audible(config, 2, 4, km)).toBe(false); // szyfr: zasięg × 0,65
    expect(audible(config, 1, 3, 10)).toBe(false);
  });
  it('czas dojazdu w granicach, kierunki świata', () => {
    expect(travelMinutes(config, 100)).toBe(config.radio.travel_min);
    expect(travelMinutes(config, 1e6)).toBe(config.radio.travel_max);
    expect(bearingSector({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBe('N');
    expect(bearingSector({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBe('E');
    expect(bearingSector({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBe('S');
    expect(bearingSector({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBe('W');
  });
  it('szansa najazdu: 50% przy A = D, rośnie z przewagą, ligi ±40%', () => {
    expect(raidWinChance(10, 10)).toBeCloseTo(0.5, 9);
    expect(raidWinChance(20, 10)).toBeGreaterThan(0.85);
    expect(raidWinChance(5, 10)).toBeLessThan(0.15);
    expect(attackPower({ sila: 10, percepcja: 10, wytrwalosc: 0 })).toBe(14);
    expect(defensePower(config, { sila: 0, percepcja: 0, wytrwalosc: 10 }, 4)).toBe(10 + config.effects.watchtower.defense_step * 4);
    expect(inLeague(config, 100, 139)).toBe(true);
    expect(inLeague(config, 100, 141)).toBe(false);
  });
});

describe('radio – nasłuch i kontakt', () => {
  it('izolacja: bez Odbiornika nic nie słychać', async () => {
    const a = await newPlayer({ radio: 1 });
    await newPlayer({ lon: 5 });
    const r = await get(a.h, '/radio');
    expect(r).toMatchObject({ receiver: false, transmitter: false, signals: [] });
  });

  it('Odbiornik słyszy tylko nadających w zasięgu; szyfr i wyłączony nadajnik ich chowają; brak nicków przed kontaktem', async () => {
    const me = await newPlayer({ radio: 2 });
    const near = await newPlayer({ lon: 10, radio: 3 }); // ~1100 km
    await newPlayer({ lon: 160, radio: 3 }); // poza zasięgiem (≫ r0)
    const off = await newPlayer({ lon: 12, radio: 3, on: false });
    const ciph = await newPlayer({ lon: 40, radio: 4 }); // ~4400 km; z szyfrem słyszalny do 3250 km
    const quiet = await newPlayer({ lon: 14, radio: 2 }); // jest Odbiornik, ale nie Nadajnik
    const r = await get(me.h, '/radio');
    expect(r.receiver).toBe(true);
    expect(r.signals.map((s: { id: string }) => s.id)).toEqual([near.id]);
    expect(r.signals[0]).toMatchObject({ sector: 'E', contacted: false, nickname: null, level: null });
    expect(r.signals[0].distanceKm % config.radio.distance_band_km).toBe(0);
    expect(JSON.stringify(r)).not.toContain('Radiowiec');
    expect([off.id, ciph.id, quiet.id].some((id) => r.signals.some((s: { id: string }) => s.id === id))).toBe(false);
  });

  it('namierzenie kosztuje parę raz, ujawnia nick, idempotentne; poza zasięgiem 404', async () => {
    const me = await newPlayer({ radio: 2 });
    const near = await newPlayer({ lon: 10, radio: 3 });
    const far = await newPlayer({ lon: 160, radio: 3 });
    const k1 = key();
    const res = await post(me.h, '/radio/contact', k1, { signalId: near.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: near.id, steamPaid: config.radio.contact_steam });
    expect(res.json().nickname).toMatch(/Radiowiec/);
    expect((await post(me.h, '/radio/contact', k1, { signalId: near.id })).headers['idempotent-replay']).toBe('true');
    const again = await post(me.h, '/radio/contact', key(), { signalId: near.id });
    expect(again.json().steamPaid).toBe(0);
    expect((await silo(me.h)).wallet.steam).toBe(100 - config.radio.contact_steam);
    expect((await post(me.h, '/radio/contact', key(), { signalId: far.id })).statusCode).toBe(404);
    const r = await get(me.h, '/radio');
    expect(r.signals[0]).toMatchObject({ contacted: true, level: 10 });
    expect(r.signals[0].nickname).toMatch(/Radiowiec/);
  });

  it('nadajnik można wyłączyć (cisza radiowa) tylko z Nadajnikiem', async () => {
    const me = await newPlayer({ radio: 2 });
    expect((await app.inject({ method: 'POST', url: '/radio/broadcast', headers: me.h, payload: { on: false } })).json().error).toBe('no_transmitter');
    const tx = await newPlayer({ radio: 3 });
    const res = await app.inject({ method: 'POST', url: '/radio/broadcast', headers: tx.h, payload: { on: false } });
    expect(res.json()).toEqual({ on: false, broadcasting: false });
    expect((await get(tx.h, '/radio')).broadcasting).toBe(false);
  });
});

describe('najazdy', () => {
  async function pair(att: Parameters<typeof newPlayer>[0] = {}, def: Parameters<typeof newPlayer>[0] = {}) {
    const a = await newPlayer({ radio: 2, stats: [30, 10, 10, 10], ...att });
    const d = await newPlayer({ lon: 10, radio: 3, stats: [10, 10, 10, 20], ...def });
    expect((await post(a.h, '/radio/contact', key(), { signalId: d.id })).statusCode).toBe(200);
    return { a, d };
  }
  const chanceOf = async (a: { id: string }, d: { id: string }) => {
    const pa = (await pool.query('SELECT sila, percepcja FROM players WHERE user_id=$1', [a.id])).rows[0];
    const pd = (await pool.query('SELECT wytrwalosc FROM players WHERE user_id=$1', [d.id])).rows[0];
    return raidWinChance(attackPower({ sila: pa.sila, percepcja: pa.percepcja, wytrwalosc: 0 }), defensePower(config, { sila: 0, percepcja: 0, wytrwalosc: pd.wytrwalosc }, 1));
  };

  it('warunki wstępne: poziom, Odbiornik, kontakt, cel nadaje, ochrona nowicjusza, liga', async () => {
    const a = await newPlayer({ radio: 2, level: 3 });
    const d = await newPlayer({ lon: 10, radio: 3 });
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('level_too_low');
    await pool.query('UPDATE players SET level=10 WHERE user_id=$1', [a.id]);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('no_contact');
    await post(a.h, '/radio/contact', key(), { signalId: d.id });
    await pool.query('UPDATE players SET level=2 WHERE user_id=$1', [d.id]);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('target_protected');
    await pool.query('UPDATE players SET level=10, radio_on=false WHERE user_id=$1', [d.id]);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('target_silent');
    await pool.query('UPDATE players SET radio_on=true, sila=100, technika=100 WHERE user_id=$1', [d.id]);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('out_of_league');
    await pool.query("UPDATE buildings SET level=1 WHERE user_id=$1 AND type='radiostacja'", [a.id]);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('no_receiver');
    expect((await post(a.h, '/raids', key(), { targetId: a.id })).json().error).toBe('bad_target');
  });

  it('lista celów: tylko słyszalni nadający, bez ujawniania liczb, z oceną siły', async () => {
    const { a, d } = await pair();
    const t = await get(a.h, '/raids/targets');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: d.id, canRaid: true, sector: 'E' });
    expect(['slabszy', 'rowny', 'silniejszy']).toContain(t[0].strength);
    expect(JSON.stringify(t)).not.toMatch(/sila|wytrwalosc|ore|steam/i);
    await pool.query('UPDATE players SET radio_on=false WHERE user_id=$1', [d.id]);
    expect(await get(a.h, '/raids/targets')).toEqual([]);
  });

  it('wygrana: dojazd, łup z niechronionej części, ochrona obrońcy, zachowanie rudy, audyt', async () => {
    const { a, d } = await pair();
    await grant(d.id, 10000, 500);
    const chance = await chanceOf(a, d);
    setRaidSeed(true, chance);
    const res = await post(a.h, '/raids', key(), { targetId: d.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().travelMinutes).toBe(config.raids ? 2 : 2);
    expect((await silo(a.h)).wallet.steam).toBe(100 - config.radio.contact_steam - config.raids.steam);
    // przed dotarciem nic się nie dzieje
    tick(60);
    expect((await get(d.h, '/raids'))[0].state).toBe('active');
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('raid_in_progress');
    tick(120);
    const oreD0 = (await silo(d.h)).wallet.ore; // rozstrzyga najazd leniwie (strona obrońcy)
    const hist = await get(a.h, '/raids');
    expect(hist[0]).toMatchObject({ role: 'attacker', state: 'resolved' });
    expect(hist[0].result.won).toBe(true);
    const share = Math.min(config.effects.warehouse.protected_max, config.effects.warehouse.protected_step * 1);
    const gross = 10300; // 300 rudy startowej + 10000
    const expectedOre = Math.min(config.raids.loot_cap_ore, Math.floor(config.raids.loot_fraction * Math.floor((oreD0 + hist[0].result.ore) * (1 - share))));
    expect(hist[0].result.ore).toBe(expectedOre);
    expect(hist[0].result.ore).toBeGreaterThan(0);
    expect(hist[0].result.tokens).toBeGreaterThan(0);
    expect(oreD0).toBeLessThan(gross + 10_000); // obrońca stracił
    const dHist = await get(d.h, '/raids');
    expect(dHist[0]).toMatchObject({ role: 'defender' });
    expect(dHist[0].result).toMatchObject({ won: false, ore: -hist[0].result.ore });
    // ochrona obrońcy po przegranej
    const pr = await pool.query('SELECT protected_until FROM players WHERE user_id=$1', [d.id]);
    expect(pr.rows[0].protected_until).not.toBeNull();
    expect((await get(a.h, '/raids/targets'))[0].blockedBy).toBe('target_protected');
    // ruda tylko się przenosi: audyt zgodny, a suma łupu = suma strat
    expect(await auditLedger(db)).toEqual([]);
    const sums = await pool.query("SELECT reason, SUM(delta)::int AS s FROM ledger_entries WHERE reason IN ('raid_loot','raid_loss') AND resource='ore' GROUP BY reason");
    const m = Object.fromEntries(sums.rows.map((r) => [r.reason, r.s]));
    expect(m.raid_loot).toBe(-m.raid_loss);
    // powiadomienie dla obrońcy
    const note = await pool.query("SELECT payload FROM notifications WHERE user_id=$1 AND type='raid_against'", [d.id]);
    expect(note.rows).toHaveLength(1);
  });

  it('przegrana: brak łupu, para stracona, obrońca bez ochrony i z XP', async () => {
    const { a, d } = await pair();
    await grant(d.id, 10000);
    setRaidSeed(false, await chanceOf(a, d));
    await post(a.h, '/raids', key(), { targetId: d.id });
    tick(150);
    const mine = (await silo(a.h)).wallet;
    expect(mine.ore).toBeGreaterThanOrEqual(config.economy.start_ore);
    expect(mine.ore).toBeLessThan(config.economy.start_ore + 10); // tylko produkcja szybu, bez łupu
    expect(mine.steam).toBeLessThan(100 - config.raids.steam); // para wydana, tylko lekka regeneracja
    const h = await get(a.h, '/raids');
    expect(h[0].result).toEqual({ won: false, ore: 0, tokens: 0 });
    const pr = await pool.query('SELECT protected_until, xp FROM players WHERE user_id=$1', [d.id]);
    expect(pr.rows[0].protected_until).toBeNull();
    expect(Number(pr.rows[0].xp)).toBeGreaterThanOrEqual(config.raids.defender_xp_win);
    expect(await auditLedger(db)).toEqual([]);
  });

  // przedmiot wprost w bazie (jakość podana), założony w zestawie `lo`
  const giveItem = async (userId: string, recipeId: string, lo: 1 | 2, quality = 1) => {
    const rc = config.items.recipes.find((r) => r.id === recipeId)!;
    const id = (await pool.query('INSERT INTO items (user_id, recipe_id, slot, quality, durability, max_durability) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id::text', [userId, rc.id, rc.slot, quality, rc.durability])).rows[0].id as string;
    await pool.query('INSERT INTO loadouts (user_id, loadout, slot, item_id) VALUES ($1, $2, $3, $4)', [userId, lo, rc.slot, id]);
    return { id, rc };
  };
  const statsOf = async (a: { id: string }, d: { id: string }) => {
    const pa = (await pool.query('SELECT sila, percepcja FROM players WHERE user_id=$1', [a.id])).rows[0];
    const pd = (await pool.query('SELECT wytrwalosc FROM players WHERE user_id=$1', [d.id])).rows[0];
    return { A: attackPower({ sila: pa.sila, percepcja: pa.percepcja, wytrwalosc: 0 }), D: defensePower(config, { sila: 0, percepcja: 0, wytrwalosc: pd.wytrwalosc }, 1) };
  };
  const lastRaid = async () => (await pool.query('SELECT attack_power, attacker_loadout, state, result FROM raids ORDER BY id DESC LIMIT 1')).rows[0];
  const dur = async (id: string) => (await pool.query('SELECT durability FROM items WHERE id = $1', [id])).rows[0].durability as number;

  it('broń w aktywnym zestawie podnosi szansę; zrzut z chwili wysłania', async () => {
    const { a, d } = await pair();
    const lom = await giveItem(a.id, 'lom_bojowy', 2);
    await pool.query('UPDATE players SET active_loadout = 2 WHERE user_id = $1', [a.id]);
    const { A, D } = await statsOf(a, d);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).statusCode).toBe(201);
    expect(await lastRaid()).toMatchObject({ attack_power: A + lom.rc.attack, attacker_loadout: 2 });
    await post(a.h, '/loadouts/1/activate', key());
    tick(150);
    await silo(d.h);
    const r = await lastRaid();
    expect(r.state).toBe('resolved');
    expect(r.result.chancePct).toBe(Math.round(raidWinChance(A + lom.rc.attack, D) * 100));
    expect(r.result.chancePct).not.toBe(Math.round(raidWinChance(A, D) * 100));
  });

  it('obrona z aktywnego zestawu obrońcy; przełączenie po dotarciu, przed rozliczeniem, nie zmienia wyniku', async () => {
    const { a, d } = await pair();
    const nap = await giveItem(d.id, 'napiersnik', 2, 3);
    await pool.query('UPDATE players SET active_loadout = 2 WHERE user_id = $1', [d.id]);
    const { A, D } = await statsOf(a, d);
    await post(a.h, '/raids', key(), { targetId: d.id });
    tick(150); // dotarł, nikt jeszcze nie rozliczył
    expect((await lastRaid()).state).toBe('active');
    expect((await post(d.h, '/loadouts/1/activate', key())).statusCode).toBe(200);
    const r = await lastRaid();
    expect(r.state).toBe('resolved');
    expect(r.result.chancePct).toBe(Math.round(raidWinChance(A, D + nap.rc.defense * 3) * 100));
    expect(r.result.chancePct).not.toBe(Math.round(raidWinChance(A, D) * 100));
  });

  it('najazd zużywa przedmioty: atakujący zestaw z wysłania, obrońca aktywny', async () => {
    const { a, d } = await pair();
    const lom = await giveItem(a.id, 'lom_bojowy', 2);
    const kil = await giveItem(a.id, 'kilof', 1);
    const nap = await giveItem(d.id, 'napiersnik', 1);
    await pool.query('UPDATE players SET active_loadout = 2 WHERE user_id = $1', [a.id]);
    await post(a.h, '/raids', key(), { targetId: d.id });
    await post(a.h, '/loadouts/1/activate', key());
    tick(150);
    await silo(d.h);
    expect(await dur(lom.id)).toBe(lom.rc.durability - 1);
    expect(await dur(kil.id)).toBe(kil.rc.durability);
    expect(await dur(nap.id)).toBe(nap.rc.durability - 1);
  });

  it('liga uwzględnia profil aktywnego zestawu', async () => {
    const { a, d } = await pair();
    expect((await get(a.h, '/raids/targets'))[0].canRaid).toBe(true);
    await giveItem(d.id, 'plyta_wartownika', 2, 30); // obrona 90: moc ligowa daleko poza ±40%
    expect((await get(a.h, '/raids/targets'))[0].canRaid).toBe(true); // w zestawie 2, a aktywny 1
    await pool.query('UPDATE players SET active_loadout = 2 WHERE user_id = $1', [d.id]);
    expect((await get(a.h, '/raids/targets'))[0].blockedBy).toBe('out_of_league');
  });

  it('najazd sprzed migracji (attack_power NULL) liczy atak ze statystyk', async () => {
    const { a, d } = await pair();
    await giveItem(a.id, 'lom_bojowy', 1);
    const { A, D } = await statsOf(a, d);
    await post(a.h, '/raids', key(), { targetId: d.id });
    await pool.query('UPDATE raids SET attack_power = NULL, attacker_loadout = NULL');
    tick(150);
    await silo(d.h);
    expect((await lastRaid()).result.chancePct).toBe(Math.round(raidWinChance(A, D) * 100));
  });

  it('limit łupu i ochrona Magazynu', async () => {
    const { a, d } = await pair();
    await grant(d.id, 1_000_000);
    await pool.query("UPDATE buildings SET level=6 WHERE user_id=$1 AND type='magazyn'", [d.id]); // chroni 60%
    setRaidSeed(true, await chanceOf(a, d));
    await post(a.h, '/raids', key(), { targetId: d.id });
    tick(150);
    await silo(d.h);
    const h = await get(a.h, '/raids');
    expect(h[0].result.ore).toBe(Math.min(config.raids.loot_cap_ore, Math.floor(config.raids.loot_fraction * Math.floor(1_000_300 * 0.4))));
    expect(h[0].result.ore).toBe(config.raids.loot_cap_ore);
  });

  it('limity: odstęp od tego samego celu, dzienny limit na cel; atakujący traci własną ochronę', async () => {
    const { a, d } = await pair();
    await pool.query("UPDATE players SET protected_until=$2 WHERE user_id=$1", [a.id, new Date(clock.getTime() + 3600_000)]);
    const chance = await chanceOf(a, d);
    setRaidSeed(false, chance); // przegrane, by cel nie dostawał ochrony
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).statusCode).toBe(201);
    expect((await pool.query('SELECT protected_until FROM players WHERE user_id=$1', [a.id])).rows[0].protected_until).toBeNull();
    tick(150);
    await silo(a.h);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('target_cooldown');
    for (let i = 0; i < 2; i++) {
      tick(config.raids.same_target_cooldown_minutes * 60 + 1);
      await pool.query("UPDATE silos SET steam=100 WHERE user_id=$1", [a.id]);
      expect((await post(a.h, '/raids', key(), { targetId: d.id })).statusCode).toBe(201);
      tick(150);
      await silo(a.h);
    }
    tick(config.raids.same_target_cooldown_minutes * 60 + 1);
    await pool.query("UPDATE silos SET steam=100 WHERE user_id=$1", [a.id]);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).json().error).toBe('target_daily_limit');
  });

  it('brak pary = 402, nic nie zapisane; idempotentne ponowienie', async () => {
    const { a, d } = await pair();
    const k0 = key();
    await pool.query('UPDATE silos SET steam=5 WHERE user_id=$1', [a.id]);
    expect((await post(a.h, '/raids', k0, { targetId: d.id })).statusCode).toBe(402);
    expect((await pool.query('SELECT count(*)::int AS n FROM raids')).rows[0].n).toBe(0);
    await pool.query('UPDATE silos SET steam=100 WHERE user_id=$1', [a.id]);
    const k1 = key();
    const first = await post(a.h, '/raids', k1, { targetId: d.id });
    const dup = await post(a.h, '/raids', k1, { targetId: d.id });
    expect(dup.headers['idempotent-replay']).toBe('true');
    expect(dup.json().raidId).toBe(first.json().raidId);
    expect((await pool.query('SELECT count(*)::int AS n FROM raids')).rows[0].n).toBe(1);
  });

  it('wzajemne najazdy rozstrzygane równolegle nie zakleszczają się i zachowują rudę', async () => {
    const { a, d } = await pair({ radio: 3 }, { radio: 3 });
    await post(d.h, '/radio/contact', key(), { signalId: a.id });
    await grant(a.id, 5000);
    await grant(d.id, 5000);
    setRaidSeed(true, 0.5);
    expect((await post(a.h, '/raids', key(), { targetId: d.id })).statusCode).toBe(201);
    expect((await post(d.h, '/raids', key(), { targetId: a.id })).statusCode).toBe(201);
    tick(300);
    const [x, y] = await Promise.all([silo(a.h), silo(d.h)]);
    expect(x.wallet.ore + y.wallet.ore).toBeGreaterThan(0);
    const states = await pool.query("SELECT state FROM raids");
    expect(states.rows.every((r) => r.state === 'resolved')).toBe(true);
    expect(await auditLedger(db)).toEqual([]);
    const sums = await pool.query("SELECT SUM(delta)::int AS s FROM ledger_entries WHERE reason IN ('raid_loot','raid_loss')");
    expect(sums.rows[0].s).toBe(0);
    expect(await walletBalance(db as never, a.id, 'ore')).toBeGreaterThan(0);
  });
});

describe('ranking', () => {
  it('wymaga nadawania; lista mocy i łupów; własna pozycja', async () => {
    const a = await newPlayer({ radio: 3, stats: [30, 10, 10, 10] });
    const d = await newPlayer({ lon: 10, radio: 3, stats: [10, 10, 10, 20] });
    const silent = await newPlayer({ lon: 20, radio: 2 });
    expect((await app.inject({ url: '/ranking?type=power', headers: silent.h })).json().error).toBe('not_transmitting');
    const power = await get(a.h, '/ranking?type=power');
    expect(power.total).toBe(2); // milczący nie jest na liście
    expect(power.top[0].rank).toBe(1);
    expect(power.me).not.toBeNull();
    const loot = await get(a.h, '/ranking?type=loot');
    expect(loot.top.every((r: { value: number }) => r.value === 0)).toBe(true);
    expect(d.id).toBeTruthy();
  });
});
