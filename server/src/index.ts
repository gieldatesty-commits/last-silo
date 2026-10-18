import { buildApp } from './app.js';
import { loadGameConfig } from './config.js';
import { createDb } from './db.js';
import { loadEnv } from './env.js';
import { migrate } from './migrate.js';

const env = loadEnv();
const config = loadGameConfig(env.GAME_CONFIG_PATH);
const { db, pool } = createDb(env.DATABASE_URL);
await migrate(pool);
const app = buildApp({ db, config, jwtSecret: env.JWT_SECRET });
await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`Last Silo server: :${env.PORT}, config ${config.version}`);
