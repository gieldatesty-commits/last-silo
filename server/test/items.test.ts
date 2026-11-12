import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, auditLedger } from '../src/ledger.js';
import { resolveDive } from '../src/game/dive.js';

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

  it('zepsuty przedmiot nie liczy się do profilu zestawu', async () => {
    const { h, k } = await kit();
    await post(h, `/items/${k.id}/equip`, 'zestaw-br-e1');
    await pool.query('UPDATE items SET durability = 0 WHERE id = $1', [k.id]);
    const r = (await app.inject({ url: '/items', headers: h })).json();
    expect(r.loadoutStats['1']).toEqual({ dive: 0, attack: 0, defense: 0 });
  });
});
