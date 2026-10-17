import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const stats = z.object({
  sila: z.number().int().min(0),
  technika: z.number().int().min(0),
  percepcja: z.number().int().min(0),
  wytrwalosc: z.number().int().min(0),
});

export const GameConfigSchema = z
  .object({
    version: z.string().min(1),
    resources: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
    archetypes: z.array(z.object({ id: z.string(), name: z.string(), stats })).min(1),
  })
  .superRefine((cfg, ctx) => {
    for (const key of ['resources', 'archetypes'] as const) {
      const ids = cfg[key].map((x) => x.id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', message: `duplikaty id w ${key}` });
      }
    }
  });

export type GameConfig = z.infer<typeof GameConfigSchema>;

export function parseGameConfig(yamlText: string): GameConfig {
  return GameConfigSchema.parse(parse(yamlText));
}

export function loadGameConfig(path: string): GameConfig {
  return parseGameConfig(readFileSync(path, 'utf8'));
}
