/**
 * Symulator ekonomii M1: jeden gracz, tylko Szyb główny i ulepszenia (bez zjazdów, które dojdą w M2).
 * Odpowiada na pytanie: jak szybko wyczerpuje się lokalne złoże i ile rudy dostaje gracz w tygodniu.
 * Użycie: npm run sim [dni] [--deposit=15000] [--check=6]
 */
import { readFileSync } from 'node:fs';
import { BUILDING_TYPES, parseGameConfig, type BuildingType } from '../config.js';
import { initialLevels, upgradeCost, upgradeSeconds } from '../game/formulas.js';
import { advance, type PendingUpgrade, type SiloState } from '../game/silo.js';

const cfg = parseGameConfig(readFileSync(process.env.GAME_CONFIG_PATH ?? '../config/game.yaml', 'utf8'));
const arg = (name: string, def: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def);
const days = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 14);

interface Result {
  rows: string[];
  mined: number;
  floorDay: number | null;
}

function run(depositTotal: number, checkEveryHours: number): Result {
  const t0 = new Date('2026-01-01T00:00:00Z');
  let s: SiloState = { levels: initialLevels(), oreReal: cfg.economy.start_ore, steam: 100, depositTotal, depositRemaining: depositTotal, at: t0 };
  let pending: PendingUpgrade[] = [];
  let id = 1;
  let spent = 0;
  let floorDay: number | null = null;
  const rows: string[] = [];
  const stepMs = checkEveryHours * 3_600_000;
  for (let t = stepMs; t <= days * 86_400_000; t += stepMs) {
    const now = new Date(t0.getTime() + t);
    const r = advance(s, cfg, now, pending);
    s = r.state;
    pending = pending.filter((u) => !r.done.includes(u));
    if (pending.length < cfg.upgrades.queue_slots) {
      // strategia: ulepszaj najniższy z (szyb, magazyn); gdy są na maksie – generator, warsztat, wartownia
      const order: BuildingType[] = ['szyb_glowny', 'magazyn', ...BUILDING_TYPES.filter((b) => b !== 'szyb_glowny' && b !== 'magazyn')];
      const cand = order.filter((b) => s.levels[b] < cfg.upgrades.max_level).sort((a, b) => s.levels[a] - s.levels[b])[0];
      if (cand) {
        const cost = upgradeCost(cfg, cand, s.levels[cand] + 1);
        if (s.oreReal >= cost) {
          s = { ...s, oreReal: s.oreReal - cost };
          spent += cost;
          pending.push({ id: id++, type: cand, toLevel: s.levels[cand] + 1, endsAt: new Date(now.getTime() + upgradeSeconds(cfg, s.levels[cand] + 1) * 1000) });
        }
      }
    }
    const day = t / 86_400_000;
    if (floorDay === null && s.depositRemaining / depositTotal <= cfg.economy.deposit.floor_fraction + 1e-6) floorDay = day;
    if (Number.isInteger(day) || Math.abs(day - Math.round(day)) < 1e-9) {
      const d = Math.round(day);
      if (d === 1 || d === 3 || d === 7 || d === 14 || d === days)
        rows.push(`  dzień ${String(d).padStart(2)} | szyb L${s.levels.szyb_glowny} magazyn L${s.levels.magazyn} | ruda ${String(Math.floor(s.oreReal)).padStart(5)} | wydane ${String(spent).padStart(6)} | złoże ${(100 * s.depositRemaining / depositTotal).toFixed(0).padStart(3)}%`);
    }
  }
  const mined = depositTotal - s.depositRemaining;
  return { rows: [...new Set(rows)], mined, floorDay };
}

const base = arg('deposit', cfg.economy.deposit.local_total);
const check = arg('check', 6);
console.log(`Symulacja ${days} dni, strategia: sprawdzanie co ${check} h, złoże bazowe ${base} (±${cfg.economy.deposit.variance * 100}%)\n`);
for (const [label, mult] of [['ubogie (-40%)', 1 - cfg.economy.deposit.variance], ['średnie', 1], ['bogate (+40%)', 1 + cfg.economy.deposit.variance]] as const) {
  const r = run(Math.round(base * mult), check);
  console.log(`${label} – złoże ${Math.round(base * mult)}; wydobyto z niego ${Math.round(r.mined)}; dno ${r.floorDay === null ? 'nieosiągnięte' : `od dnia ${r.floorDay.toFixed(1)}`}`);
  r.rows.forEach((l) => console.log(l));
  console.log();
}
console.log('Porównanie stylów gry (średnie złoże):');
for (const h of [0.5, 2, 6, 12, 24]) {
  const r = run(base, h);
  console.log(`  sprawdzanie co ${String(h).padStart(4)} h → wydobyto ${String(Math.round(r.mined)).padStart(6)} rudy, dno ${r.floorDay === null ? 'brak' : `od dnia ${r.floorDay.toFixed(1)}`}`);
}
