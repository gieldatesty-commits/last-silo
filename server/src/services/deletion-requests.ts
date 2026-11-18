import { deleteAccount } from './account.js';
import type { Ctx } from './silo.js';

/** Ręczna obsługa próśb o usunięcie konta ze strony WWW (`npm run deletion-requests`). */
export interface DeletionRequestRow {
  id: string;
  userId: string | null;
  nickname: string;
  code: string;
  message: string | null;
  createdAt: Date;
}

/** Nieobsłużone prośby, najstarsze pierwsze. */
export async function listRequests(ctx: Ctx): Promise<DeletionRequestRow[]> {
  const rows = await ctx.db.selectFrom('deletion_requests').selectAll().where('handled_at', 'is', null).orderBy('created_at').orderBy('id').execute();
  return rows.map((r) => ({ id: r.id, userId: r.user_id, nickname: r.nickname, code: r.code, message: r.message, createdAt: r.created_at }));
}

/**
 * `delete`: usuwa dopasowane konto i zamyka prośbę; prośba bez dopasowania zostaje otwarta (`no_match`).
 * `reject`: zamyka prośbę bez usuwania.
 */
export async function handleRequest(ctx: Ctx, id: string, action: 'delete' | 'reject'): Promise<'deleted' | 'rejected' | 'no_match'> {
  const row = await ctx.db.selectFrom('deletion_requests').select(['user_id', 'handled_at']).where('id', '=', id).executeTakeFirst();
  if (!row || row.handled_at) throw new Error(`Brak otwartej prośby ${id}`);
  if (action === 'delete') {
    if (!row.user_id) return 'no_match';
    await deleteAccount(ctx, row.user_id);
  }
  await ctx.db.updateTable('deletion_requests').set({ handled_at: ctx.now() }).where('id', '=', id).execute();
  return action === 'delete' ? 'deleted' : 'rejected';
}
