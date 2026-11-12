import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger } from '../src/ledger.js';
import { diveChance, resolveDive } from '../src/game/dive.js';
import { rng } from '../src/game/rng.js';
import { rollRarity } from '../src/game/upgrade.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-04-01T10:00:00Z');
let nextSeed = 1;
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => nextSeed });
const tick = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000));
const kilof = config.items.recipes.find((r) => r.id === 'kilof')!;

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
async function newPlayer() {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Rzemieślnik${++n}`, archetype: 'gornik' } });
  return { id: reg.userId as string, h };
}
const post = (h: Record<string, string>, path: string, key: string, payload: unknown = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload: payload as object });
let g = 0;
const grant = (id: string, ore: number, tokens = 0) =>
  db.transaction().execute((trx) =>
    applyLedger(
      trx,
      id,
      [
        { resource: 'ore', delta: ore, reason: 'admin_adjust', ref: `grant-ore-${++g}` },
        { resource: 'tokens', delta: tokens, reason: 'admin_adjust', ref: `grant-tok-${g}` },
      ],
      'test',
    ),
  );

describe('Warsztat i przedmioty', () => {
  it('lista receptur: zablokowane poziomem Warsztatu', async () => {
    const { h } = await newPlayer();
    const r = (await app.inject({ url: '/items', headers: h })).json();
    expect(r.recipes).toHaveLength(20);
    expect(r.recipes.find((x: { id: string }) => x.id === 'kilof').locked).toBe(false);
    expect(r.recipes.find((x: { id: string }) => x.id === 'wiertlo_udarowe').locked).toBe(true);
    expect(r.recipes.find((x: { id: string }) => x.id === 'lom_bojowy')).toMatchObject({ bonus: 0, attack: 0.6, defense: 0 });
    expect(r.recipes.find((x: { id: string }) => x.id === 'kilof')).toMatchObject({ attack: 0, defense: 0 });
  });

  it('wytworzenie: koszt w dzienniku, jakość w zakresie, idempotencja, brak środków', async () => {
    const { id, h } = await newPlayer();
    const res = await post(h, '/items/craft', 'craft-0001', { recipeId: 'kilof' });
    expect(res.statusCode).toBe(201);
    const it = res.json();
    expect(it.quality).toBeGreaterThanOrEqual(0.85);
    expect(it.quality).toBeLessThanOrEqual(1.05);
    expect(it.durability).toBe(kilof.durability);
    const again = await post(h, '/items/craft', 'craft-0001', { recipeId: 'kilof' });
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json().id).toBe(it.id);
    expect((await app.inject({ url: '/items', headers: h })).json().items).toHaveLength(1);
    expect((await app.inject({ url: '/silo', headers: h })).json().wallet.ore).toBe(config.economy.start_ore - kilof.ore);
    // kolejny kilof nie stać (start 300, kilof 150 -> jeszcze jeden tak, trzeci nie)
    await post(h, '/items/craft', 'craft-0002', { recipeId: 'kilof' });
    const third = await post(h, '/items/craft', 'craft-0003', { recipeId: 'kilof' });
    expect(third.statusCode).toBe(402);
    expect(await auditLedger(db)).toEqual([]);
    expect(id).toBeTruthy();
  });

  it('wymaga poziomu Warsztatu', async () => {
    const { id, h } = await newPlayer();
    await grant(id, 5000, 50);
    const res = await post(h, '/items/craft', 'craft-w-01', { recipeId: 'wiertlo_udarowe' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('workshop_too_low');
  });

  it('zakładanie: jeden przedmiot na slot, zdjęcie, cudzy przedmiot niedostępny', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await grant(a.id, 2000);
    const k1 = (await post(a.h, '/items/craft', 'eq-craft-01', { recipeId: 'kilof' })).json();
    const k2 = (await post(a.h, '/items/craft', 'eq-craft-02', { recipeId: 'kilof' })).json();
    expect((await post(a.h, `/items/${k1.id}/equip`, 'equip-0001')).json().equipped).toBe(true);
    await post(a.h, `/items/${k2.id}/equip`, 'equip-0002');
    const inv = (await app.inject({ url: '/items', headers: a.h })).json().items;
    expect(inv.filter((i: { equipped: boolean }) => i.equipped)).toHaveLength(1);
    expect(inv.find((i: { id: string }) => i.id === k2.id).equipped).toBe(true);
    expect((await post(a.h, `/items/${k2.id}/unequip`, 'unequip-001')).json().equipped).toBe(false);
    const steal = await post(b.h, `/items/${k1.id}/equip`, 'equip-steal1');
    expect(steal.statusCode).toBe(404);
  });

  it('założony przedmiot podnosi szansę zjazdu i zużywa się; zepsuty nie daje bonusu; naprawa kosztuje', async () => {
    const { id, h } = await newPlayer();
    await grant(id, 3000);
    const base = (await app.inject({ url: '/dives/routes', headers: h })).json()[0].chancePct;
    const k = (await post(h, '/items/craft', 'wear-craft-1', { recipeId: 'kilof' })).json();
    await post(h, `/items/${k.id}/equip`, 'wear-equip-1');
    const boosted = (await app.inject({ url: '/dives/routes', headers: h })).json()[0].chancePct;
    expect(boosted).toBeGreaterThan(base);

    // zjazd rozstrzyga się z bonusem i zużywa przedmiot
    const plytki = config.dives.routes[0]!;
    await post(h, '/dives', 'wear-dive-01', { routeId: 'plytki' });
    tick(plytki.seconds + 1);
    const s = (await app.inject({ url: '/silo', headers: h })).json();
    expect(s.wallet.ore).toBeGreaterThanOrEqual(0);
    const after = (await app.inject({ url: '/items', headers: h })).json().items[0];
    expect(after.durability).toBe(kilof.durability - 1);

    // zepsuj ręcznie: brak bonusu, naprawa pełna
    await pool.query('UPDATE items SET durability = 0 WHERE id = $1', [k.id]);
    const broken = (await app.inject({ url: '/dives/routes', headers: h })).json()[0].chancePct;
    expect(broken).toBe(base);
    const ore0 = (await app.inject({ url: '/silo', headers: h })).json().wallet.ore;
    const rep = await post(h, `/items/${k.id}/repair`, 'repair-0001');
    expect(rep.statusCode).toBe(200);
    expect(rep.json().paid).toBe(Math.ceil(kilof.ore * config.items.repair_cost_fraction));
    expect(rep.json().durability).toBe(kilof.durability);
    const ore1 = (await app.inject({ url: '/silo', headers: h })).json().wallet.ore;
    expect(ore0 - ore1).toBeGreaterThanOrEqual(rep.json().paid);
    expect((await post(h, `/items/${k.id}/repair`, 'repair-0002')).json().error).toBe('nothing_to_repair');
    expect(await auditLedger(db)).toEqual([]);
  });

  it('bonus z przedmiotu zmienia wynik rozstrzygnięcia dla tego samego ziarna', () => {
    const plytki = config.dives.routes[0]!;
    const st = { sila: 5, technika: 3, percepcja: 2, wytrwalosc: 4 };
    const pool0 = { remaining: 1000, total: 1000 };
    const lo = resolveDive(config, plytki, st, 1, 7, pool0, 0).chance;
    const hi = resolveDive(config, plytki, st, 1, 7, pool0, 1.5).chance;
    expect(hi).toBeGreaterThan(lo);
  });

  it('limit ekwipunku', async () => {
    const { id, h } = await newPlayer();
    await grant(id, 100000);
    for (let i = 0; i < config.items.inventory_max; i++) expect((await post(h, '/items/craft', `inv-craft-${i.toString().padStart(3, '0')}`, { recipeId: 'kilof' })).statusCode).toBe(201);
    const over = await post(h, '/items/craft', 'inv-craft-over', { recipeId: 'kilof' });
    expect(over.json().error).toBe('inventory_full');
  });
});

describe('Zestawy', () => {
  type It = { id: string; equipped: boolean; inLoadouts: number[] };
  async function kit() {
    const { id, h } = await newPlayer();
    await grant(id, 5000, 20);
    await pool.query("UPDATE buildings SET level = 2 WHERE user_id = $1 AND type = 'warsztat'", [id]);
    const k = (await post(h, '/items/craft', 'zs-craft-k-1', { recipeId: 'kilof' })).json();
    const lom = (await post(h, '/items/craft', 'zs-craft-l-1', { recipeId: 'lom_bojowy' })).json();
    return { id, h, k, lom };
  }

  it('przedmiot w obu zestawach; zdjęcie z jednego zostawia drugi', async () => {
    const { h, k } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-ld-1');
    await post(h, `/items/${k.id}/equip`, 'zestaw-ld-2', { loadout: 2 });
    let r = (await app.inject({ url: '/items', headers: h })).json();
    expect(r.loadouts['1'].narzedzie).toBe(k.id);
    expect(r.loadouts['2'].narzedzie).toBe(k.id);
    expect(r.items.find((i: It) => i.id === k.id).inLoadouts).toEqual([1, 2]);
    await post(h, `/items/${k.id}/unequip`, 'zestaw-ld-3', { loadout: 2 });
    r = (await app.inject({ url: '/items', headers: h })).json();
    expect(r.loadouts['1'].narzedzie).toBe(k.id);
    expect(r.loadouts['2'].narzedzie).toBeNull();
    expect(r.items.find((i: It) => i.id === k.id).inLoadouts).toEqual([1]);
  });

  it('aktywacja: equipped i loadoutStats idą za aktywnym zestawem; ponowienie idempotentne; already_active', async () => {
    const { h, k, lom } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-ac-e1');
    await post(h, `/items/${lom.id}/equip`, 'zestaw-ac-e2', { loadout: 2 });
    const first = await post(h, '/loadouts/2/activate', 'zestaw-act-1');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ activeLoadout: 2 });
    const again = await post(h, '/loadouts/2/activate', 'zestaw-act-1');
    expect(again.headers['idempotent-replay']).toBe('true');
    const dup = await post(h, '/loadouts/2/activate', 'zestaw-act-2');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('already_active');
    const bad = await post(h, '/loadouts/3/activate', 'zestaw-act-3');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_loadout');
    const r = (await app.inject({ url: '/items', headers: h })).json();
    expect(r.activeLoadout).toBe(2);
    expect(r.items.find((i: It) => i.id === lom.id).equipped).toBe(true);
    expect(r.items.find((i: It) => i.id === k.id).equipped).toBe(false);
    expect(r.items.find((i: It & { attack: number }) => i.id === lom.id).attack).toBeGreaterThan(0);
    expect(r.loadoutStats['2'].attack).toBeGreaterThan(0);
    expect(r.loadoutStats['2'].dive).toBe(0);
    expect(r.loadoutStats['1'].dive).toBeGreaterThan(0);
    expect((await app.inject({ url: '/silo', headers: h })).json().player.activeLoadout).toBe(2);
  });

  const plytkiS = config.dives.routes.find((r) => r.id === 'plytki')!.seconds;
  const durOf = async (itemId: string) => (await pool.query('SELECT durability FROM items WHERE id = $1', [itemId])).rows[0].durability as number;
  const lomRc = config.items.recipes.find((r) => r.id === 'lom_bojowy')!;

  it('zjazd liczy zestaw z chwili dodania; przełączenie potem nic nie zmienia', async () => {
    const { h, k, lom } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-sn-e1');
    await post(h, `/items/${lom.id}/equip`, 'zestaw-sn-e2', { loadout: 2 });
    await post(h, '/loadouts/2/activate', 'zestaw-sn-a1');
    const d = (await post(h, '/dives', 'zestaw-sn-d1', { routeId: 'plytki' })).json();
    expect(d.loadout).toBe(2);
    expect((await app.inject({ url: '/silo', headers: h })).json().queue[0].loadout).toBe(2);
    await post(h, '/loadouts/1/activate', 'zestaw-sn-a2');
    tick(plytkiS + 1);
    await app.inject({ url: '/items', headers: h });
    const row = (await pool.query('SELECT loadout, item_bonus, state FROM dives WHERE id = $1', [d.diveId])).rows[0];
    expect(row).toEqual({ loadout: 2, item_bonus: 0, state: 'resolved' });
    expect(await durOf(k.id)).toBe(kilof.durability);
    expect(await durOf(lom.id)).toBe(lomRc.durability - 1);
  });

  it('dwa zjazdy w kolejce, przełączenie między dodaniami: każdy ze swoim zestawem i zużyciem', async () => {
    const { h, k, lom } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-q-e1');
    await post(h, `/items/${lom.id}/equip`, 'zestaw-q-e2', { loadout: 2 });
    const a = (await post(h, '/dives', 'zestaw-q-d1', { routeId: 'plytki' })).json();
    await post(h, '/loadouts/2/activate', 'zestaw-q-a1');
    const b = (await post(h, '/dives', 'zestaw-q-d2', { routeId: 'plytki' })).json();
    tick(2 * plytkiS + 2);
    await app.inject({ url: '/items', headers: h });
    const rows = (await pool.query('SELECT id::text, loadout, item_bonus FROM dives WHERE id = ANY($1) ORDER BY id', [[a.diveId, b.diveId]])).rows;
    expect(rows[0].loadout).toBe(1);
    expect(rows[0].item_bonus).toBeCloseTo(kilof.bonus * k.quality, 1);
    expect(rows[1]).toMatchObject({ loadout: 2, item_bonus: 0 });
    expect(await durOf(k.id)).toBe(kilof.durability - 1);
    expect(await durOf(lom.id)).toBe(lomRc.durability - 1);
  });

  it('przedmiot zepsuty na zjeździe w kolejce nie daje mocy następnemu (moc = min(zrzut, zestaw teraz))', async () => {
    const { id, h, k } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-br-q-e1');
    await pool.query('UPDATE items SET durability = 1 WHERE id = $1', [k.id]);
    const a = (await post(h, '/dives', 'zestaw-br-q-d1', { routeId: 'plytki' })).json();
    const b = (await post(h, '/dives', 'zestaw-br-q-d2', { routeId: 'plytki' })).json();
    tick(2 * plytkiS + 2);
    await app.inject({ url: '/items', headers: h });
    const p = (await pool.query('SELECT sila, technika, percepcja, wytrwalosc FROM players WHERE user_id = $1', [id])).rows[0];
    const route = config.dives.routes.find((r) => r.id === 'plytki')!;
    const res = async (diveId: string) => (await pool.query('SELECT result FROM dives WHERE id = $1', [diveId])).rows[0].result.chancePct as number;
    expect(await res(a.diveId)).toBe(Math.round(diveChance(p, route.difficulty, kilof.bonus * k.quality) * 100));
    expect(await res(b.diveId)).toBe(Math.round(diveChance(p, route.difficulty, 0) * 100));
    expect(await durOf(k.id)).toBe(0);
  });

  it('zjazd sprzed migracji (item_bonus NULL) rozlicza się z zestawu 1', async () => {
    const { h, k, lom } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-old-e1');
    await post(h, `/items/${lom.id}/equip`, 'zestaw-old-e2', { loadout: 2 });
    await post(h, '/loadouts/2/activate', 'zestaw-old-a1');
    const d = (await post(h, '/dives', 'zestaw-old-d1', { routeId: 'plytki' })).json();
    await pool.query('UPDATE dives SET item_bonus = NULL, loadout = NULL WHERE id = $1', [d.diveId]);
    tick(plytkiS + 1);
    await app.inject({ url: '/items', headers: h });
    expect(await durOf(k.id)).toBe(kilof.durability - 1);
    expect(await durOf(lom.id)).toBe(lomRc.durability);
  });

  it('zdjęcie przedmiotu spoza zestawu: 409 not_equipped', async () => {
    const { h, lom } = await kit();
    await post(h, `/items/${lom.id}/equip`, 'zestaw-ne-e1', { loadout: 2 });
    const r = await post(h, `/items/${lom.id}/unequip`, 'zestaw-ne-u1'); // domyślnie aktywny I, a łom jest tylko w II
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('not_equipped');
  });

  it('siloDefense: obrona silosu dla każdego zestawu jako aktywnego (pełna z niego + passive_defense_share z drugiego)', async () => {
    const { id, h } = await kit();
    const nap = (await post(h, '/items/craft', 'zestaw-sd-c1', { recipeId: 'napiersnik' })).json();
    expect(id).toBeTruthy();
    await post(h, `/items/${nap.id}/equip`, 'zestaw-sd-e1', { loadout: 2 });
    const r = (await app.inject({ url: '/items', headers: h })).json();
    const share = config.items.loadouts.passive_defense_share;
    expect(r.siloDefense['2']).toBeCloseTo(r.loadoutStats['2'].defense, 2);
    expect(r.siloDefense['1']).toBeCloseTo(share * r.loadoutStats['2'].defense, 2);
  });

  it('zepsuty przedmiot nie liczy się do profilu zestawu', async () => {
    const { h, k } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-br-e1');
    await pool.query('UPDATE items SET durability = 0 WHERE id = $1', [k.id]);
    const r = (await app.inject({ url: '/items', headers: h })).json();
    expect(r.loadoutStats['1']).toEqual({ dive: 0, attack: 0, defense: 0 });
  });
});

describe('Rzadkość', () => {
  it('wytworzenie: rzadkość z drugiej liczby strumienia ziarna, jakość z pierwszej, ziarno zapisane', async () => {
    const { id, h } = await newPlayer();
    await grant(id, 500);
    const qr = (await app.inject({ url: '/items', headers: h })).json().quality;
    for (const s of [1, 7, 4242]) {
      nextSeed = s;
      const it = (await post(h, '/items/craft', `rar-craft-${s}`, { recipeId: 'kilof' })).json();
      const r = rng(s);
      expect(it.quality).toBeCloseTo(qr.min + (qr.max - qr.min) * r(), 1);
      expect(it.rarity.id).toBe(rollRarity(config, r()).id);
      expect(it.rarity).toMatchObject({ name: expect.any(String), sockets: expect.any(Number) });
      expect(Number((await pool.query('SELECT seed FROM items WHERE id = $1', [it.id])).rows[0].seed)).toBe(s);
    }
  });

  it('rzadkość mnoży profil przedmiotu i zestawu (zjazd)', async () => {
    const { h } = await newPlayer();
    const k = (await post(h, '/items/craft', 'rar-prof-c1', { recipeId: 'kilof' })).json();
    await post(h, `/items/${k.id}/equip`, 'rar-prof-e1');
    await pool.query("UPDATE items SET rarity = 'zwykly' WHERE id = $1", [k.id]);
    const base = (await app.inject({ url: '/items', headers: h })).json();
    await pool.query("UPDATE items SET rarity = 'unikatowy' WHERE id = $1", [k.id]);
    const up = (await app.inject({ url: '/items', headers: h })).json();
    const b0 = base.items[0].bonus, b1 = up.items[0].bonus;
    expect(b1).toBeCloseTo(b0 * 1.3, 1);
    expect(up.loadoutStats['1'].dive).toBeCloseTo(base.loadoutStats['1'].dive * 1.3, 1);
    expect(up.items[0].rarity).toMatchObject({ id: 'unikatowy', sockets: 3 });
  });

  it('przedmiot sprzed migracji (rarity domyślne, seed NULL): mnożnik 1, 0 gniazd', async () => {
    const { id, h } = await newPlayer();
    await pool.query("INSERT INTO items (user_id, recipe_id, slot, quality, durability, max_durability) VALUES ($1, 'kilof', 'narzedzie', 1, 20, 20)", [id]);
    const it = (await app.inject({ url: '/items', headers: h })).json().items[0];
    expect(it.rarity).toMatchObject({ id: 'zwykly', sockets: 0 });
    expect(it.bonus).toBe(kilof.bonus);
  });
});
