import type { GameConfig } from '../config.js';
import { rng } from './rng.js';
import { ZERO_PROFILE, type Profile } from './upgrade.js';

/**
 * Runy (docs/ekwipunek-v1.0.md §5): zasób w portfelu o id `runa_{rodzaj}_{poziom}`, osadzany w gniazdach przedmiotu.
 * Bonus runy jest stały (nie mnoży się przez jakość, tier ani rzadkość).
 */

/** Sól strumienia łupu run: oddziela to losowanie od wyniku zjazdu z tego samego ziarna (to nie jest liczba gry). */
const RUNE_SALT = 0x52554e45;

export type RuneEffect = 'dive' | 'attack' | 'defense' | 'repair_pct';
export interface RuneInfo {
  id: string;
  kind: string;
  level: 1 | 2 | 3;
  name: string;
  effect: RuneEffect;
  value: number;
}

export const runeId = (kind: string, level: number) => `runa_${kind}_${level}`;

export function parseRune(c: GameConfig, id: string): RuneInfo | null {
  const m = /^runa_([a-z]+)_([123])$/.exec(id);
  if (!m) return null;
  const k = c.runes.kinds.find((x) => x.id === m[1]);
  if (!k) return null;
  const level = Number(m[2]) as 1 | 2 | 3;
  return { id, kind: k.id, level, name: k.name, effect: k.effect, value: k.values[level - 1]! };
}

export const allRuneIds = (c: GameConfig) => c.runes.kinds.flatMap((k) => [1, 2, 3].map((l) => runeId(k.id, l)));

/** Suma stałych bonusów run do profilu (Trwałości nie wchodzi do profilu, tylko do napraw). */
export function runesProfile(c: GameConfig, ids: string[]): Profile {
  const p = { ...ZERO_PROFILE };
  for (const id of ids) {
    const r = parseRune(c, id);
    if (r && r.effect !== 'repair_pct') p[r.effect] += r.value;
  }
  return p;
}

/** Mnożnik kosztu naprawy przedmiotu z run Trwałości: 1 − min(repair_cap, Σ|%|/100). */
export function runesRepairMult(c: GameConfig, ids: string[]): number {
  let pct = 0;
  for (const id of ids) {
    const r = parseRune(c, id);
    if (r?.effect === 'repair_pct') pct += Math.abs(r.value);
  }
  return 1 - Math.min(c.runes.repair_cap, pct / 100);
}

/** Koszt wytworzenia runy w Warsztacie; null dla poziomu, którego nie da się wytworzyć (III: tylko z łupu). */
export function runeCraftCost(c: GameConfig, id: string) {
  const r = parseRune(c, id);
  const lv = r && c.runes.craft.find((x) => x.level === r.level);
  if (!r || !lv) return null;
  const kind = c.runes.kinds.find((k) => k.id === r.kind)!;
  const materials: Record<string, number> = {};
  if (kind.material === 'mix') for (const m of c.geology.materials) materials[m] = Math.ceil(lv.material / c.geology.materials.length);
  else materials[kind.material] = lv.material;
  return { ore: lv.ore, tokens: lv.tokens, materials, workshop: lv.workshop, radio: lv.radio };
}

export const unsocketFee = (c: GameConfig, id: string) => c.runes.unsocket_fee[(parseRune(c, id)?.level ?? 1) - 1]!;

/**
 * Łup runy III po udanym zjeździe: osobny strumień `rng(seed ^ RUNE_SALT)` (wynik zjazdu bez zmian).
 * Szansa = base × (minuty trasy / reference_minutes) × mnożnik strefy; rodzaj losowany równo.
 */
export function rollRuneDrop(c: GameConfig, route: { seconds: number; zone: string }, seed: number): string | null {
  const d = c.runes.drop;
  const chance = d.base * (route.seconds / 60 / d.reference_minutes) * (d.zone_mult[route.zone] ?? 1);
  const r = rng((seed ^ RUNE_SALT) >>> 0);
  if (r() >= chance) return null;
  const kinds = c.runes.kinds;
  return runeId(kinds[Math.min(kinds.length - 1, Math.floor(r() * kinds.length))]!.id, 3);
}
