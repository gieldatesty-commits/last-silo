import type { Transaction } from 'kysely';
import type { Database } from '../db.js';

import type { GameConfig } from '../config.js';
import { computeEffects } from '../game/research.js';

export async function loadEffects(db: Trx, cfg: GameConfig, userId: string) {
  const rows = await db.selectFrom('research').select('tech_id').where('user_id', '=', userId).where('state', '=', 'done').execute();
  return computeEffects(cfg, rows.map((r) => r.tech_id));
}

type Trx = Transaction<Database> | import('kysely').Kysely<Database>;

/** Bonus do mocy zjazdu z założonych, niezepsutych przedmiotów (bonus receptury × jakość). */
export async function equippedBonus(db: Trx, cfgRecipes: { id: string; bonus: number }[], userId: string): Promise<number> {
  const rows = await db.selectFrom('items').select(['recipe_id', 'quality', 'durability']).where('user_id', '=', userId).where('equipped', '=', true).execute();
  let sum = 0;
  for (const it of rows) {
    if (it.durability <= 0) continue;
    const rc = cfgRecipes.find((r) => r.id === it.recipe_id);
    if (rc) sum += rc.bonus * it.quality;
  }
  return sum;
}

/** Zużycie po zjeździe: każdy założony, nieuszkodzony przedmiot traci 1 wytrzymałości. */
export async function wearEquipped(trx: Transaction<Database>, userId: string): Promise<void> {
  await trx.updateTable('items').set((eb) => ({ durability: eb('durability', '-', 1) })).where('user_id', '=', userId).where('equipped', '=', true).where('durability', '>', 0).execute();
}
