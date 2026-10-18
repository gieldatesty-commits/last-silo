import type { GameConfig } from '../config.js';

export interface LatLon {
  lat: number;
  lon: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** odległość po kuli (haversine) w km */
export function distanceKm(a: LatLon, b: LatLon, radiusKm: number): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** jednostajny punkt na kuli */
export function randomPoint(r: () => number): LatLon {
  const lat = (Math.asin(2 * r() - 1) * 180) / Math.PI;
  const lon = r() * 360 - 180;
  return { lat, lon };
}

/**
 * Best-candidate sampling: losujemy N kandydatów i bierzemy tego, który jest najdalej od najbliższego sąsiada.
 * Kandydaci bliżsi niż min_silo_distance_km są odrzucani (jeśli wszyscy, bierzemy najlepszego).
 */
export function placeSilo(c: GameConfig, existing: LatLon[], r: () => number): LatLon {
  let best: LatLon | null = null;
  let bestD = -1;
  for (let i = 0; i < c.world.placement_candidates; i++) {
    const p = randomPoint(r);
    let nearest = Infinity;
    for (const e of existing) nearest = Math.min(nearest, distanceKm(p, e, c.world.radius_km));
    if (nearest > bestD) {
      bestD = nearest;
      best = p;
    }
  }
  return best!;
}

/** ukryta wielkość złoża lokalnego (ruda) */
export function rollLocalDeposit(c: GameConfig, r: () => number): number {
  const { local_total, variance } = c.economy.deposit;
  return Math.round(local_total * (1 + (r() * 2 - 1) * variance));
}
