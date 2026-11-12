import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { parseGameConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { applyLedger, walletBalance } from '../src/ledger.js';
import { regenPool } from '../src/game/dive.js';
import { maxLevelOf } from '../src/game/formulas.js';
import { itemBonus, tierRepairMult, upgradeTierCost } from '../src/game/upgrade.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test';
const { db, pool } = createDb(url);
const config = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
let clock = new Date('2026-04-01T10:00:00Z');
const app = buildApp({ db, config, jwtSecret: 'test-secret-1234567890', now: () => clock, seed: () => 1 });
const kilof = config.items.recipes.find((r) => r.id === 'kilof')!;

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE; TRUNCATE world_pools');
  clock = new Date('2026-04-01T10:00:00Z');
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

let n = 0;
async function newPlayer() {
  const reg = (await app.inject({ method: 'POST', url: '/auth/guest' })).json();
  const h = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: 'POST', url: '/players', headers: h, payload: { nickname: `Balans${++n}`, archetype: 'gornik' } });
  return { id: reg.userId as string, h };
}
const post = (h: Record<string, string>, path: string, key: string, payload: object = {}) => app.inject({ method: 'POST', url: path, headers: { ...h, 'idempotency-key': key }, payload });
const grant = (id: string, res: Record<string, number>, tag: string) =>
  db.transaction().execute((trx) => applyLedger(trx, id, Object.entries(res).map(([resource, delta]) => ({ resource, delta, reason: 'admin_adjust' as const, ref: `${tag}-${resource}` })), 'test'));
const setLevel = (id: string, type: string, level: number) => pool.query('UPDATE buildings SET level = $3 WHERE user_id = $1 AND type = $2', [id, type, level]);

describe('regeneracja puli', () => {
  it('odnawia ułamek puli na dobę, do pełna', () => {
    const total = 1_000_000;
    const day = 86_400_000;
    const r = config.dives.zones.jadro!.regen_per_day;
    expect(r).toBeGreaterThan(0);
    expect(regenPool(config, 'jadro', 0, total, day)).toBeCloseTo(total * r, 5);
    expect(regenPool(config, 'jadro', total * 0.99, total, 30 * day)).toBe(total);
    expect(regenPool(config, 'jadro', 100, total, -day)).toBe(100);
    expect(regenPool(config, 'nieznana', 100, total, day)).toBe(100);
  });
});

describe('poziomy budynków', () => {
  it('budynki produkcyjne kończą na 8, pozostałe na 10', () => {
    expect(maxLevelOf(config, 'szyb_glowny')).toBe(8);
    expect(maxLevelOf(config, 'generator_pary')).toBe(8);
    expect(maxLevelOf(config, 'magazyn')).toBe(8);
    for (const b of ['warsztat', 'wartownia', 'laboratorium', 'radiostacja']) expect(maxLevelOf(config, b)).toBe(10);
  });
  it('każdy tier jest osiągalny: Warsztat do maksimum, a tiery ponad zakres Warsztatu wymagają badania z drzewa', () => {
    const u = config.items.upgrade;
    const max = maxLevelOf(config, 'warsztat');
    for (let t = 1; t <= u.max_tier; t++) {
      const cost = upgradeTierCost(config, kilof, t);
      expect(cost.workshop).toBeLessThanOrEqual(max);
      if (u.workshop_base + t > max) {
        expect(cost.tech, `tier ${t}`).not.toBeNull();
        expect(config.research.techs.some((x) => x.id === cost.tech)).toBe(true);
      }
    }
  });
});

describe('wzmacnianie przedmiotów', () => {
  it('koszt rośnie geometrycznie, bonus i naprawa liniowo', () => {
    const c1 = upgradeTierCost(config, kilof, 1);
    const c3 = upgradeTierCost(config, kilof, 3);
    expect(c1.ore).toBe(Math.ceil(kilof.ore * config.items.upgrade.ore_fraction));
    expect(c3.ore).toBeGreaterThan(c1.ore * 2);
    expect(c3.materials.miedz).toBe(3 * config.items.upgrade.materials_per_tier.miedz!);
    expect(itemBonus(config, kilof, 1, 5)).toBeCloseTo(kilof.bonus * (1 + 5 * config.items.upgrade.bonus_per_tier), 6);
    expect(tierRepairMult(config, 0)).toBe(1);
    expect(tierRepairMult(config, 4)).toBeGreaterThan(1);
  });

  it('wymaga Warsztatu i Radiostacji, pobiera koszty i podnosi bonus', async () => {
    const { id, h } = await newPlayer();
    await grant(id, { ore: 100_000, tokens: 500, miedz: 200, krysztal: 200, siarka: 200 }, 'g1');
    const crafted = (await post(h, '/items/craft', 'craft-aaaa1111', { recipeId: 'kilof' })).json();
    expect(crafted.tier).toBe(0);
    const base = crafted.bonus as number;
    const cost = upgradeTierCost(config, kilof, 1);

    // za niski Warsztat
    let r = await post(h, `/items/${crafted.id}/upgrade`, 'upg-aaaa0001');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('workshop_too_low');

    // Warsztat ok, Radiostacja za niska
    await setLevel(id, 'warsztat', cost.workshop);
    r = await post(h, `/items/${crafted.id}/upgrade`, 'upg-aaaa0002');
    expect(r.json().error).toBe('radio_too_low');

    await setLevel(id, 'radiostacja', cost.radio);
    const before = await db.transaction().execute((trx) => walletBalance(trx, id, 'ore'));
    r = await post(h, `/items/${crafted.id}/upgrade`, 'upg-aaaa0003');
    expect(r.statusCode).toBe(200);
    expect(r.json().tier).toBe(1);
    expect(r.json().bonus).toBeCloseTo(base * (1 + config.items.upgrade.bonus_per_tier), 1);
    const after = await db.transaction().execute((trx) => walletBalance(trx, id, 'ore'));
    expect(before - after).toBe(cost.ore);

    // idempotentny powtórzony klucz nie pobiera drugi raz
    const again = await post(h, `/items/${crafted.id}/upgrade`, 'upg-aaaa0003');
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(await db.transaction().execute((trx) => walletBalance(trx, id, 'ore'))).toBe(after);
  });

  it('brak środków i limit tieru', async () => {
    const { id, h } = await newPlayer();
    await grant(id, { ore: 200 }, 'g2');
    const crafted = (await post(h, '/items/craft', 'craft-bbbb2222', { recipeId: 'kilof' })).json();
    await setLevel(id, 'warsztat', 10);
    await setLevel(id, 'radiostacja', 5);
    const poor = await post(h, `/items/${crafted.id}/upgrade`, 'upg-bbbb0001');
    expect(poor.statusCode).toBe(402);

    await grant(id, { ore: 5_000_000, tokens: 5000, miedz: 5000, krysztal: 5000, siarka: 5000 }, 'g3');
    for (let t = 1; t <= config.items.upgrade.max_tier; t++) {
      const ok = await post(h, `/items/${crafted.id}/upgrade`, `upg-bbbb01${t}`);
      expect(ok.statusCode).toBe(200);
    }
    const over = await post(h, `/items/${crafted.id}/upgrade`, 'upg-bbbb0999');
    expect(over.json().error).toBe('max_tier');
  });
});
