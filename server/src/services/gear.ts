import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db.js';

import type { GameConfig } from '../config.js';
import { computeEffects } from '../game/research.js';
import { addProfiles, itemProfile, ZERO_PROFILE, type Profile } from '../game/upgrade.js';

type Trx = Transaction<Database> | Kysely<Database>;

/** Numer zestawu ekwipunku (docs/ekwipunek-v1.0.md §3). */
export type LoadoutNo = 1 | 2;
export const isLoadoutNo = (n: unknown): n is LoadoutNo => n === 1 || n === 2;

export async function loadEffects(db: Trx, cfg: GameConfig, userId: string) {
  const rows = await db.selectFrom('research').select('tech_id').where('user_id', '=', userId).where('state', '=', 'done').execute();
  return computeEffects(cfg, rows.map((r) => r.tech_id));
}

export async function activeLoadout(db: Trx, userId: string): Promise<LoadoutNo> {
  const p = await db.selectFrom('players').select('active_loadout').where('user_id', '=', userId).executeTakeFirst();
  return p?.active_loadout === 2 ? 2 : 1;
}

/** Suma profili niezepsutych przedmiotów zestawu. */
export async function loadoutProfile(db: Trx, cfg: GameConfig, userId: string, loadout: LoadoutNo): Promise<Profile> {
  const rows = await db
    .selectFrom('loadouts')
    .innerJoin('items', 'items.id', 'loadouts.item_id')
    .select(['items.recipe_id', 'items.quality', 'items.durability', 'items.tier'])
    .where('loadouts.user_id', '=', userId)
    .where('loadouts.loadout', '=', loadout)
    .where('items.durability', '>', 0)
    .execute();
  let sum = ZERO_PROFILE;
  for (const it of rows) {
    const rc = cfg.items.recipes.find((r) => r.id === it.recipe_id);
    if (rc) sum = addProfiles(sum, itemProfile(cfg, rc, it.quality, it.tier));
  }
  return sum;
}

/** Moc zjazdu z aktywnego zestawu (podgląd szans tras). */
export async function equippedBonus(db: Trx, cfg: GameConfig, userId: string): Promise<number> {
  return (await loadoutProfile(db, cfg, userId, await activeLoadout(db, userId))).dive;
}

/** Zużycie: każdy nieuszkodzony przedmiot zestawu traci 1 wytrzymałości. */
export async function wearLoadout(trx: Transaction<Database>, userId: string, loadout: LoadoutNo): Promise<void> {
  await trx
    .updateTable('items')
    .set((eb) => ({ durability: eb('durability', '-', 1) }))
    .where('user_id', '=', userId)
    .where('durability', '>', 0)
    .where('id', 'in', (eb) => eb.selectFrom('loadouts').select('item_id').where('user_id', '=', userId).where('loadout', '=', loadout))
    .execute();
}
