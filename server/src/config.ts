import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const stats = z.object({
  sila: z.number().int().min(0),
  technika: z.number().int().min(0),
  percepcja: z.number().int().min(0),
  wytrwalosc: z.number().int().min(0),
});

export const BUILDING_TYPES = ['szyb_glowny', 'generator_pary', 'magazyn', 'warsztat', 'wartownia', 'laboratorium'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

const pos = z.number().positive();

export const GameConfigSchema = z
  .object({
    version: z.string().min(1),
    resources: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
    economy: z.object({
      start_ore: z.number().int().min(0),
      deposit: z.object({
        local_total: pos,
        variance: z.number().min(0).max(0.9),
        floor_fraction: z.number().min(0.01).max(0.5),
      }),
    }),
    progression: z.object({ xp_base: pos, xp_exp: pos, max_level: z.number().int().min(2), points_per_level: z.number().int().min(0) }),
    dives: z.object({
      queue_slots: z.object({ free: z.number().int().min(1), subscriber: z.number().int().min(1) }),
      fail_reward_fraction: z.number().min(0).max(1),
      winded_seconds: z.number().min(0),
      pool_floor_fraction: z.number().min(0.01).max(0.5),
      economy: z.object({
        ore_per_min: pos,
        xp_per_min: pos,
        short_bonus: z.number().min(0).max(1),
        reference_minutes: pos,
        min_route_minutes: pos,
        spread: z.number().min(0).max(0.9),
      }),
      zones: z.record(z.string(), z.object({ name: z.string(), pool_per_player: pos })),
      routes: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            zone: z.string(),
            min_level: z.number().int().min(1),
            seconds: pos,
            steam: pos,
            difficulty: pos,
            tokens: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
            samples: z.tuple([z.number().int().min(0), z.number().int().min(0)]).default([0, 0]),
          }),
        )
        .min(1),
    }),
    items: z.object({
      inventory_max: z.number().int().min(1),
      repair_cost_fraction: z.number().min(0).max(2),
      quality: z.object({ min: pos, max: pos, min_step: z.number().min(0), max_step: z.number().min(0) }),
      slots: z.array(z.string()).min(1),
      recipes: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slot: z.string(),
          workshop: z.number().int().min(1),
          ore: z.number().int().min(0),
          tokens: z.number().int().min(0),
          bonus: pos,
          durability: z.number().int().min(1),
          tech: z.string().optional(),
        }),
      ),
    }),
    research: z.object({
      lab_time_step: z.number().min(0).max(0.1),
      techs: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          branch: z.string(),
          lab: z.number().int().min(1),
          ore: z.number().int().min(0),
          tokens: z.number().int().min(0),
          samples: z.number().int().min(0).default(0),
          seconds: pos,
          requires: z.array(z.string()).default([]),
          unlocks: z.array(z.string()).default([]),
          effect: z
            .object({
              dive_ore_pct: z.number().optional(),
              dive_steam_pct: z.number().optional(),
              dive_power: z.number().optional(),
              quality: z.number().optional(),
              repair_pct: z.number().optional(),
              upgrade_cost_pct: z.number().optional(),
              winded_pct: z.number().optional(),
              samples_pct: z.number().optional(),
            })
            .default({}),
        }),
      ),
    }),
    codex: z.array(z.object({ id: z.string(), tech: z.string(), title: z.string(), text: z.string() })),
    world: z.object({
      expected_players: pos,
      radius_km: pos,
      min_silo_distance_km: z.number().min(0),
      placement_candidates: z.number().int().min(1).max(500),
    }),
    upgrades: z.object({
      max_level: z.number().int().min(2).max(50),
      cost_growth: pos,
      time_base_seconds: pos,
      time_growth: pos,
      queue_slots: z.number().int().min(1),
    }),
    effects: z.object({
      ore_per_hour: z.object({ base: pos, growth: pos }),
      steam: z.object({ cap_base: pos, cap_step: z.number().min(0), regen_base: pos, regen_step: z.number().min(0) }),
      warehouse: z.object({ cap_base: pos, cap_growth: pos, protected_step: z.number().min(0), protected_max: z.number().min(0).max(1) }),
      watchtower: z.object({ defense_step: z.number().min(0) }),
    }),
    buildings: z.array(z.object({ id: z.enum(BUILDING_TYPES), name: z.string(), base_cost: pos })),
    archetypes: z
      .array(z.object({ id: z.string(), name: z.string(), stats, upgrade_cost_multiplier: pos.default(1), dive_ore_multiplier: pos.default(1), dive_steam_multiplier: pos.default(1) }))
      .min(1),
  })
  .superRefine((cfg, ctx) => {
    for (const r of cfg.dives.routes) if (!cfg.dives.zones[r.zone]) ctx.addIssue({ code: 'custom', message: `trasa ${r.id}: nieznana strefa ${r.zone}` });
    for (const key of ['resources', 'archetypes', 'buildings'] as const) {
      const ids = cfg[key].map((x) => x.id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', message: `duplikaty id w ${key}` });
      }
    }
    for (const r of cfg.items.recipes) if (!cfg.items.slots.includes(r.slot)) ctx.addIssue({ code: 'custom', message: `receptura ${r.id}: nieznany slot ${r.slot}` });
    const rids = cfg.items.recipes.map((r) => r.id);
    if (new Set(rids).size !== rids.length) ctx.addIssue({ code: 'custom', message: 'duplikaty id receptur' });
    const tids = new Set(cfg.research.techs.map((t) => t.id));
    if (tids.size !== cfg.research.techs.length) ctx.addIssue({ code: 'custom', message: 'duplikaty id badań' });
    for (const c of cfg.codex) if (!tids.has(c.tech)) ctx.addIssue({ code: 'custom', message: `kodeks ${c.id}: nieznane badanie ${c.tech}` });
    const recipeIds = new Set(cfg.items.recipes.map((r) => r.id));
    for (const t of cfg.research.techs) {
      for (const q of t.requires) if (!tids.has(q)) ctx.addIssue({ code: 'custom', message: `badanie ${t.id}: nieznany wymóg ${q}` });
      for (const u of t.unlocks) if (!recipeIds.has(u)) ctx.addIssue({ code: 'custom', message: `badanie ${t.id}: nieznana receptura ${u}` });
    }
    for (const r of cfg.items.recipes) if (r.tech && !tids.has(r.tech)) ctx.addIssue({ code: 'custom', message: `receptura ${r.id}: nieznane badanie ${r.tech}` });
    const have = new Set(cfg.buildings.map((b) => b.id));
    for (const t of BUILDING_TYPES) {
      if (!have.has(t)) ctx.addIssue({ code: 'custom', message: `brak budynku ${t} w configu` });
    }
  });

export type GameConfig = z.infer<typeof GameConfigSchema>;

export function parseGameConfig(yamlText: string): GameConfig {
  return GameConfigSchema.parse(parse(yamlText));
}

export function loadGameConfig(path: string): GameConfig {
  return parseGameConfig(readFileSync(path, 'utf8'));
}
