import type { GameConfig } from '../config.js';
import { rng } from './rng.js';
import type { LatLon } from './world.js';

const rad = (d: number) => (d * Math.PI) / 180;
const unit = (p: LatLon): [number, number, number] => [Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)), Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)), Math.sin(rad(p.lat))];

/** Stałe pola świata: kierunek i faza dla każdego materiału wyznaczone z field_seed (ten sam świat dla wszystkich). */
function fields(c: GameConfig) {
  const r = rng(c.geology.field_seed);
  return c.geology.materials.map((id) => {
    const v: [number, number, number] = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    const n = Math.hypot(...v) || 1;
    return { id, dir: [v[0] / n, v[1] / n, v[2] / n] as [number, number, number], phase: r() * Math.PI * 2 };
  });
}

/**
 * Bogactwo materiałów w danym miejscu. Pola są gładkie na kuli, więc sąsiednie silosy mają podobny ranking
 * (obfity / średni / ślady). `variance` ∈ [0,1) – deterministyczny szum lokalny z ziarna silosu.
 */
export function geologyProfile(c: GameConfig, pos: LatLon, localSeed: number): Record<string, number> {
  const u = unit(pos);
  const scored = fields(c).map((f) => ({ id: f.id, v: Math.sin(c.geology.field_frequency * (f.dir[0] * u[0] + f.dir[1] * u[1] + f.dir[2] * u[2]) * Math.PI + f.phase) }));
  scored.sort((a, b) => b.v - a.v);
  const tiers = [c.geology.richness.main, c.geology.richness.secondary, c.geology.richness.trace];
  const r = rng(localSeed);
  const out: Record<string, number> = {};
  scored.forEach((s, i) => {
    const jitter = 1 + (r() * 2 - 1) * c.geology.local_variance;
    out[s.id] = (tiers[Math.min(i, tiers.length - 1)] ?? tiers[2]!) * jitter;
  });
  return out;
}

/** Opis dla gracza bez liczb. */
export function describeProfile(c: GameConfig, profile: Record<string, number>): Record<string, 'obfity' | 'sredni' | 'slady'> {
  const t = c.geology.richness;
  const out: Record<string, 'obfity' | 'sredni' | 'slady'> = {};
  for (const [id, v] of Object.entries(profile)) out[id] = v >= (t.main + t.secondary) / 2 ? 'obfity' : v >= (t.secondary + t.trace) / 2 ? 'sredni' : 'slady';
  return out;
}
