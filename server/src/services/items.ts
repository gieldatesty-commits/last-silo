import type { Selectable, Transaction } from 'kysely';
import type { Database } from '../db.js';
import type { GameConfig } from '../config.js';
import { applyLedger, InsufficientFunds, walletBalance } from '../ledger.js';
import { rng } from '../game/rng.js';
import { GameError, settle, type Ctx } from './silo.js';
import { loadEffects } from './gear.js';
import { randomInt } from 'node:crypto';
import { itemBonus, tierRepairMult, upgradeTierCost } from '../game/upgrade.js';

type Trx = Transaction<Database>;

type Recipe = GameConfig['items']['recipes'][number];

/** Zakres jakości rośnie z poziomem Warsztatu. */
export function qualityRange(cfg: GameConfig, workshopLevel: number, bonus = 0) {
  const q = cfg.items.quality;
  return { min: q.min + q.min_step * (workshopLevel - 1) + bonus, max: q.max + q.max_step * (workshopLevel - 1) + bonus };
}

export const repairCost = (cfg: GameConfig, rc: Recipe, durability: number, maxDurability: number, mult = 1, tier = 0) =>
  Math.ceil(rc.ore * cfg.items.repair_cost_fraction * mult * tierRepairMult(cfg, tier) * ((maxDurability - durability) / maxDurability));

export async function radioLevel(db: Trx | Ctx['db'], userId: string): Promise<number> {
  return (await db.selectFrom('buildings').select('level').where('user_id', '=', userId).where('type', '=', 'radiostacja').executeTakeFirst())?.level ?? 1;
}

async function workshopLevel(trx: Trx, userId: string): Promise<number> {
  const b = await trx.selectFrom('buildings').select('level').where('user_id', '=', userId).where('type', '=', 'warsztat').executeTakeFirst();
  return b?.level ?? 1;
}

const view = (cfg: GameConfig, it: Selectable<Database['items']>, repairMult = 1) => {
  const rc = cfg.items.recipes.find((r) => r.id === it.recipe_id)!;
  return {
    id: String(it.id),
    recipeId: it.recipe_id,
    name: rc.name,
    slot: it.slot,
    quality: Math.round(it.quality * 100) / 100,
    bonus: Math.round(itemBonus(cfg, rc, it.quality, it.tier) * 100) / 100,
    tier: it.tier,
    maxTier: cfg.items.upgrade.max_tier,
    nextUpgrade: it.tier >= cfg.items.upgrade.max_tier ? null : upgradeTierCost(cfg, rc, it.tier + 1),
    durability: it.durability,
    maxDurability: it.max_durability,
    broken: it.durability <= 0,
    equipped: Boolean(it.equipped),
    repairCost: repairCost(cfg, rc, it.durability, it.max_durability, repairMult, it.tier),
  };
};

export async function listItems(ctx: Ctx, userId: string) {
  const cfg = ctx.config;
  await ctx.db.transaction().execute((trx) => settle(trx, cfg, userId, ctx.now()));
  const items = await ctx.db.selectFrom('items').selectAll().where('user_id', '=', userId).orderBy('id').execute();
  const wl = (await ctx.db.selectFrom('buildings').select('level').where('user_id', '=', userId).where('type', '=', 'warsztat').executeTakeFirst())?.level ?? 1;
  const rl = await radioLevel(ctx.db, userId);
  const fx = await loadEffects(ctx.db, cfg, userId);
  const qr = qualityRange(cfg, wl, fx.quality);
  return {
    items: items.map((i) => view(cfg, i as never, fx.repair)),
    inventoryMax: cfg.items.inventory_max,
    workshopLevel: wl,
    quality: { min: Math.round(qr.min * 100) / 100, max: Math.round(qr.max * 100) / 100 },
    recipes: cfg.items.recipes.map((r) => ({ id: r.id, name: r.name, slot: r.slot, workshop: r.workshop, ore: r.ore, tokens: r.tokens, materials: r.materials, radio: r.radio ?? null, bonus: r.bonus, durability: r.durability, locked: wl < r.workshop || (!!r.tech && !fx.unlocked.has(r.id)) || (!!r.radio && rl < r.radio), needsTech: r.tech ?? null })),
  };
}

export async function craftTx(trx: Trx, ctx: Ctx, userId: string, recipeId: string) {
  const cfg = ctx.config;
  const rc = cfg.items.recipes.find((r) => r.id === recipeId);
  if (!rc) throw new GameError(400, 'unknown_recipe');
  await settle(trx, cfg, userId, ctx.now());
  const wl = await workshopLevel(trx, userId);
  if (wl < rc.workshop) throw new GameError(409, 'workshop_too_low');
  const fx = await loadEffects(trx, cfg, userId);
  if (rc.tech && !fx.unlocked.has(rc.id)) throw new GameError(409, 'recipe_locked');
  if (rc.radio && (await radioLevel(trx, userId)) < rc.radio) throw new GameError(409, 'radio_too_low');
  const count = await trx.selectFrom('items').select((e) => e.fn.countAll<string>().as('n')).where('user_id', '=', userId).executeTakeFirstOrThrow();
  if (Number(count.n) >= cfg.items.inventory_max) throw new GameError(409, 'inventory_full');
  const seed = ctx.seed ? ctx.seed() : randomInt(1, 2 ** 31);
  const { min, max } = qualityRange(cfg, wl, fx.quality);
  const quality = min + (max - min) * rng(seed)();
  const it = await trx
    .insertInto('items')
    .values({ user_id: userId, recipe_id: rc.id, slot: rc.slot, quality, durability: rc.durability, max_durability: rc.durability })
    .returningAll()
    .executeTakeFirstOrThrow();
  try {
    await applyLedger(
      trx,
      userId,
      [
        { resource: 'ore', delta: -rc.ore, reason: 'craft_cost', ref: `craft:${it.id}` },
        { resource: 'tokens', delta: -rc.tokens, reason: 'craft_cost', ref: `craft:${it.id}:tokens` },
        ...Object.entries(rc.materials).map(([m, n]) => ({ resource: m, delta: -n, reason: 'craft_cost' as const, ref: `craft:${it.id}:mat:${m}` })),
      ],
      cfg.version,
    );
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, `insufficient_${e.resource}`);
    throw e;
  }
  await trx.insertInto('events_log').values({ user_id: userId, name: 'item_crafted', props: JSON.stringify({ recipeId: rc.id, quality }) }).execute();
  return view(cfg, it as never);
}

async function lockItem(trx: Trx, userId: string, id: string) {
  if (!/^\d+$/.test(id)) throw new GameError(404, 'no_item');
  const it = await trx.selectFrom('items').selectAll().where('id', '=', id).where('user_id', '=', userId).forUpdate().executeTakeFirst();
  if (!it) throw new GameError(404, 'no_item');
  return it;
}

/** Zakładanie zastępuje przedmiot w tym samym slocie. Najpierw rozliczamy zjazdy, żeby zmiana nie działała wstecz. */
export async function equipTx(trx: Trx, ctx: Ctx, userId: string, id: string, equip: boolean) {
  const cfg = ctx.config;
  await settle(trx, cfg, userId, ctx.now());
  const it = await lockItem(trx, userId, id);
  if (equip) {
    await trx.updateTable('items').set({ equipped: false }).where('user_id', '=', userId).where('slot', '=', it.slot).where('equipped', '=', true).execute();
  }
  const upd = await trx.updateTable('items').set({ equipped: equip }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  return view(cfg, upd as never);
}

export async function repairTx(trx: Trx, ctx: Ctx, userId: string, id: string) {
  const cfg = ctx.config;
  await settle(trx, cfg, userId, ctx.now());
  const it = await lockItem(trx, userId, id);
  const rc = cfg.items.recipes.find((r) => r.id === it.recipe_id)!;
  if (it.durability >= it.max_durability) throw new GameError(409, 'nothing_to_repair');
  const fx = await loadEffects(trx, cfg, userId);
  const cost = repairCost(cfg, rc, it.durability, it.max_durability, fx.repair, it.tier);
  try {
    await applyLedger(trx, userId, [{ resource: 'ore', delta: -cost, reason: 'repair_cost', ref: `repair:${it.id}:${it.durability}` }], cfg.version);
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, `insufficient_${e.resource}`);
    throw e;
  }
  const upd = await trx.updateTable('items').set({ durability: it.max_durability }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  return { ...view(cfg, upd as never, fx.repair), paid: cost };
}

/** Wzmocnienie przedmiotu o jeden tier: koszt w rudzie, żetonach i materiałach; wymaga Warsztatu i Radiostacji. Jakość i wytrzymałość zostają. */
export async function upgradeTx(trx: Trx, ctx: Ctx, userId: string, id: string) {
  const cfg = ctx.config;
  await settle(trx, cfg, userId, ctx.now());
  const it = await lockItem(trx, userId, id);
  if (it.tier >= cfg.items.upgrade.max_tier) throw new GameError(409, 'max_tier');
  const rc = cfg.items.recipes.find((r) => r.id === it.recipe_id)!;
  const cost = upgradeTierCost(cfg, rc, it.tier + 1);
  if ((await workshopLevel(trx, userId)) < cost.workshop) throw new GameError(409, 'workshop_too_low');
  if ((await radioLevel(trx, userId)) < cost.radio) throw new GameError(409, 'radio_too_low');
  try {
    await applyLedger(
      trx,
      userId,
      [
        { resource: 'ore', delta: -cost.ore, reason: 'upgrade_cost', ref: `upgrade:${it.id}:${cost.workshop}` },
        ...(cost.tokens > 0 ? [{ resource: 'tokens', delta: -cost.tokens, reason: 'upgrade_cost' as const, ref: `upgrade:${it.id}:${cost.workshop}:tokens` }] : []),
        ...Object.entries(cost.materials).map(([m, n]) => ({ resource: m, delta: -n, reason: 'upgrade_cost' as const, ref: `upgrade:${it.id}:${cost.workshop}:mat:${m}` })),
      ],
      cfg.version,
    );
  } catch (e) {
    if (e instanceof InsufficientFunds) throw new GameError(402, `insufficient_${e.resource}`);
    throw e;
  }
  const upd = await trx.updateTable('items').set({ tier: it.tier + 1 }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  await trx.insertInto('events_log').values({ user_id: userId, name: 'item_upgraded', props: JSON.stringify({ recipeId: rc.id, tier: it.tier + 1 }) }).execute();
  return { ...view(cfg, upd as never), paid: cost };
}

export { walletBalance };
