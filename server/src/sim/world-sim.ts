/**
 * Symulator świata M2a: N graczy dzieli wspólne pule stref; różne style gry (hardcore / regularny / okazjonalny).
 * Sprawdza: tempo awansu, jak szybko wyczerpują się pule, ile rudy daje zjazd vs szyb.
 * Użycie: npm run sim:world [dni] [--players=50] [--seed=1]
 */
import { readFileSync } from 'node:fs';
import { BUILDING_TYPES, parseGameConfig, type BuildingType } from '../config.js';
import { initialLevels, upgradeCost, upgradeSeconds } from '../game/formulas.js';
import { advance, type PendingUpgrade, type SiloState } from '../game/silo.js';
import { addXp, diveChance, poolTotal, resolveDive, steamCost, type Stats } from '../game/dive.js';
import { rng } from '../game/rng.js';

const cfg = parseGameConfig(readFileSync(process.env.GAME_CONFIG_PATH ?? '../config/game.yaml', 'utf8'));
const arg = (n: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const days = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 14);
const N = arg('players', cfg.world.expected_players);
const R = rng(arg('seed', 1));

type Style = 'hardcore' | 'regularny' | 'okazjonalny';
const ONLINE_P: Record<Style, number> = { hardcore: 0.5, regularny: 0.06, okazjonalny: 0.011 }; // na 10-min tick w godz. 8–23

interface P {
  style: Style;
  arch: (typeof cfg.archetypes)[number];
  silo: SiloState;
  pending: PendingUpgrade[];
  stats: Stats;
  level: number;
  xp: number;
  tokens: number;
  windedUntil: number;
  dive: { routeId: string; endsAt: number; seed: number } | null;
  nextId: number;
  diveOre: number;
  prodOre: number;
}

const t0 = Date.UTC(2026, 0, 1);
const styles: Style[] = [...Array(Math.round(N * 0.3)).fill('hardcore'), ...Array(Math.round(N * 0.5)).fill('regularny')];
while (styles.length < N) styles.push('okazjonalny');

const players: P[] = styles.slice(0, N).map((style, i) => {
  const arch = cfg.archetypes[i % cfg.archetypes.length]!;
  const total = Math.round(cfg.economy.deposit.local_total * (1 + (R() * 2 - 1) * cfg.economy.deposit.variance));
  return {
    style, arch,
    silo: { levels: initialLevels(), oreReal: cfg.economy.start_ore, steam: 100, depositTotal: total, depositRemaining: total, at: new Date(t0) },
    pending: [], stats: { ...arch.stats }, level: 1, xp: 0, tokens: 0, windedUntil: 0, dive: null, nextId: 1, diveOre: 0, prodOre: 0,
  };
});

const pools = new Map(cfg.dives.routes.map((r) => [r.zone, { remaining: poolTotal(cfg, r), total: poolTotal(cfg, r) }]));
let seedCounter = 1000;

function act(p: P, nowMs: number) {
  const now = new Date(nowMs);
  const before = p.silo.oreReal;
  const r = advance(p.silo, cfg, now, p.pending);
  p.prodOre += Math.max(0, r.state.oreReal - before);
  p.silo = r.state;
  p.pending = p.pending.filter((u) => !r.done.includes(u));
  if (p.dive && p.dive.endsAt <= nowMs) {
    const route = cfg.dives.routes.find((x) => x.id === p.dive!.routeId)!;
    const pool = pools.get(route.zone)!;
    const out = resolveDive(cfg, route, p.stats, p.arch.dive_ore_multiplier, p.dive.seed, pool);
    pool.remaining -= out.poolDraw;
    p.silo = { ...p.silo, oreReal: p.silo.oreReal + out.ore };
    p.diveOre += out.ore;
    p.tokens += out.tokens;
    const lv = addXp(cfg, p.level, p.xp, out.xp);
    p.level = lv.level; p.xp = lv.xpInLevel;
    p.stats = { ...p.stats, technika: p.stats.technika + lv.points }; // wszystkie punkty w Technikę
    if (!out.success) p.windedUntil = p.dive.endsAt + cfg.dives.winded_seconds * 1000;
    p.dive = null;
  }
  // zjazd: najlepsza odblokowana trasa z szansą >= 40%
  if (!p.dive && nowMs >= p.windedUntil) {
    const opts = cfg.dives.routes.filter((x) => x.min_level <= p.level && diveChance(p.stats, x.difficulty) >= 0.4);
    const route = opts[opts.length - 1] ?? cfg.dives.routes[0]!;
    const cost = steamCost(route, p.arch.dive_steam_multiplier);
    if (route.min_level <= p.level && p.silo.steam >= cost) {
      p.silo = { ...p.silo, steam: p.silo.steam - cost };
      p.dive = { routeId: route.id, endsAt: nowMs + route.seconds * 1000, seed: seedCounter++ };
    }
  }
  // ulepszenia: najniższy z (szyb, magazyn, generator), potem reszta
  if (p.pending.length < cfg.upgrades.queue_slots) {
    const order: BuildingType[] = ['szyb_glowny', 'magazyn', 'generator_pary', ...BUILDING_TYPES.filter((b) => !['szyb_glowny', 'magazyn', 'generator_pary'].includes(b))];
    const cand = order.filter((b) => p.silo.levels[b] < cfg.upgrades.max_level).sort((a, b) => p.silo.levels[a] - p.silo.levels[b])[0];
    if (cand) {
      const cost = upgradeCost(cfg, cand, p.silo.levels[cand] + 1, p.arch.upgrade_cost_multiplier);
      if (p.silo.oreReal >= cost) {
        p.silo = { ...p.silo, oreReal: p.silo.oreReal - cost };
        p.pending.push({ id: p.nextId++, type: cand, toLevel: p.silo.levels[cand] + 1, endsAt: new Date(nowMs + upgradeSeconds(cfg, p.silo.levels[cand] + 1) * 1000) });
      }
    }
  }
}

const TICK = 10 * 60_000;
const report = (day: number) => {
  const avg = (f: (p: P) => number) => players.reduce((s, p) => s + f(p), 0) / players.length;
  const health = [...pools.entries()].map(([z, v]) => `${z} ${(100 * v.remaining / v.total).toFixed(0)}%`).join(' | ');
  console.log(`dzień ${String(day).padStart(2)} | śr. poz. ${avg((p) => p.level).toFixed(1)} | śr. ruda ${Math.round(avg((p) => p.silo.oreReal)).toString().padStart(5)} | ze zjazdów ${Math.round(avg((p) => p.diveOre)).toString().padStart(6)} vs z szybu ${Math.round(avg((p) => p.prodOre)).toString().padStart(6)} | pule: ${health}`);
};
console.log(`Symulacja ${days} dni, ${N} graczy (30% hardcore, 50% regularni, 20% okazjonalni)\n`);
for (let t = TICK; t <= days * 86_400_000; t += TICK) {
  const hour = (t / 3_600_000) % 24;
  if (hour >= 8 && hour < 23) for (const p of players) if (R() < ONLINE_P[p.style]) act(p, t0 + t);
  if (t % 86_400_000 === 0) { const d = t / 86_400_000; if ([1, 2, 3, 5, 7, 10, 14, 21].includes(d) || d === days) report(d); }
}
console.log('\nWg stylu gry (po zakończeniu):');
for (const s of ['hardcore', 'regularny', 'okazjonalny'] as Style[]) {
  const g = players.filter((p) => p.style === s);
  const avg = (f: (p: P) => number) => (g.reduce((a, p) => a + f(p), 0) / g.length).toFixed(1);
  console.log(`  ${s.padEnd(12)} poz. ${avg((p) => p.level).padStart(5)} | szyb L${avg((p) => p.silo.levels.szyb_glowny)} | ruda ze zjazdów ${avg((p) => p.diveOre).padStart(8)} | z szybu ${avg((p) => p.prodOre).padStart(8)}`);
}
