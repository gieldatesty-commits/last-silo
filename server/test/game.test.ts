import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGameConfig } from '../src/config.js';
import { orePerHour, oreCap, steamCap, upgradeCost, upgradeSeconds, initialLevels } from '../src/game/formulas.js';
import { advance, produce, type SiloState } from '../src/game/silo.js';
import { distanceKm, placeSilo, rollLocalDeposit } from '../src/game/world.js';
import { rng } from '../src/game/rng.js';
import { allRuneIds, parseRune, rollRuneDrop, runeCraftCost, runesProfile, runesRepairMult, unsocketFee } from '../src/game/runes.js';
import { resolveDive } from '../src/game/dive.js';
import { setBonuses, setProgress } from '../src/game/sets.js';
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
    expect(c.version).toBe('1.9.0');
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
  it('próg „wysokich” tierów wynika z configu (pierwszy high_tiers.from), nie ze stałej w kodzie', () => {
    const w = c.items.recipes.find((r) => r.id === 'wiertlo_rdzeniowe')!;
    const shifted = { ...c, items: { ...c.items, upgrade: { ...c.items.upgrade, high_tiers: [{ from: 7, tech: 'kuznia_glebi' }] } } };
    const u = c.items.upgrade;
    const t6 = upgradeTierCost(shifted, w, 6);
    expect(t6.ore).toBe(Math.ceil(w.ore * u.ore_fraction * u.growth ** 5)); // tier 6 jeszcze na zwykłej krzywej
    expect(t6.tech).toBeNull();
    expect(upgradeTierCost(shifted, w, 7).ore).toBe(Math.ceil(t6.ore * u.growth_high));
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

describe('runy (czyste funkcje)', () => {
  it('12 run: 4 rodzaje × 3 poziomy; bonus stały z configu', () => {
    expect(allRuneIds(c)).toHaveLength(12);
    expect(allRuneIds(c)).toContain('runa_trwalosci_3');
    expect(parseRune(c, 'runa_ostrza_2')).toMatchObject({ kind: 'ostrza', level: 2, effect: 'attack', value: 0.6 });
    expect(parseRune(c, 'runa_nieznana_1')).toBeNull();
    expect(parseRune(c, 'runa_zyly_4')).toBeNull();
    const p = runesProfile(c, ['runa_zyly_1', 'runa_zyly_3', 'runa_bastionu_2']);
    expect(p.dive).toBeCloseTo(0.9, 6);
    expect(p.defense).toBeCloseTo(0.6, 6);
    expect(p.attack).toBe(0);
    expect(runesProfile(c, ['runa_trwalosci_3'])).toEqual({ dive: 0, attack: 0, defense: 0 });
  });
  it('Trwałości: zniżka napraw sumuje się do 40%', () => {
    expect(runesRepairMult(c, [])).toBe(1);
    expect(runesRepairMult(c, ['runa_trwalosci_2'])).toBeCloseTo(0.9, 6);
    expect(runesRepairMult(c, ['runa_trwalosci_3', 'runa_trwalosci_3', 'runa_trwalosci_3'])).toBeCloseTo(0.6, 6);
  });
  it('koszt wytwarzania I–II, III tylko z łupu; opłata za wyjęcie', () => {
    expect(runeCraftCost(c, 'runa_zyly_1')).toEqual({ ore: 300, tokens: 0, materials: { miedz: 8 }, workshop: 3, radio: 5 });
    expect(runeCraftCost(c, 'runa_ostrza_2')).toMatchObject({ ore: 1200, tokens: 10, materials: { siarka: 25 }, workshop: 6 });
    expect(runeCraftCost(c, 'runa_trwalosci_2')!.materials).toEqual({ miedz: 9, krysztal: 9, siarka: 9 });
    expect(runeCraftCost(c, 'runa_zyly_3')).toBeNull();
    expect([1, 2, 3].map((l) => unsocketFee(c, `runa_zyly_${l}`))).toEqual([100, 400, 1000]);
  });
  it('łup runy III: deterministyczny, częstość ≈ base × minuty/480 × strefa', () => {
    const route = { seconds: 480 * 60, zone: 'jadro' };
    expect(rollRuneDrop(c, route, 123)).toBe(rollRuneDrop(c, route, 123));
    let n = 0;
    const kinds = new Set<string>();
    for (let s = 1; s <= 20000; s++) {
      const r = rollRuneDrop(c, route, s);
      if (r) { n++; kinds.add(r); expect(r).toMatch(/_3$/); }
    }
    expect(n / 20000).toBeGreaterThan(0.025);
    expect(n / 20000).toBeLessThan(0.035);
    expect(kinds.size).toBe(4);
    expect(rollRuneDrop(c, { seconds: 180, zone: 'gorne' }, 5)).toBeNull();
  });
  it('wektor: wynik zjazdu dla tego samego ziarna bez zmian (runa z osobnego strumienia)', () => {
    const r = c.dives.routes.find((x) => x.id === 'gleboki')!;
    const run = (s: number) => resolveDive(c, r, { sila: 5, technika: 6, percepcja: 4, wytrwalosc: 4 }, 1.1, s, { remaining: 1000, total: 1000 }, 1.5, 1, { miedz: 1, krysztal: 0.5, siarka: 0.2 });
    expect(run(11)).toMatchObject({ success: true, ore: 108, tokens: 8, samples: 1, materials: { siarka: 1 }, xp: 65 });
    expect(run(777)).toMatchObject({ success: false, ore: 26, tokens: 0, samples: 0, materials: {}, xp: 20 });
    expect(run(4242)).toMatchObject({ success: true, ore: 98, tokens: 10, samples: 1, materials: {}, xp: 65 });
  });
});

describe('komplety (czyste funkcje)', () => {
  const sztygar = ['mlot_pneumatyczny', 'helm_wzmocniony', 'lampa_wibracyjna', 'detektor_zylowy'];
  const rdzen = ['wiertlo_rdzeniowe', 'kombinezon_izolowany', 'lampa_rezonansowa', 'skaner_sejsmiczny'];
  it('progi 2 i 4: 1 część nic, 2 = bonus2, 4 = bonus2 + bonus4; duplikat liczy się raz', () => {
    expect(setBonuses(c, ['mlot_pneumatyczny']).total).toEqual({ dive_power: 0, dive_ore_pct: 0, attack: 0, defense: 0, repair_pct: 0 });
    expect(setBonuses(c, sztygar.slice(0, 2)).total.dive_ore_pct).toBe(5);
    expect(setBonuses(c, ['mlot_pneumatyczny', 'mlot_pneumatyczny']).total.dive_ore_pct).toBe(0);
    const full = setBonuses(c, sztygar);
    expect(full.total).toMatchObject({ dive_ore_pct: 5, dive_power: 0.8 });
    expect(full.active).toEqual([{ id: 'sztygar', name: 'Komplet Sztygara', have: 4, bonus2: true, bonus4: true }]);
    expect(setBonuses(c, rdzen).total).toMatchObject({ dive_ore_pct: 6, dive_power: 1.2, repair_pct: -25 });
    const both = setBonuses(c, [...sztygar.slice(0, 2), 'karabin_pneumatyczny', 'plyta_wartownika']).total;
    expect(both).toMatchObject({ dive_ore_pct: 5, defense: 1.5, attack: 0 });
  });
  it('postęp kompletów w obu zestawach (do GET /items)', () => {
    const p = setProgress(c, { '1': sztygar, '2': sztygar.slice(0, 2) });
    expect(p.find((x) => x.id === 'sztygar')).toMatchObject({ name: 'Komplet Sztygara', pieces: sztygar, have: { '1': 4, '2': 2 }, bonus2: { dive_ore_pct: 5 }, bonus4: { dive_power: 0.8 } });
    expect(p).toHaveLength(3);
  });
  it('walidacja: receptura w dwóch kompletach albo nieznana część → błąd configu', () => {
    const yaml = readFileSync('../config/game.yaml', 'utf8');
    expect(() => parseGameConfig(yaml.replace('pieces: [karabin_pneumatyczny,', 'pieces: [mlot_pneumatyczny,'))).toThrow();
    expect(() => parseGameConfig(yaml.replace('pieces: [karabin_pneumatyczny,', 'pieces: [nie_ma_takiej,'))).toThrow();
    // ten sam id kompletu dwa razy
    expect(() => parseGameConfig(yaml.replace('- { id: rdzen,     name: Komplet Rdzenia,', '- { id: sztygar,   name: Komplet Rdzenia,'))).toThrow();
    // dwie części z tego samego slotu (4 części nie dałoby się założyć naraz)
    expect(() => parseGameConfig(yaml.replace('pieces: [mlot_pneumatyczny, helm_wzmocniony, lampa_wibracyjna, detektor_zylowy]', 'pieces: [mlot_pneumatyczny, kilof, lampa_wibracyjna, detektor_zylowy]'))).toThrow();
    // zakresy: naprawy tylko zniżka (≤ 0, > −100), ruda > −100, atak/obrona/moc ≥ 0
    expect(() => parseGameConfig(yaml.replace('bonus4: { repair_pct: -25,', 'bonus4: { repair_pct: 10,'))).toThrow();
    expect(() => parseGameConfig(yaml.replace('bonus4: { repair_pct: -25,', 'bonus4: { repair_pct: -100,'))).toThrow();
    expect(() => parseGameConfig(yaml.replace('bonus2: { dive_ore_pct: 5 }', 'bonus2: { dive_ore_pct: -100 }'))).toThrow();
    expect(() => parseGameConfig(yaml.replace('bonus2: { defense: 1.5 }', 'bonus2: { defense: -1 }'))).toThrow();
  });
});
