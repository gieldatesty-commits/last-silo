import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const stats = z.object({
  sila: z.number().int().min(0),
  technika: z.number().int().min(0),
  percepcja: z.number().int().min(0),
  wytrwalosc: z.number().int().min(0),
});

export const BUILDING_TYPES = ['szyb_glowny', 'generator_pary', 'magazyn', 'warsztat', 'wartownia', 'laboratorium', 'radiostacja'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

const pos = z.number().positive();

export const GameConfigSchema = z
  .object({
    version: z.string().min(1),
    resources: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
    economy: z.object({
      start_ore: z.number().int().min(0),
      deposit: z.object({
        local_total: pos,
        variance: z.number().min(0).max(0.9),
        floor_fraction: z.number().min(0.01).max(0.5),
      }),
    }),
    progression: z.object({ xp_base: pos, xp_exp: pos, max_level: z.number().int().min(2), points_per_level: z.number().int().min(0) }),
    dives: z.object({
      // subscriber_extra_max_seconds: sloty ponad `free` przyjmują tylko trasy nie dłuższe niż ta wartość (wygoda, nie dochód)
      queue_slots: z.object({ free: z.number().int().min(1), subscriber: z.number().int().min(1), subscriber_extra_max_seconds: z.number().int().min(0) }),
      fail_reward_fraction: z.number().min(0).max(1),
      winded_seconds: z.number().min(0),
      pool_floor_fraction: z.number().min(0.01).max(0.5),
      economy: z.object({
        ore_per_min: pos,
        xp_per_min: pos,
        short_bonus: z.number().min(0).max(1),
        reference_minutes: pos,
        min_route_minutes: pos,
        spread: z.number().min(0).max(0.9),
      }),
      zones: z.record(z.string(), z.object({ name: z.string(), pool_per_player: pos, regen_per_day: z.number().min(0).max(0.2).default(0) })),
      routes: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            zone: z.string(),
            min_level: z.number().int().min(1),
            seconds: pos,
            steam: pos,
            difficulty: pos,
            tokens: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
            samples: z.tuple([z.number().int().min(0), z.number().int().min(0)]).default([0, 0]),
            reward_mult: pos.default(1),
          }),
        )
        .min(1),
    }),
    items: z.object({
      inventory_max: z.number().int().min(1),
      repair_cost_fraction: z.number().min(0).max(2),
      quality: z.object({ min: pos, max: pos, min_step: z.number().min(0), max_step: z.number().min(0) }),
      slots: z.array(z.string()).min(1),
      // dwa zestawy (docs/ekwipunek-v1.0.md §3): obrona silosu = obrona aktywnego + ta część obrony drugiego
      loadouts: z.object({ passive_defense_share: z.number().min(0).max(1) }),
      upgrade: z.object({
        max_tier: z.number().int().min(1).max(10),
        workshop_base: z.number().int().min(1),     // poziom Warsztatu wymagany do tieru t = workshop_base + t
        radio: z.number().int().min(1),             // minimalny poziom Radiostacji
        ore_fraction: pos,                          // koszt rudy tieru 1 = ore receptury × ore_fraction
        growth: pos,                                // mnożnik kosztu rudy na kolejny tier
        tokens_per_tier: z.number().int().min(0),
        materials_per_tier: z.record(z.string(), z.number().int().min(0)),
        bonus_per_tier: z.number().min(0).max(1),   // +X% bonusu przedmiotu za tier
        repair_per_tier: z.number().min(0).max(2),  // +X% kosztu naprawy za tier
        // tiery powyżej 5 (docs/ekwipunek-v1.0.md §4.2): ruda = koszt(5) × growth_high^(t−5), od `from` wymagane badanie `tech`
        growth_high: pos.default(1),
        high_tiers: z.array(z.object({ from: z.number().int().min(2), tech: z.string() })).default([]),
      }),
      // rzadkość przy wytwarzaniu (§4.1): kolejność = progi losowania; suma szans = 1
      rarity: z
        .array(z.object({ id: z.string(), name: z.string(), chance: z.number().min(0).max(1), mult: pos, sockets: z.number().int().min(0).max(6) }))
        .min(1)
        .refine((rs) => Math.abs(rs.reduce((a, r) => a + r.chance, 0) - 1) < 1e-9, { message: 'items.rarity: suma szans musi wynosić 1' }),
      recipes: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slot: z.string(),
          workshop: z.number().int().min(1),
          ore: z.number().int().min(0),
          tokens: z.number().int().min(0),
          bonus: z.number().min(0),                  // moc zjazdu
          attack: z.number().min(0).default(0),      // atak w najazdach
          defense: z.number().min(0).default(0),     // obrona silosu
          durability: z.number().int().min(1),
          tech: z.string().optional(),
          radio: z.number().int().min(1).optional(),
          materials: z.record(z.string(), z.number().int().min(1)).default({}),
        }),
      ),
    }),
    research: z.object({
      lab_time_step: z.number().min(0).max(0.1),
      techs: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          branch: z.string(),
          lab: z.number().int().min(1),
          ore: z.number().int().min(0),
          tokens: z.number().int().min(0),
          samples: z.number().int().min(0).default(0),
          radio: z.number().int().min(1).optional(),
          materials: z.record(z.string(), z.number().int().min(1)).default({}),
          seconds: pos,
          requires: z.array(z.string()).default([]),
          unlocks: z.array(z.string()).default([]),
          effect: z
            .object({
              dive_ore_pct: z.number().optional(),
              dive_steam_pct: z.number().optional(),
              dive_power: z.number().optional(),
              quality: z.number().optional(),
              repair_pct: z.number().optional(),
              upgrade_cost_pct: z.number().optional(),
              winded_pct: z.number().optional(),
              samples_pct: z.number().optional(),
            })
            .default({}),
        }),
      ),
    }),
    geology: z.object({
      materials: z.array(z.string()).min(3),
      richness: z.object({ main: pos, secondary: pos, trace: pos }),
      mat_per_hour: pos,
      min_route_level: z.number().int().min(1),
      local_variance: z.number().min(0).max(0.9),
      field_frequency: pos,
      field_seed: z.number().int(),
    }),
    market: z.object({
      radio: z.number().int().min(1),               // minimalny poziom Radiostacji do handlu
      min_level: z.number().int().min(1),           // minimalny poziom gracza (anty-multikonta)
      fee: z.number().min(0).max(0.5),              // prowizja od sprzedaży (ujście rudy)
      listing_hours: z.number().positive(),         // wygasanie wystawień
      max_active: z.number().int().min(1),          // aktywne wystawienia na gracza
      max_qty: z.number().int().min(1),             // maksymalna ilość w jednym wystawieniu
      bot_bid_fraction: z.number().min(0).max(1),   // bot podłogi cen kupuje po tej części ceny NPC; to dolna granica cen
      bot_daily_qty: z.number().int().min(0),       // ile sztuk na dobę gracz może sprzedać botom
    }),
    caravans: z.object({
      speed_km_per_h: pos,
      min_minutes: pos,
      max_minutes: pos,
      fee_per_1000km: z.number().min(0).max(1),   // opłata za sztukę = cena NPC × to × km/1000 (ujście rudy)
      fee_cap: z.number().min(0).max(2),          // opłata za sztukę nie przekroczy tej części ceny NPC
      insurance_fee: z.number().min(0).max(1),    // ubezpieczenie: część wartości towaru
      max_active: z.number().int().min(1),        // przesyłki w drodze na kupującego
      ambush: z.object({ base: z.number().min(0).max(1), per_1000km: z.number().min(0).max(1), max: z.number().min(0).max(1), loss_fraction: z.number().min(0).max(1) }),
    }),
    contracts: z.object({
      radio: z.number().int().min(1),
      min_level: z.number().int().min(1),
      offers_per_player: z.number().min(0).max(5),    // wspólna tablica: oferty na dobę = max(min_offers, ceil(gracze × to)); każda do wzięcia przez jednego gracza
      min_offers: z.number().int().min(1),
      seed: z.number().int(),
      max_active: z.number().int().min(1),            // zlecenia w drodze jednocześnie
      qty: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
      km: z.tuple([z.number().int().min(500), z.number().int().min(500)]),   // dystans do faktorii (pasma 500 km)
      reward_base: pos,                               // nagroda za sztukę = cena NPC × (base + per_1000km × km/1000)
      reward_per_1000km: z.number().min(0),
    }),
    season: z.object({
      length_days: z.number().int().min(1),
      intermission_hours: z.number().min(0),
      max_bonus_ore: z.number().int().min(0),     // twardy limit bonusu startowego (wygoda, nie przewaga)
      rewards: z
        .array(z.object({ id: z.string(), name: z.string(), max_rank: z.number().int().min(1).optional(), top_percent: z.number().min(0).max(100).optional(), min_level: z.number().int().min(1).default(1), start_bonus_ore: z.number().int().min(0) }))
        .min(1),
    }),
    exchange: z.object({ radio: z.number().int().min(1), buy_ore: z.record(z.string(), pos) }),
    // subskrypcja „Wygoda”: produkty Google Play przyjmowane przez serwer; korzyści to wyłącznie wygoda (sloty w dives.queue_slots)
    subscription: z.object({
      product_ids: z.array(z.string().min(1)).min(1),
      perks: z.array(z.string().min(1)).default([]),
      sync_lookahead_hours: pos,
    }),
    codex: z.array(z.object({ id: z.string(), tech: z.string(), title: z.string(), text: z.string() })),
    radio: z.object({
      levels: z.object({ receiver: z.number().int().min(1), transmitter: z.number().int().min(1), cipher: z.number().int().min(1), relays: z.number().int().min(1) }),
      r0_km: pos,
      range_growth: pos,
      cipher_range_reduction: z.number().min(0).max(0.9),
      contact_steam: z.number().min(0),
      distance_band_km: pos,
      speed_km_per_min: pos,
      travel_min: pos,
      travel_max: pos,
    }),
    raids: z.object({
      min_level: z.number().int().min(1),
      beginner_protection_level: z.number().int().min(0),
      steam: pos,
      league_tolerance: z.number().min(0).max(5),
      loot_fraction: z.number().min(0).max(0.5),
      loot_cap_ore: z.number().int().min(0),
      loot_cap_tokens: z.number().int().min(0),
      protection_minutes: z.number().min(0),
      same_target_cooldown_minutes: z.number().min(0),
      same_target_per_day: z.number().int().min(1),
      attacker_per_day: z.number().int().min(1),
      xp_win: z.number().int().min(0),
      xp_loss: z.number().int().min(0),
      defender_xp_win: z.number().int().min(0),
    }),
    world: z.object({
      expected_players: pos,
      radius_km: pos,
      min_silo_distance_km: z.number().min(0),
      placement_candidates: z.number().int().min(1).max(500),
    }),
    upgrades: z.object({
      max_level: z.number().int().min(2).max(50),
      max_level_by_building: z.record(z.string(), z.number().int().min(2).max(50)).default({}),
      cost_growth: pos,
      time_base_seconds: pos,
      time_growth: pos,
      queue_slots: z.number().int().min(1),
    }),
    effects: z.object({
      ore_per_hour: z.object({ base: pos, growth: pos }),
      steam: z.object({ cap_base: pos, cap_step: z.number().min(0), regen_base: pos, regen_step: z.number().min(0) }),
      warehouse: z.object({ cap_base: pos, cap_growth: pos, protected_step: z.number().min(0), protected_max: z.number().min(0).max(1) }),
      watchtower: z.object({ defense_step: z.number().min(0) }),
    }),
    buildings: z.array(z.object({ id: z.enum(BUILDING_TYPES), name: z.string(), base_cost: pos })),
    archetypes: z
      .array(z.object({ id: z.string(), name: z.string(), stats, upgrade_cost_multiplier: pos.default(1), dive_ore_multiplier: pos.default(1), dive_steam_multiplier: pos.default(1) }))
      .min(1),
  })
  .superRefine((cfg, ctx) => {
    for (const r of cfg.dives.routes) if (!cfg.dives.zones[r.zone]) ctx.addIssue({ code: 'custom', message: `trasa ${r.id}: nieznana strefa ${r.zone}` });
    for (const key of ['resources', 'archetypes', 'buildings'] as const) {
      const ids = cfg[key].map((x) => x.id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', message: `duplikaty id w ${key}` });
      }
    }
    for (const r of cfg.items.recipes) if (!cfg.items.slots.includes(r.slot)) ctx.addIssue({ code: 'custom', message: `receptura ${r.id}: nieznany slot ${r.slot}` });
    const recipeIdList = cfg.items.recipes.map((r) => r.id);
    if (new Set(recipeIdList).size !== recipeIdList.length) ctx.addIssue({ code: 'custom', message: 'duplikaty id receptur' });
    const resourceIds = new Set(cfg.resources.map((r) => r.id));
    for (const m of cfg.geology.materials) if (!resourceIds.has(m)) ctx.addIssue({ code: 'custom', message: `geologia: brak zasobu ${m}` });
    for (const m of cfg.geology.materials) if (!cfg.exchange.buy_ore[m]) ctx.addIssue({ code: 'custom', message: `wymiana: brak ceny ${m}` });
    for (const x of [...cfg.items.recipes, ...cfg.research.techs]) for (const m of Object.keys(x.materials)) if (!cfg.geology.materials.includes(m)) ctx.addIssue({ code: 'custom', message: `${x.id}: nieznany materiał ${m}` });
    const tids = new Set(cfg.research.techs.map((t) => t.id));
    if (tids.size !== cfg.research.techs.length) ctx.addIssue({ code: 'custom', message: 'duplikaty id badań' });
    for (const c of cfg.codex) if (!tids.has(c.tech)) ctx.addIssue({ code: 'custom', message: `kodeks ${c.id}: nieznane badanie ${c.tech}` });
    const recipeIds = new Set(cfg.items.recipes.map((r) => r.id));
    for (const t of cfg.research.techs) {
      for (const q of t.requires) if (!tids.has(q)) ctx.addIssue({ code: 'custom', message: `badanie ${t.id}: nieznany wymóg ${q}` });
      for (const u of t.unlocks) if (!recipeIds.has(u)) ctx.addIssue({ code: 'custom', message: `badanie ${t.id}: nieznana receptura ${u}` });
    }
    for (const r of cfg.items.recipes) if (r.tech && !tids.has(r.tech)) ctx.addIssue({ code: 'custom', message: `receptura ${r.id}: nieznane badanie ${r.tech}` });
    for (const r of cfg.season.rewards) {
      if (r.max_rank === undefined && r.top_percent === undefined) ctx.addIssue({ code: 'custom', message: `sezon: nagroda ${r.id} bez max_rank/top_percent` });
      if (r.start_bonus_ore > cfg.season.max_bonus_ore) ctx.addIssue({ code: 'custom', message: `sezon: bonus ${r.id} powyżej max_bonus_ore` });
    }
    const have = new Set(cfg.buildings.map((b) => b.id));
    for (const t of BUILDING_TYPES) {
      if (!have.has(t)) ctx.addIssue({ code: 'custom', message: `brak budynku ${t} w configu` });
    }
  });

export type GameConfig = z.infer<typeof GameConfigSchema>;

export function parseGameConfig(yamlText: string): GameConfig {
  return GameConfigSchema.parse(parse(yamlText));
}

export function loadGameConfig(path: string): GameConfig {
  return parseGameConfig(readFileSync(path, 'utf8'));
}
