import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGameConfig } from '../src/config.js';
import { addXp, diveChance, efficiency, poolTotal, resolveDive, routeRewards, xpToNext } from '../src/game/dive.js';

const c = parseGameConfig(readFileSync('../config/game.yaml', 'utf8'));
const gornik = { sila: 5, technika: 3, percepcja: 2, wytrwalosc: 4 };
const plytki = c.dives.routes.find((r) => r.id === 'plytki')!;
const gleboki = c.dives.routes.find((r) => r.id === 'gleboki')!;
const fullPool = { remaining: 1000, total: 1000 };

describe('szansa zjazdu', () => {
  it('zgodna ze wzorem ze specu i ograniczona do 10–90%', () => {
    expect(diveChance(gornik, plytki.difficulty)).toBeCloseTo(0.5 + (2.9 - 2.5) / 5, 6);
    expect(diveChance(gornik, 1000)).toBe(0.1);
    expect(diveChance({ sila: 0, technika: 100, percepcja: 100, wytrwalosc: 100 }, 5)).toBe(0.9);
  });
  it('częstość sukcesów ≈ szansa', () => {
    let ok = 0;
    for (let s = 1; s <= 4000; s++) if (resolveDive(c, plytki, gornik, 1, s, fullPool).success) ok++;
    expect(ok / 4000).toBeGreaterThan(0.55);
    expect(ok / 4000).toBeLessThan(0.61);
  });
});

describe('opłacalność tras', () => {
  const byLen = [...c.dives.routes].sort((a, b) => a.seconds - b.seconds);
  it('krótkie zjazdy płacą 15–20% więcej za godzinę niż najdłuższy', () => {
    const shortest = routeRewards(c, byLen[0]!).orePerHour;
    const longest = routeRewards(c, byLen[byLen.length - 1]!).orePerHour;
    expect(shortest / longest).toBeGreaterThanOrEqual(1.15);
    expect(shortest / longest).toBeLessThanOrEqual(1.2001);
    expect(efficiency(c, 3)).toBeCloseTo(1.2, 6);
    expect(efficiency(c, 480)).toBeCloseTo(1.0, 6);
  });
  it('opłacalność za godzinę maleje wraz z długością trasy', () => {
    for (let i = 1; i < byLen.length; i++) expect(routeRewards(c, byLen[i]!).orePerHour).toBeLessThan(routeRewards(c, byLen[i - 1]!).orePerHour);
  });
  it('długa trasa wypłaca w całości więcej niż krótka', () => {
    for (let i = 1; i < byLen.length; i++) expect(routeRewards(c, byLen[i]!).oreAvg).toBeGreaterThan(routeRewards(c, byLen[i - 1]!).oreAvg);
  });
  it('koszt pary mieści się w limicie generatora na odpowiednim poziomie', () => {
    const l5cap = c.effects.steam.cap_base + c.effects.steam.cap_step * 4;
    for (const r of byLen) expect(r.steam).toBeLessThanOrEqual(l5cap);
  });
});

describe('poziomy', () => {
  it('xp i punkty statystyk', () => {
    const x1 = xpToNext(c, 1);
    expect(x1).toBe(Math.round(c.progression.xp_base * 1 ** c.progression.xp_exp));
    expect(xpToNext(c, 4)).toBe(Math.round(c.progression.xp_base * 4 ** c.progression.xp_exp));
    expect(addXp(c, 1, 0, x1 - 1)).toEqual({ level: 1, xpInLevel: x1 - 1, points: 0 });
    expect(addXp(c, 1, x1 - 2, 5)).toEqual({ level: 2, xpInLevel: 3, points: 3 });
    const multi = addXp(c, 1, 0, x1 + xpToNext(c, 2) + 10); // dwa awanse naraz
    expect(multi).toEqual({ level: 3, xpInLevel: 10, points: 6 });
  });
  it('limit poziomu', () => {
    expect(addXp(c, 30, 0, 1e9)).toEqual({ level: 30, xpInLevel: 0, points: 0 });
  });
});

describe('rozstrzygnięcie', () => {
  it('deterministyczne dla ziarna', () => {
    expect(resolveDive(c, gleboki, gornik, 1.1, 777, fullPool)).toEqual(resolveDive(c, gleboki, gornik, 1.1, 777, fullPool));
  });
  it('porażka daje ułamek nagrody i brak żetonów', () => {
    let seed = 1;
    while (resolveDive(c, gleboki, gornik, 1, seed, fullPool).success) seed++;
    const o = resolveDive(c, gleboki, gornik, 1, seed, fullPool);
    expect(o.tokens).toBe(0);
    expect(o.xp).toBe(Math.round(routeRewards(c, gleboki).xp * c.dives.fail_reward_fraction));
    expect(o.ore).toBeLessThanOrEqual(Math.round(routeRewards(c, gleboki).oreMax * c.dives.fail_reward_fraction));
  });
  it('pula: nagroda skalowana zdrowiem, poniżej podłogi pula nie ubywa', () => {
    const route = gleboki; // większa nagroda, żeby zaokrąglenia nie zjadały testu
    let seed = 1;
    while (!resolveDive(c, route, gornik, 1, seed, fullPool).success) seed++;
    const full = resolveDive(c, route, gornik, 1, seed, fullPool);
    const half = resolveDive(c, route, gornik, 1, seed, { remaining: 500, total: 1000 });
    expect(Math.abs(half.ore - full.ore / 2)).toBeLessThanOrEqual(1); // zaokrąglenia do całości
    expect(half.poolDraw).toBe(half.ore);
    const dry = resolveDive(c, route, gornik, 1, seed, { remaining: 50, total: 1000 }); // 5% < 10% podłogi
    expect(dry.poolHealth).toBe(c.dives.pool_floor_fraction);
    expect(dry.poolDraw).toBe(0);
    expect(dry.ore).toBeGreaterThan(0);
    const edge = resolveDive(c, route, gornik, 1, seed, { remaining: 101, total: 1000 }); // 1 nad podłogą
    expect(edge.poolDraw).toBeLessThanOrEqual(1);
  });
  it('wielkość puli rośnie z liczbą graczy', () => {
    expect(poolTotal(c, plytki.zone, 50)).toBe(c.dives.zones[plytki.zone]!.pool_per_player * 50);
  });
});
