import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET musi mieć min. 16 znaków'),
  GAME_CONFIG_PATH: z.string().default('../config/game.yaml'),
  PORT: z.coerce.number().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;
export const loadEnv = (src: NodeJS.ProcessEnv = process.env): Env => EnvSchema.parse(src);
