import type { GameConfig } from '../config.js';

/**
 * Komplety przedmiotów (docs/ekwipunek-v1.0.md §6): bonus za 2 i 4 założone, niezepsute części w jednym zestawie.
 * 4 części dają bonus2 i bonus4.
 */
export type SetBonus = { dive_power: number; dive_ore_pct: number; attack: number; defense: number; repair_pct: number };
export const ZERO_SET: SetBonus = Object.freeze({ dive_power: 0, dive_ore_pct: 0, attack: 0, defense: 0, repair_pct: 0 });

const addBonus = (a: SetBonus, b: Partial<SetBonus>): SetBonus => ({
  dive_power: a.dive_power + (b.dive_power ?? 0),
  dive_ore_pct: a.dive_ore_pct + (b.dive_ore_pct ?? 0),
  attack: a.attack + (b.attack ?? 0),
  defense: a.defense + (b.defense ?? 0),
  repair_pct: a.repair_pct + (b.repair_pct ?? 0),
});

const countPieces = (pieces: string[], recipeIds: Iterable<string>) => {
  const have = new Set(recipeIds);
  return pieces.filter((p) => have.has(p)).length;
};

/** Bonusy kompletów dla receptur niezepsutych przedmiotów jednego zestawu (duplikaty liczą się raz). */
export function setBonuses(cfg: GameConfig, recipeIds: string[]) {
  let total = ZERO_SET;
  const active: { id: string; name: string; have: number; bonus2: boolean; bonus4: boolean }[] = [];
  for (const s of cfg.items.sets) {
    const have = countPieces(s.pieces, recipeIds);
    const b2 = have >= 2;
    const b4 = have >= 4;
    if (b2) total = addBonus(total, s.bonus2);
    if (b4) total = addBonus(total, s.bonus4);
    if (b2) active.push({ id: s.id, name: s.name, have, bonus2: b2, bonus4: b4 });
  }
  return { total, active };
}

/** Postęp wszystkich kompletów w obu zestawach (do GET /items). */
export function setProgress(cfg: GameConfig, byLoadout: { '1': string[]; '2': string[] }) {
  return cfg.items.sets.map((s) => ({
    id: s.id,
    name: s.name,
    pieces: s.pieces,
    have: { '1': countPieces(s.pieces, byLoadout['1']), '2': countPieces(s.pieces, byLoadout['2']) },
    bonus2: s.bonus2,
    bonus4: s.bonus4,
  }));
}
