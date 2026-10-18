/**
 * Symulator świata M2a: N graczy dzieli wspólne pule stref; różne style gry (hardcore / regularny / okazjonalny).
 * Sprawdza: tempo awansu, jak szybko wyczerpują się pule, ile rudy daje zjazd vs szyb.
 * M2b+: gracze wytwarzają i naprawiają sprzęt, prowadzą badania, zbierają próbki.
 * Użycie: npm run sim:world [dni] [--players=50] [--seed=1] [--sub=0.3] [--nogear=1]
 */
import { readFileSync } from 'node:fs';
import { BUILDING_TYPES, parseGameConfig, type BuildingType } from '../config.js';
import { initialLevels, upgradeCost, upgradeSeconds } from '../game/formulas.js';
import { advance, type PendingUpgrade, type SiloState } from '../game/silo.js';
import { addXp, diveChance, poolTotal, resolveDive, steamCost, type Stats } from '../game/dive.js';
import { rng } from '../game/rng.js';
import { computeEffects, researchSeconds } from '../game/research.js';

const cfg = parseGameConfig(readFileSync(process.env.GAME_CONFIG_PATH ?? '../config/game.yaml', 'utf8'));
const arg = (n: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const days = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 14);
const N = arg('players', cfg.world.expected_players);
const R = rng(arg('seed', 1));
const SUB = arg('sub', 0); // odsetek graczy z abonamentem (3 sloty)
const NOGEAR = arg('nogear', 0) === 1; // bez sprzętu i badań (punkt odniesienia)

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
  queue: { routeId: string; endsAt: number; seed: number }[];
  slots: number;
  nextId: number;
  diveOre: number;
  prodOre: number;
  samples: number;
  gear: Map<string, { recipe: string; quality: number; dur: number; max: number }>;
  done: Set<string>;
  research: { id: string; endsAt: number } | null;
  spent: { buildings: number; research: number; craft: number; repair: number };
  dives: number;
  wins: number;
  chanceSum: number;
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
    pending: [], stats: { ...arch.stats }, level: 1, xp: 0, tokens: 0, windedUntil: 0, queue: [], slots: R() < SUB ? cfg.dives.queue_slots.subscriber : cfg.dives.queue_slots.free, nextId: 1, diveOre: 0, prodOre: 0,
    samples: 0, gear: new Map(), done: new Set(), research: null, spent: { buildings: 0, research: 0, craft: 0, repair: 0 }, dives: 0, wins: 0, chanceSum: 0,
  };
});

const pools = new Map(Object.keys(cfg.dives.zones).map((z) => [z, { remaining: poolTotal(cfg, z, N), total: poolTotal(cfg, z, N) }]));
let seedCounter = 1000;

const gearBonus = (p: P) => [...p.gear.values()].reduce((sum, g) => (g.dur > 0 ? sum + cfg.items.recipes.find((r) => r.id === g.recipe)!.bonus * g.quality : sum), 0);
const fxOf = (p: P) => computeEffects(cfg, p.done);
const bonusOf = (p: P) => gearBonus(p) + fxOf(p).divePower;
const qualityMid = (wl: number, extra: number) => {
  const q = cfg.items.quality;
  return (q.min + q.min_step * (wl - 1) + q.max + q.max_step * (wl - 1)) / 2 + extra;
};

function act(p: P, nowMs: number) {
  const now = new Date(nowMs);
  const before = p.silo.oreReal;
  const r = advance(p.silo, cfg, now, p.pending);
  p.prodOre += Math.max(0, r.state.oreReal - before);
  p.silo = r.state;
  p.pending = p.pending.filter((u) => !r.done.includes(u));
  // rozstrzygnij zjazdy, których czas minął (po kolei)
  while (p.queue.length && p.queue[0]!.endsAt <= nowMs) {
    const d = p.queue.shift()!;
    const route = cfg.dives.routes.find((x) => x.id === d.routeId)!;
    const pool = pools.get(route.zone)!;
    const fx = fxOf(p);
    const out = resolveDive(cfg, route, p.stats, p.arch.dive_ore_multiplier * fx.diveOre, d.seed, pool, bonusOf(p), fx.samples);
    for (const g of p.gear.values()) if (g.dur > 0) g.dur--;
    p.samples += out.samples;
    p.dives++;
    if (out.success) p.wins++;
    p.chanceSum += out.chance;
    pool.remaining -= out.poolDraw;
    p.silo = { ...p.silo, oreReal: p.silo.oreReal + out.ore };
    p.diveOre += out.ore;
    p.tokens += out.tokens;
    const lv = addXp(cfg, p.level, p.xp, out.xp);
    p.level = lv.level; p.xp = lv.xpInLevel;
    p.stats = { ...p.stats, technika: p.stats.technika + lv.points }; // wszystkie punkty w Technikę
    if (!out.success) p.windedUntil = d.endsAt + cfg.dives.winded_seconds * fx.winded * 1000;
  }
  // uzupełnij kolejkę wg stylu gry
  const maxSec = p.style === 'hardcore' ? 1800 : p.style === 'regularny' ? 4 * 3600 : 8 * 3600;
  while (p.queue.length < p.slots && nowMs >= p.windedUntil) {
    const opts = cfg.dives.routes.filter((x) => x.min_level <= p.level && x.seconds <= maxSec && diveChance(p.stats, x.difficulty, bonusOf(p)) >= 0.3);
    const route = opts.length ? opts[opts.length - 1]! : cfg.dives.routes[0]!;
    const cost = steamCost(route, p.arch.dive_steam_multiplier * fxOf(p).diveSteam);
    if (route.min_level > p.level || p.silo.steam < cost) break;
    p.silo = { ...p.silo, steam: p.silo.steam - cost };
    const startsAt = p.queue.length ? p.queue[p.queue.length - 1]!.endsAt : nowMs;
    p.queue.push({ routeId: route.id, endsAt: startsAt + route.seconds * 1000, seed: seedCounter++ });
  }
  // ulepszenia: najniższy z (szyb, magazyn, generator), potem reszta
  if (p.pending.length < cfg.upgrades.queue_slots) {
    const order: BuildingType[] = ['szyb_glowny', 'magazyn', 'generator_pary', ...BUILDING_TYPES.filter((b) => !['szyb_glowny', 'magazyn', 'generator_pary'].includes(b))];
    const cand = order.filter((b) => p.silo.levels[b] < cfg.upgrades.max_level).sort((a, b) => p.silo.levels[a] - p.silo.levels[b])[0];
    if (cand) {
      const cost = upgradeCost(cfg, cand, p.silo.levels[cand] + 1, p.arch.upgrade_cost_multiplier * fxOf(p).upgradeCost);
      if (p.silo.oreReal >= cost) {
        p.spent.buildings += cost;
        p.silo = { ...p.silo, oreReal: p.silo.oreReal - cost };
        p.pending.push({ id: p.nextId++, type: cand, toLevel: p.silo.levels[cand] + 1, endsAt: new Date(nowMs + upgradeSeconds(cfg, p.silo.levels[cand] + 1) * 1000) });
      }
    }
  }
  if (!NOGEAR) spendGear(p, nowMs);
}

/** Bot: badania (najtańsze dostępne), wytwarzanie najlepszego dostępnego sprzętu na slot, naprawy przy niskiej trwałości. */
function spendGear(p: P, nowMs: number) {
  const fx = fxOf(p);
  const ore = () => p.silo.oreReal;
  const pay = (k: keyof P['spent'], n: number) => { p.silo = { ...p.silo, oreReal: p.silo.oreReal - n }; p.spent[k] += n; };
  // zakończ badanie
  if (p.research && p.research.endsAt <= nowMs) { p.done.add(p.research.id); p.research = null; }
  // naprawy
  for (const g of p.gear.values()) {
    const rc = cfg.items.recipes.find((r) => r.id === g.recipe)!;
    if (g.dur <= g.max * 0.2) {
      const c = Math.ceil(rc.ore * cfg.items.repair_cost_fraction * fx.repair * ((g.max - g.dur) / g.max));
      if (ore() >= c * 2) { pay('repair', c); g.dur = g.max; }
    }
  }
  // badania
  if (!p.research) {
    const lab = p.silo.levels.laboratorium;
    const avail = cfg.research.techs
      .filter((t) => !p.done.has(t.id) && lab >= t.lab && t.requires.every((q) => p.done.has(q)) && p.tokens >= t.tokens && p.samples >= t.samples && ore() >= t.ore * 2)
      .sort((a, b) => a.ore - b.ore);
    const t = avail[0];
    if (t) {
      pay('research', t.ore); p.tokens -= t.tokens; p.samples -= t.samples;
      p.research = { id: t.id, endsAt: nowMs + researchSeconds(cfg, t.seconds, lab) * 1000 };
    }
  }
  // sprzęt: najlepsza receptura na slot (po bonusie), jeśli lepsza od obecnej i stać z zapasem
  const wl = p.silo.levels.warsztat;
  for (const slot of cfg.items.slots) {
    const cur = p.gear.get(slot);
    const curBonus = cur ? cfg.items.recipes.find((r) => r.id === cur.recipe)!.bonus : 0;
    const best = cfg.items.recipes
      .filter((r) => r.slot === slot && r.workshop <= wl && (!r.tech || fx.unlocked.has(r.id)) && r.bonus > curBonus && ore() >= r.ore * 2 && p.tokens >= r.tokens)
      .sort((a, b) => b.bonus - a.bonus)[0];
    if (best) {
      pay('craft', best.ore); p.tokens -= best.tokens;
      const q = qualityMid(wl, fx.quality);
      p.gear.set(slot, { recipe: best.id, quality: q, dur: best.durability, max: best.durability });
    }
  }
}

const TICK = 10 * 60_000;
const report = (day: number) => {
  const avg = (f: (p: P) => number) => players.reduce((s, p) => s + f(p), 0) / players.length;
  const health = [...pools.entries()].map(([z, v]) => `${z} ${(100 * v.remaining / v.total).toFixed(0)}%`).join(' | ');
  console.log(`dzień ${String(day).padStart(2)} | śr. poz. ${avg((p) => p.level).toFixed(1)} | śr. ruda ${Math.round(avg((p) => p.silo.oreReal)).toString().padStart(5)} | ze zjazdów ${Math.round(avg((p) => p.diveOre)).toString().padStart(6)} vs z szybu ${Math.round(avg((p) => p.prodOre)).toString().padStart(6)} | pule: ${health}`);
};
console.log(`Symulacja ${days} dni, ${N} graczy (30% hardcore, 50% regularni, 20% okazjonalni)${NOGEAR ? ' | BEZ sprzętu i badań' : ' | ze sprzętem i badaniami'}\n`);
for (let t = TICK; t <= days * 86_400_000; t += TICK) {
  const hour = (t / 3_600_000) % 24;
  if (hour >= 8 && hour < 23) for (const p of players) if (R() < ONLINE_P[p.style]) act(p, t0 + t);
  if (t % 86_400_000 === 0) { const d = t / 86_400_000; if ([1, 2, 3, 5, 7, 10, 14, 21].includes(d) || d === days) report(d); }
}
console.log('\nWykorzystanie puli stref (wydobyto / pula całkowita):');
for (const [zone, pl] of pools) {
  const drawn = pl.total - pl.remaining;
  console.log(`  ${zone.padEnd(10)} ${String(Math.round(drawn)).padStart(9)} / ${String(Math.round(pl.total)).padStart(9)} (${(100 * drawn / pl.total).toFixed(0)}%)`);
}
console.log('\nWg stylu gry (po zakończeniu):');
for (const s of ['hardcore', 'regularny', 'okazjonalny'] as Style[]) {
  const g = players.filter((p) => p.style === s);
  const avg = (f: (p: P) => number) => (g.reduce((a, p) => a + f(p), 0) / g.length).toFixed(1);
  const d = g.reduce((a, p) => a + p.diveOre, 0), sh = g.reduce((a, p) => a + p.prodOre, 0);
  console.log(`  ${s.padEnd(12)} poz. ${avg((p) => p.level).padStart(5)} | szyb L${avg((p) => p.silo.levels.szyb_glowny)} | ze zjazdów ${avg((p) => p.diveOre).padStart(8)} | z szybu ${avg((p) => p.prodOre).padStart(8)} | udział zjazdów ${(100 * d / (d + sh)).toFixed(0)}%`);
}

const avgAll = (f: (p: P) => number) => players.reduce((a, p) => a + f(p), 0) / players.length;
const sp = (k: keyof P['spent']) => avgAll((p) => p.spent[k]);
const income = avgAll((p) => p.diveOre + p.prodOre);
console.log('\nWydatki średnio na gracza (ruda) i udział w dochodzie:');
for (const [k, label] of [['buildings', 'budynki'], ['research', 'badania'], ['craft', 'wytwarzanie'], ['repair', 'naprawy']] as const) console.log(`  ${label.padEnd(12)} ${Math.round(sp(k)).toString().padStart(7)}  (${(100 * sp(k) / income).toFixed(0)}% dochodu)`);
console.log(`  dochód łączny ${Math.round(income)} | zostaje w magazynie ${Math.round(avgAll((p) => p.silo.oreReal))}`);
console.log(`\nZjazdy: śr. ${avgAll((p) => p.dives).toFixed(0)} na gracza | sukcesy ${(100 * avgAll((p) => p.wins) / Math.max(1, avgAll((p) => p.dives))).toFixed(0)}% | śr. szansa ${(100 * avgAll((p) => p.chanceSum) / Math.max(1, avgAll((p) => p.dives))).toFixed(0)}%`);
console.log(`Badania: śr. ${avgAll((p) => p.done.size).toFixed(1)} z ${cfg.research.techs.length} | próbki w zapasie ${avgAll((p) => p.samples).toFixed(1)} | wpisy kodeksu ${avgAll((p) => cfg.codex.filter((c) => p.done.has(c.tech)).length).toFixed(1)} z ${cfg.codex.length}`);
console.log(`Sprzęt: śr. założonych ${avgAll((p) => p.gear.size).toFixed(1)} z ${cfg.items.slots.length} | śr. bonus ${avgAll(gearBonus).toFixed(2)} (+badania ${avgAll((p) => fxOf(p).divePower).toFixed(2)})`);
console.log(`Poziom Warsztatu ${avgAll((p) => p.silo.levels.warsztat).toFixed(1)} | Laboratorium ${avgAll((p) => p.silo.levels.laboratorium).toFixed(1)}`);
