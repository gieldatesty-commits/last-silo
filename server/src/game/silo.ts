import type { BuildingType, GameConfig } from '../config.js';
import { oreCap, orePerHour, steamCap, steamRegen, type Levels } from './formulas.js';

export interface PendingUpgrade {
  id: number;
  type: BuildingType;
  toLevel: number;
  endsAt: Date;
}

export interface SiloState {
  levels: Levels;
  /** ruda w magazynie + ułamek (do kredytu w ledgerze liczymy całości) */
  oreReal: number;
  steam: number;
  depositTotal: number;
  depositRemaining: number;
  at: Date;
}

export interface Production {
  amount: number; // ile rudy wyprodukowano (przed zaokrągleniem)
  newRemaining: number;
}

/**
 * Wydobycie ze złoża w dt godzin, z DOKŁADNĄ całką (wynik nie zależy od tego, jak często wołamy settle).
 * Wydajność = baza * clamp(pozostało/całość, floor, 1).
 * Powyżej podłogi złoże ubywa (rozpad wykładniczy), poniżej – stały "strumyk" floor*baza bez ubywania.
 * `room` – ile jeszcze mieści magazyn.
 */
export function produce(remaining: number, total: number, ratePerHour: number, floor: number, dtHours: number, room: number): Production {
  if (dtHours <= 0 || ratePerHour <= 0 || room <= 0) return { amount: 0, newRemaining: remaining };
  const rf = floor * total;
  let drawn = 0;
  let trickle = 0;
  if (remaining > rf) {
    const k = ratePerHour / total;
    const tStar = Math.log(remaining / rf) / k;
    if (dtHours <= tStar) {
      drawn = remaining - remaining * Math.exp(-k * dtHours);
    } else {
      drawn = remaining - rf;
      trickle = ratePerHour * floor * (dtHours - tStar);
    }
  } else {
    trickle = ratePerHour * floor * dtHours;
  }
  const cappedDrawn = Math.min(drawn, room);
  const cappedTrickle = Math.min(trickle, room - cappedDrawn);
  return { amount: cappedDrawn + cappedTrickle, newRemaining: remaining - cappedDrawn };
}

function advanceTo(s: SiloState, c: GameConfig, to: Date): SiloState {
  const dtMs = to.getTime() - s.at.getTime();
  if (dtMs <= 0) return s;
  const hours = dtMs / 3_600_000;
  const room = Math.max(0, oreCap(c, s.levels.magazyn) - s.oreReal);
  const p = produce(s.depositRemaining, s.depositTotal, orePerHour(c, s.levels.szyb_glowny), c.economy.deposit.floor_fraction, hours, room);
  const cap = steamCap(c, s.levels.generator_pary);
  const steam = Math.min(cap, s.steam + steamRegen(c, s.levels.generator_pary) * (dtMs / 60_000));
  return { ...s, oreReal: s.oreReal + p.amount, depositRemaining: p.newRemaining, steam: Math.max(s.steam, steam), at: to };
}

/**
 * Przesuwa stan silosu do `to`, po drodze stosując ukończone ulepszenia w kolejności czasu.
 * Zwraca stan końcowy i listę ukończonych ulepszeń.
 */
export function advance(s: SiloState, c: GameConfig, to: Date, pending: PendingUpgrade[]): { state: SiloState; done: PendingUpgrade[] } {
  const due = pending.filter((u) => u.endsAt <= to).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || a.id - b.id);
  let cur = s;
  for (const u of due) {
    cur = advanceTo(cur, c, u.endsAt < cur.at ? cur.at : u.endsAt);
    cur = { ...cur, levels: { ...cur.levels, [u.type]: u.toLevel } };
  }
  cur = advanceTo(cur, c, to);
  return { state: cur, done: due };
}
