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
    world: z.object({
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
      .array(z.object({ id: z.string(), name: z.string(), stats, upgrade_cost_multiplier: pos.default(1) }))
      .min(1),
  })
  .superRefine((cfg, ctx) => {
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
