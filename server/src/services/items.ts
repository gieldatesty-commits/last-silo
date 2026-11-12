import type { Selectable, Transaction } from 'kysely';
import type { Database } from '../db.js';
import type { GameConfig } from '../config.js';
import { applyLedger, InsufficientFunds, walletBalance } from '../ledger.js';
import { rng } from '../game/rng.js';
import { GameError, settle, type Ctx } from './silo.js';
import { activeLoadout, isLoadoutNo, loadEffects, loadoutProfile, siloDefense, type LoadoutNo } from './gear.js';
import { randomInt } from 'node:crypto';
import { itemProfile, rarityOf, rollRarity, tierRepairMult, upgradeTierCost } from '../game/upgrade.js';

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

/** Koszt wzmocnienia z nazwą wymaganego badania (do opisu w kliencie). */
const withTechName = (cfg: GameConfig, c: ReturnType<typeof upgradeTierCost>) => ({ ...c, techName: c.tech ? (cfg.research.techs.find((t) => t.id === c.tech)?.name ?? c.tech) : null });

/** Zestawy, w których jest przedmiot, i aktywny zestaw gracza (do pól `inLoadouts` i `equipped`). */
type Membership = { active: LoadoutNo; of: Map<string, LoadoutNo[]> };

async function membership(db: Trx | Ctx['db'], userId: string): Promise<Membership> {
  const rows = await db.selectFrom('loadouts').select(['item_id', 'loadout']).where('user_id', '=', userId).orderBy('loadout').execute();
  const of = new Map<string, LoadoutNo[]>();
  for (const r of rows) of.set(String(r.item_id), [...(of.get(String(r.item_id)) ?? []), r.loadout as LoadoutNo]);
  return { active: await activeLoadout(db, userId), of };
}

const view = (cfg: GameConfig, it: Selectable<Database['items']>, m: Membership, repairMult = 1) => {
  const rc = cfg.items.recipes.find((r) => r.id === it.recipe_id)!;
  const rar = rarityOf(cfg, it.rarity);
  const prof = itemProfile(cfg, rc, it.quality, it.tier, rar.mult);
  const inLoadouts = m.of.get(String(it.id)) ?? [];
  return {
    id: String(it.id),
    recipeId: it.recipe_id,
    name: rc.name,
    slot: it.slot,
    quality: Math.round(it.quality * 100) / 100,
    bonus: Math.round(prof.dive * 100) / 100,
    attack: Math.round(prof.attack * 100) / 100,
    defense: Math.round(prof.defense * 100) / 100,
    rarity: { id: rar.id, name: rar.name, sockets: rar.sockets },
    tier: it.tier,
    maxTier: cfg.items.upgrade.max_tier,
    nextUpgrade: it.tier >= cfg.items.upgrade.max_tier ? null : withTechName(cfg, upgradeTierCost(cfg, rc, it.tier + 1)),
    durability: it.durability,
    maxDurability: it.max_durability,
    broken: it.durability <= 0,
    equipped: inLoadouts.includes(m.active),
    inLoadouts,
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
  const m = await membership(ctx.db, userId);
  const slotsOf = (lo: LoadoutNo) => {
    const out: Record<string, string | null> = Object.fromEntries(cfg.items.slots.map((s) => [s, null]));
    for (const [itemId, los] of m.of) if (los.includes(lo)) out[items.find((i) => String(i.id) === itemId)!.slot] = itemId;
    return out;
  };
  const round = (p: { dive: number; attack: number; defense: number }) => ({ dive: Math.round(p.dive * 100) / 100, attack: Math.round(p.attack * 100) / 100, defense: Math.round(p.defense * 100) / 100 });
  return {
    items: items.map((i) => view(cfg, i as never, m, fx.repair)),
    activeLoadout: m.active,
    loadouts: { '1': slotsOf(1), '2': slotsOf(2) },
    loadoutStats: { '1': round(await loadoutProfile(ctx.db, cfg, userId, 1)), '2': round(await loadoutProfile(ctx.db, cfg, userId, 2)) },
    // obrona silosu ze sprzętu, gdyby aktywny był dany zestaw (pełna z niego + passive_defense_share z drugiego)
    siloDefense: { '1': Math.round((await siloDefense(ctx.db, cfg, userId, 1)) * 100) / 100, '2': Math.round((await siloDefense(ctx.db, cfg, userId, 2)) * 100) / 100 },
    inventoryMax: cfg.items.inventory_max,
    workshopLevel: wl,
    quality: { min: Math.round(qr.min * 100) / 100, max: Math.round(qr.max * 100) / 100 },
    recipes: cfg.items.recipes.map((r) => ({ id: r.id, name: r.name, slot: r.slot, workshop: r.workshop, ore: r.ore, tokens: r.tokens, materials: r.materials, radio: r.radio ?? null, bonus: r.bonus, attack: r.attack ?? 0, defense: r.defense ?? 0, durability: r.durability, locked: wl < r.workshop || (!!r.tech && !fx.unlocked.has(r.id)) || (!!r.radio && rl < r.radio), needsTech: r.tech ?? null })),
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
  // jeden strumień z ziarna: 1. liczba = jakość (jak przed etapem 2), 2. = rzadkość (docs/ekwipunek-v1.0.md §4.1)
  const r = rng(seed);
  const quality = min + (max - min) * r();
  const rarity = rollRarity(cfg, r());
  const it = await trx
    .insertInto('items')
    .values({ user_id: userId, recipe_id: rc.id, slot: rc.slot, quality, durability: rc.durability, max_durability: rc.durability, rarity: rarity.id, seed })
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
  await trx.insertInto('events_log').values({ user_id: userId, name: 'item_crafted', props: JSON.stringify({ recipeId: rc.id, quality, rarity: rarity.id }) }).execute();
  return view(cfg, it as never, await membership(trx, userId));
}

async function lockItem(trx: Trx, userId: string, id: string) {
  if (!/^\d+$/.test(id)) throw new GameError(404, 'no_item');
  const it = await trx.selectFrom('items').selectAll().where('id', '=', id).where('user_id', '=', userId).forUpdate().executeTakeFirst();
  if (!it) throw new GameError(404, 'no_item');
  return it;
}

/** Zakładanie w zestawie zastępuje przedmiot w tym samym slocie tego zestawu (domyślnie aktywnego). Najpierw rozliczenie, żeby zmiana nie działała wstecz. */
export async function equipTx(trx: Trx, ctx: Ctx, userId: string, id: string, equip: boolean, loadout?: LoadoutNo) {
  const cfg = ctx.config;
  await settle(trx, cfg, userId, ctx.now());
  const it = await lockItem(trx, userId, id);
  const lo = loadout ?? (await activeLoadout(trx, userId));
  if (equip) {
    await trx
      .insertInto('loadouts')
      .values({ user_id: userId, loadout: lo, slot: it.slot, item_id: String(it.id) })
      .onConflict((oc) => oc.columns(['user_id', 'loadout', 'slot']).doUpdateSet({ item_id: String(it.id) }))
      .execute();
  } else {
    const del = await trx.deleteFrom('loadouts').where('user_id', '=', userId).where('loadout', '=', lo).where('item_id', '=', String(it.id)).executeTakeFirst();
    if (Number(del.numDeletedRows) === 0) throw new GameError(409, 'not_equipped');
  }
  return view(cfg, it as never, await membership(trx, userId));
}

/** Przełączenie aktywnego zestawu. Rozliczenie przed zmianą: zjazdy i najazdy, które już się skończyły, liczą się na starym zestawie. */
export async function activateLoadoutTx(trx: Trx, ctx: Ctx, userId: string, loadout: number) {
  if (!isLoadoutNo(loadout)) throw new GameError(400, 'invalid_loadout');
  await settle(trx, ctx.config, userId, ctx.now());
  if ((await activeLoadout(trx, userId)) === loadout) throw new GameError(409, 'already_active');
  await trx.updateTable('players').set({ active_loadout: loadout }).where('user_id', '=', userId).execute();
  await trx.insertInto('events_log').values({ user_id: userId, name: 'loadout_activated', props: JSON.stringify({ loadout }) }).execute();
  return { activeLoadout: loadout };
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
  return { ...view(cfg, upd as never, await membership(trx, userId), fx.repair), paid: cost };
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
  if (cost.tech && !(await loadEffects(trx, cfg, userId)).done.has(cost.tech)) throw new GameError(409, 'tech_required');
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
  return { ...view(cfg, upd as never, await membership(trx, userId)), paid: cost };
}

export { walletBalance };
