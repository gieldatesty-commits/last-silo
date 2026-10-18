import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGameConfig } from '../src/config.js';
import { addXp, diveChance, poolTotal, resolveDive, xpToNext } from '../src/game/dive.js';

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

describe('poziomy', () => {
  it('xp i punkty statystyk', () => {
    expect(xpToNext(c, 1)).toBe(100);
    expect(xpToNext(c, 4)).toBe(800);
    expect(addXp(c, 1, 0, 50)).toEqual({ level: 1, xpInLevel: 50, points: 0 });
    expect(addXp(c, 1, 90, 20)).toEqual({ level: 2, xpInLevel: 10, points: 3 });
    const multi = addXp(c, 1, 0, 100 + 283 + 10); // dwa awanse naraz
    expect(multi.level).toBe(3);
    expect(multi.points).toBe(6);
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
    expect(o.xp).toBe(Math.round(gleboki.xp * c.dives.fail_reward_fraction));
    expect(o.ore).toBeLessThanOrEqual(Math.round(gleboki.ore[1] * c.dives.fail_reward_fraction));
  });
  it('pula: nagroda skalowana zdrowiem, poniżej podłogi pula nie ubywa', () => {
    let seed = 1;
    while (!resolveDive(c, plytki, gornik, 1, seed, fullPool).success) seed++;
    const full = resolveDive(c, plytki, gornik, 1, seed, fullPool);
    const half = resolveDive(c, plytki, gornik, 1, seed, { remaining: 500, total: 1000 });
    expect(Math.abs(half.ore - full.ore / 2)).toBeLessThanOrEqual(1); // zaokrąglenia do całości
    expect(half.poolDraw).toBe(half.ore);
    const dry = resolveDive(c, plytki, gornik, 1, seed, { remaining: 50, total: 1000 }); // 5% < 10% podłogi
    expect(dry.poolHealth).toBe(c.dives.pool_floor_fraction);
    expect(dry.poolDraw).toBe(0);
    expect(dry.ore).toBeGreaterThan(0);
    const edge = resolveDive(c, plytki, gornik, 1, seed, { remaining: 101, total: 1000 }); // 1 nad podłogą
    expect(edge.poolDraw).toBeLessThanOrEqual(1);
  });
  it('skala puli zależy od liczby graczy w configu', () => {
    expect(poolTotal(c, plytki)).toBe(6000 * 50);
  });
});
