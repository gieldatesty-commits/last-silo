import type { GameConfig } from '../config.js';

export interface Effects {
  /** dodatek do mocy zjazdu */
  divePower: number;
  /** mnożnik rudy ze zjazdów */
  diveOre: number;
  /** mnożnik kosztu pary zjazdów */
  diveSteam: number;
  /** dodatek do jakości wytwarzanych przedmiotów */
  quality: number;
  /** mnożnik kosztu napraw */
  repair: number;
  /** mnożnik kosztu ulepszeń budynków */
  upgradeCost: number;
  /** mnożnik czasu zadyszki */
  winded: number;
  /** mnożnik próbek ze zjazdów */
  samples: number;
  unlocked: Set<string>;
  /** ukończone badania (wymogi tierów 6–10) */
  done: Set<string>;
}

export function computeEffects(cfg: GameConfig, done: Iterable<string>): Effects {
  const e: Effects = { divePower: 0, diveOre: 1, diveSteam: 1, quality: 0, repair: 1, upgradeCost: 1, winded: 1, samples: 1, unlocked: new Set(), done: new Set() };
  let ore = 0, steam = 0, repair = 0, upg = 0, wd = 0, sm = 0;
  for (const id of done) {
    const t = cfg.research.techs.find((x) => x.id === id);
    if (!t) continue;
    e.done.add(id);
    e.divePower += t.effect.dive_power ?? 0;
    e.quality += t.effect.quality ?? 0;
    ore += t.effect.dive_ore_pct ?? 0;
    steam += t.effect.dive_steam_pct ?? 0;
    repair += t.effect.repair_pct ?? 0;
    upg += t.effect.upgrade_cost_pct ?? 0;
    wd += t.effect.winded_pct ?? 0;
    sm += t.effect.samples_pct ?? 0;
    for (const u of t.unlocks) e.unlocked.add(u);
  }
  e.diveOre = 1 + ore / 100;
  e.diveSteam = Math.max(0.5, 1 + steam / 100);
  e.repair = Math.max(0.2, 1 + repair / 100);
  e.upgradeCost = Math.max(0.5, 1 + upg / 100);
  e.winded = Math.max(0.25, 1 + wd / 100);
  e.samples = 1 + sm / 100;
  return e;
}

export const researchSeconds = (cfg: GameConfig, base: number, labLevel: number) =>
  Math.round(base * Math.max(0.5, 1 - cfg.research.lab_time_step * (labLevel - 1)));
