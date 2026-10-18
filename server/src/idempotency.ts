import type { Transaction } from 'kysely';
import type { Database, Db } from './db.js';

export interface IdemResult {
  status: number;
  body: unknown;
}

/**
 * Operacja wykonana raz na (gracz, Idempotency-Key). Powtórka zwraca zapisaną odpowiedź.
 * Klucz i skutki operacji są w jednej transakcji: błąd = rollback = klucz nie jest zużyty.
 * Równoległe żądania z tym samym kluczem czekają na unikalnym indeksie i dostają powtórkę.
 */
export async function idempotent(db: Db, userId: string, key: string, fn: (trx: Transaction<Database>) => Promise<IdemResult>): Promise<IdemResult & { replay: boolean }> {
  return db.transaction().execute(async (trx) => {
    const claimed = await trx
      .insertInto('idempotency_keys')
      .values({ user_id: userId, key, status: 0, response: JSON.stringify({}) })
      .onConflict((oc) => oc.doNothing())
      .returning('key')
      .executeTakeFirst();
    if (!claimed) {
      const prev = await trx.selectFrom('idempotency_keys').select(['status', 'response']).where('user_id', '=', userId).where('key', '=', key).executeTakeFirstOrThrow();
      return { status: prev.status, body: prev.response, replay: true };
    }
    const res = await fn(trx);
    await trx
      .updateTable('idempotency_keys')
      .set({ status: res.status, response: JSON.stringify(res.body) })
      .where('user_id', '=', userId)
      .where('key', '=', key)
      .execute();
    return { ...res, replay: false };
  });
}
