/** Nocny audyt: portfele muszą się zgadzać z sumą dziennika. Kod wyjścia 1 przy różnicy (do alarmu/cron). */
import { createDb } from './db.js';
import { loadEnv } from './env.js';
import { auditLedger } from './ledger.js';

const { db } = createDb(loadEnv().DATABASE_URL);
const bad = await auditLedger(db);
await db.destroy();
if (bad.length) {
  console.error('AUDYT: niezgodności', bad);
  process.exit(1);
}
console.log('AUDYT OK');
