import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

/** Stan subskrypcji po naszej stronie (mapowany z Google Play). Korzyści dają: active, grace, canceled_active. */
export type SubscriptionState = 'active' | 'grace' | 'on_hold' | 'canceled_active' | 'expired' | 'revoked' | 'pending';

// pg zwraca bigint/numeric jako string, double jako number
export interface Database {
  /** guest_secret_hash: tylko zgodność wstecz (migracja 015); sekrety urządzeń są w user_devices */
  users: { id: Generated<string>; guest_secret_hash: string; google_sub: string | null; google_linked_at: Date | null; created_at: Generated<Date> };
  user_devices: { id: Generated<string>; user_id: string; secret_hash: string; created_at: Generated<Date>; last_seen_at: Generated<Date> };
  auth_nonces: { nonce: string; created_at: Date };
  players: {
    user_id: string;
    nickname: string | null;
    archetype: string | null;
    created_at: Generated<Date>;
    level: Generated<number>;
    xp: Generated<string>;
    sila: number | null;
    technika: number | null;
    percepcja: number | null;
    wytrwalosc: number | null;
    free_points: Generated<number>;
    silo_lat: number | null;
    silo_lon: number | null;
    depth: Generated<number>;
    config_version: string | null;
    subscription_until: Date | null;
    radio_on: Generated<boolean>;
    protected_until: Date | null;
    carry_bonus_ore: Generated<number>;
  };
  market_listings: { id: Generated<string>; seller_id: string; material: string; qty: number; qty_initial: number; unit_price: number; state: Generated<'active' | 'sold' | 'cancelled' | 'expired'>; created_at: Generated<Date>; expires_at: Date };
  market_trades: { id: Generated<string>; listing_id: string | null; buyer_id: string | null; bot_trade: Generated<boolean>; seller_id: string; material: string; qty: number; unit_price: number; gross: string | number; fee: Generated<string | number>; created_at: Generated<Date> };
  shipments: { id: Generated<string>; buyer_id: string; seller_id: string | null; trade_id: string | null; material: string; qty: number; delivered_qty: number | null; km: number; ship_fee: string | number; insurance_fee: string | number; insured: boolean; seed: number; ambush_chance: number; state: Generated<'transit' | 'delivered' | 'ambushed'>; departed_at: Date; arrives_at: Date };
  contracts: { id: Generated<string>; user_id: string; day: number; slot: number; material: string; qty: number; km: number; sector: string; unit_reward: number; insured: boolean; insurance_fee: string | number; seed: number; ambush_chance: number; state: Generated<'transit' | 'delivered' | 'ambushed'>; delivered_qty: number | null; reward: string | number | null; accepted_at: Date; arrives_at: Date };
  seasons: { id: number; started_at: Date; ends_at: Date; state: Generated<'active' | 'ended'>; closed_at: Date | null };
  season_results: { season_id: number; user_id: string | null; nickname: string; rank: number; players_total: number; power: number; level: number; loot: Generated<string>; title: string | null; start_bonus_ore: Generated<number> };
  wallets: { user_id: string; resource: string; balance: Generated<string> };
  subscriptions: {
    id: Generated<string>;
    user_id: string;
    provider: Generated<'google_play'>;
    purchase_token: string;
    product_id: string;
    state: SubscriptionState;
    started_at: Date;
    expires_at: Date;
    auto_renewing: Generated<boolean>;
    linked_purchase_token: string | null;
    acknowledged: Generated<boolean>;
    last_synced_at: Date;
    raw: Generated<unknown>;
    created_at: Generated<Date>;
  };
  ledger_entries: {
    id: Generated<string>;
    user_id: string;
    resource: string;
    delta: string | number;
    reason: string;
    ref: string | null;
    config_version: string;
    created_at: Generated<Date>;
  };
  events_log: { id: Generated<string>; user_id: string | null; name: string; props: Generated<unknown>; created_at: Generated<Date> };
  silos: {
    user_id: string;
    steam: number;
    ore_carry: Generated<number>;
    settled_at: Date;
    deposit_total: number;
    deposit_remaining: number;
    seed: string | number;
    winded_until: Date | null;
  };
  dives: {
    id: Generated<string>;
    user_id: string;
    route_id: string;
    started_at: Date;
    ends_at: Date;
    seed: string | number;
    steam_cost: number;
    state: Generated<'active' | 'resolved'>;
    result: unknown | null;
  };
  items: {
    id: Generated<string>;
    user_id: string;
    recipe_id: string;
    slot: string;
    quality: number;
    durability: number;
    max_durability: number;
    equipped: Generated<boolean>;
    tier: Generated<number>;
    created_at: Generated<Date>;
  };
  research: { user_id: string; tech_id: string; state: 'active' | 'done'; ends_at: Date };
  contacts: { user_id: string; target_id: string; created_at: Generated<Date> };
  raids: {
    id: Generated<string>;
    attacker_id: string;
    defender_id: string;
    started_at: Date;
    ends_at: Date;
    seed: string | number;
    steam_cost: number;
    state: Generated<'active' | 'resolved'>;
    result: unknown | null;
  };
  world_pools: { zone: string; resource: string; total: number; remaining: number; regen_at: Generated<Date> };
  buildings: { user_id: string; type: string; level: Generated<number> };
  jobs: {
    id: Generated<string>;
    user_id: string;
    kind: string;
    building_type: string | null;
    to_level: number | null;
    ends_at: Date;
    state: Generated<'pending' | 'done' | 'cancelled'>;
    created_at: Generated<Date>;
  };
  idempotency_keys: { user_id: string; key: string; status: number; response: unknown; created_at: Generated<Date> };
  notifications: {
    id: Generated<string>;
    user_id: string;
    type: string;
    payload: Generated<unknown>;
    created_at: Generated<Date>;
    sent_at: Date | null;
    read_at: Date | null;
  };
}

export type Db = Kysely<Database>;

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString });
  return { db: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), pool };
}
