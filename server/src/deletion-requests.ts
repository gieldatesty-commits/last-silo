/**
 * Prośby o usunięcie konta ze strony /usun-konto.
 *   npm run -s deletion-requests                 lista otwartych próśb
 *   npm run -s deletion-requests -- --delete ID  usuwa dopasowane konto i zamyka prośbę
 *   npm run -s deletion-requests -- --reject ID  zamyka prośbę bez usuwania
 * Na VPS (obraz bez tsx): docker compose exec api npm run -s deletion-requests:prod [-- --delete ID]
 */
import { loadGameConfig } from './config.js';
import { createDb } from './db.js';
import { handleRequest, listRequests } from './services/deletion-requests.js';

const { db } = createDb(process.env.DATABASE_URL ?? '');
const config = loadGameConfig(process.env.GAME_CONFIG_PATH ?? '../config/game.yaml');
const ctx = { db, config, now: () => new Date(), scheduler: { schedule: async () => undefined } };
const [flag, id] = process.argv.slice(2);
try {
  if (flag === '--delete' || flag === '--reject') {
    if (!id) throw new Error('Podaj ID prośby');
    const r = await handleRequest(ctx, id, flag === '--delete' ? 'delete' : 'reject');
    console.log(r === 'no_match' ? 'Brak dopasowanego konta: nic nie usunięto, prośba zostaje otwarta (odrzuć ją --reject).' : `OK: ${r}`);
  } else {
    const rows = await listRequests(ctx);
    if (!rows.length) console.log('Brak otwartych próśb.');
    for (const r of rows) {
      // dane wpisane przez odwiedzającego: wypisujemy jako zwykły tekst w JSON (bez znaków sterujących terminala)
      console.log(JSON.stringify({ id: r.id, createdAt: r.createdAt.toISOString(), nickname: r.nickname, code: r.code, matched: r.userId !== null, message: r.message }));
    }
  }
} finally {
  await db.destroy();
}
