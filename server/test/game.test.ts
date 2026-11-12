import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGameConfig } from '../src/config.js';
import { orePerHour, oreCap, steamCap, upgradeCost, upgradeSeconds, initialLevels } from '../src/game/formulas.js';
import { advance, produce, type SiloState } from '../src/game/silo.js';
import { distanceKm, placeSilo, rollLocalDeposit } from '../src/game/world.js';
import { rng } from '../src/game/rng.js';
import { addProfiles, itemBonus, itemProfile, rarityOf, rollRarity, upgradeTierCost, ZERO_PROFILE } from '../src/game/upgrade.js';

const c = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const t0 = new Date('2026-01-01T00:00:00Z');
const at = (h: number) => new Date(t0.getTime() + h * 3_600_000);

const fresh = (): SiloState => ({
  levels: initialLevels(),
  oreReal: 0,
  steam: 0,
  depositTotal: 15000,
  depositRemaining: 15000,
  at: t0,
});

describe('formuły', () => {
  it('produkcja, magazyn, para wg specu', () => {
    expect(orePerHour(c, 1)).toBe(40);
    expect(orePerHour(c, 3)).toBeCloseTo(40 * 1.3 ** 2);
    expect(oreCap(c, 1)).toBe(1000);
    expect(oreCap(c, 3)).toBe(2250);
    expect(steamCap(c, 4)).toBe(175);
  });
  it('koszt i czas ulepszenia', () => {
    expect(upgradeCost(c, 'szyb_glowny', 2)).toBe(Math.ceil(50 * 1.6));
    expect(upgradeCost(c, 'szyb_glowny', 2, 0.9)).toBe(Math.ceil(50 * 1.6 * 0.9));
    expect(upgradeSeconds(c, 2)).toBe(180);
    expect(upgradeSeconds(c, 8)).toBe(180 * 64);
  });
});

describe('produkcja ze złoża', () => {
  it('na początku ~ pełna wydajność', () => {
    const p = produce(15000, 15000, 40, 0.15, 1, 1000);
    expect(p.amount).toBeGreaterThan(39.9);
    expect(p.amount).toBeLessThanOrEqual(40);
  });
  it('wynik nie zależy od częstotliwości rozliczeń', () => {
    const once = advance(fresh(), c, at(48), []).state;
    let s = fresh();
    for (let i = 1; i <= 48 * 6; i++) s = advance(s, c, at(i / 6), []).state;
    // magazyn L1 = 1000, więc porównujemy też z dużym magazynem w drugim teście
    expect(s.oreReal).toBeCloseTo(once.oreReal, 6);
    expect(s.depositRemaining).toBeCloseTo(once.depositRemaining, 6);
  });
  it('całka jest dokładna także bez limitu magazynu', () => {
    const big = { ...fresh(), levels: { ...initialLevels(), magazyn: 8 } };
    const once = advance(big, c, at(200), []).state;
    let s = big;
    for (let i = 1; i <= 200; i++) s = advance(s, c, at(i), []).state;
    expect(s.oreReal).toBeCloseTo(once.oreReal, 6);
  });
  it('magazyn ogranicza ilość rudy', () => {
    const s = advance(fresh(), c, at(1000), []).state;
    expect(s.oreReal).toBeLessThanOrEqual(1000);
    expect(s.oreReal).toBeCloseTo(1000, 3);
  });
  it('złoże maleje, ale podłoga 15% daje strumyk', () => {
    const big = { ...fresh(), depositTotal: 1000, depositRemaining: 1000, levels: { ...initialLevels(), magazyn: 8 } };
    const s = advance(big, c, at(2000), []).state;
    expect(s.depositRemaining).toBeCloseTo(150, 3); // dno = 15% całości
    const more = advance(s, c, at(2010), []).state;
    expect(more.depositRemaining).toBeCloseTo(150, 3);
    expect(more.oreReal - s.oreReal).toBeCloseTo(40 * 0.15 * 10, 3);
  });
  it('ulepszenie w trakcie okresu zmienia tempo od momentu ukończenia', () => {
    const up = [{ id: 1, type: 'szyb_glowny' as const, toLevel: 2, endsAt: at(1) }];
    const s = advance({ ...fresh(), levels: { ...initialLevels(), magazyn: 8 } }, c, at(2), up);
    expect(s.done).toHaveLength(1);
    expect(s.state.levels.szyb_glowny).toBe(2);
    // ok. 40 w 1. godzinie i ok. 52 w 2. (mniej o ubytek złoża)
    expect(s.state.oreReal).toBeGreaterThan(88);
    expect(s.state.oreReal).toBeLessThan(92);
  });
  it('para regeneruje się do limitu', () => {
    const s = advance(fresh(), c, at(10), []).state;
    expect(s.steam).toBe(100);
    const half = advance(fresh(), c, new Date(t0.getTime() + 30 * 60_000), []).state;
    expect(half.steam).toBeCloseTo(30, 6);
  });
});

describe('świat', () => {
  it('losowanie złoża w zadanym przedziale i deterministyczne dla ziarna', () => {
    for (let seed = 1; seed < 50; seed++) {
      const d = rollLocalDeposit(c, rng(seed));
      expect(d).toBeGreaterThanOrEqual(15000 * 0.6);
      expect(d).toBeLessThanOrEqual(15000 * 1.4);
      expect(rollLocalDeposit(c, rng(seed))).toBe(d);
    }
  });
  it('silosy rozkładają się z zachowaniem odstępów', () => {
    const r = rng(42);
    const pts: { lat: number; lon: number }[] = [];
    for (let i = 0; i < 40; i++) pts.push(placeSilo(c, pts, r));
    let min = Infinity;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) min = Math.min(min, distanceKm(pts[i]!, pts[j]!, c.world.radius_km));
    expect(min).toBeGreaterThan(c.world.min_silo_distance_km);
  });
  it('haversine: półkole = pi*R', () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, 1000)).toBeCloseTo(Math.PI * 1000, 3);
  });
});

describe('ekwipunek: profil przedmiotu', () => {
  it('profil przedmiotu: zjazd/atak/obrona × jakość × tier', () => {
    const lom = c.items.recipes.find((r) => r.id === 'lom_bojowy')!;
    expect(itemProfile(c, lom, 1, 0)).toEqual({ dive: 0, attack: 0.6, defense: 0 });
    const p = itemProfile(c, lom, 0.9, 2); // 0,6 × 0,9 × 1,2
    expect(p.attack).toBeCloseTo(0.648, 6);
    const kilof = c.items.recipes.find((r) => r.id === 'kilof')!;
    expect(itemProfile(c, kilof, 1, 0)).toEqual({ dive: 0.6, attack: 0, defense: 0 });
    expect(itemBonus(c, kilof, 1, 0)).toBe(0.6);
    const pancerny = c.items.recipes.find((r) => r.id === 'kombinezon_pancerny')!;
    expect(itemProfile(c, pancerny, 1, 0).defense).toBe(0.8);
    expect(addProfiles(ZERO_PROFILE, { dive: 1, attack: 2, defense: 3 })).toEqual({ dive: 1, attack: 2, defense: 3 });
  });
  it('config 1.6.x: 7 receptur bojowych, balistyka odblokowuje karabin i płytę', () => {
    expect(c.version).toBe('1.7.0');
    const ids = ['lom_bojowy', 'nitownica', 'karabin_pneumatyczny', 'napiersnik', 'plyta_wartownika', 'noktowizor', 'celownik'];
    for (const id of ids) expect(c.items.recipes.some((r) => r.id === id)).toBe(true);
    const bal = c.research.techs.find((t) => t.id === 'balistyka')!;
    expect(bal.unlocks).toEqual(['karabin_pneumatyczny', 'plyta_wartownika']);
  });
});

describe('ekwipunek: rzadkość i tiery 6–10', () => {
  it('rzadkość: progi szans z configu, suma 1, nieznana = zwykły', () => {
    expect(c.items.rarity.map((r) => r.id)).toEqual(['zwykly', 'solidny', 'mistrzowski', 'unikatowy']);
    expect(rollRarity(c, 0).id).toBe('zwykly');
    expect(rollRarity(c, 0.6999).id).toBe('zwykly');
    expect(rollRarity(c, 0.7).id).toBe('solidny');
    expect(rollRarity(c, 0.92).id).toBe('mistrzowski');
    expect(rollRarity(c, 0.995).id).toBe('unikatowy');
    expect(rarityOf(c, null)).toMatchObject({ id: 'zwykly', mult: 1, sockets: 0 });
    expect(rarityOf(c, 'nieznana')).toMatchObject({ id: 'zwykly' });
    expect(rarityOf(c, 'unikatowy')).toMatchObject({ mult: 1.3, sockets: 3 });
  });
  it('profil z rzadkością: × mult', () => {
    const kilof = c.items.recipes.find((r) => r.id === 'kilof')!;
    expect(itemProfile(c, kilof, 1, 0, 1.3).dive).toBeCloseTo(0.78, 6);
    expect(itemProfile(c, kilof, 1, 0).dive).toBe(0.6);
  });
  it('koszt tierów 6–10: Warsztat 10, growth_high, badania', () => {
    const w = c.items.recipes.find((r) => r.id === 'wiertlo_rdzeniowe')!;
    const t5 = upgradeTierCost(c, w, 5), t6 = upgradeTierCost(c, w, 6), t10 = upgradeTierCost(c, w, 10);
    expect(upgradeTierCost(c, w, 1)).toMatchObject({ workshop: 6, tech: null });
    expect(t5).toMatchObject({ workshop: 10, tech: null });
    expect(t6).toMatchObject({ workshop: 10, tech: 'kuznia_glebi' });
    expect(upgradeTierCost(c, w, 7).tech).toBe('kuznia_glebi');
    expect(upgradeTierCost(c, w, 8).tech).toBe('kuznia_rdzenia');
    const gh = c.items.upgrade.growth_high;
    expect(t6.ore).toBe(Math.ceil(t5.ore * gh));
    expect(t10.ore).toBe(Math.ceil(t5.ore * gh ** 5));
    expect(t10.tokens).toBe(c.items.upgrade.tokens_per_tier * 10);
    expect(c.items.upgrade.max_tier).toBe(10);
  });
  it('ten sam seed: jakość to nadal pierwsza liczba strumienia, rzadkość druga', () => {
    const r = rng(12345);
    const q = r();
    const u = r();
    expect(q).toBe(rng(12345)());
    expect(['zwykly', 'solidny', 'mistrzowski', 'unikatowy']).toContain(rollRarity(c, u).id);
  });
  it('Kuźnie w drzewie badań', () => {
    const kg = c.research.techs.find((t) => t.id === 'kuznia_glebi')!;
    const kr = c.research.techs.find((t) => t.id === 'kuznia_rdzenia')!;
    expect(kg).toMatchObject({ lab: 8, requires: ['precyzja', 'balistyka'] });
    expect(kr).toMatchObject({ lab: 10, requires: ['kuznia_glebi'] });
  });
});
