import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const stats = z.object({
  sila: z.number().int().min(0),
  technika: z.number().int().min(0),
  percepcja: z.number().int().min(0),
  wytrwalosc: z.number().int().min(0),
});

export const BUILDING_TYPES = ['szyb_glowny', 'generator_pary', 'magazyn', 'warsztat', 'wartownia'] as const;
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
          }),
        )
        .min(1),
    }),
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
