/** Nocny audyt: portfele muszą się zgadzać z sumą dziennika, a runy w gniazdach z osadzeniami w dzienniku. Kod wyjścia 1 przy różnicy (do alarmu/cron). */
import { createDb } from './db.js';
import { auditLedger, auditSockets } from './ledger.js';

const { db } = createDb(process.env.DATABASE_URL ?? '');
const bad = [...(await auditLedger(db)), ...(await auditSockets(db))];
await db.destroy();
if (bad.length) {
  console.error('AUDYT: niezgodności', bad);
  process.exit(1);
}
console.log('AUDYT OK');
