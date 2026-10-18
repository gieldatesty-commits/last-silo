import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';

// pg zwraca bigint/numeric jako string, double jako number
export interface Database {
  users: { id: Generated<string>; guest_secret_hash: string; google_sub: string | null; created_at: Generated<Date> };
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
  };
  wallets: { user_id: string; resource: string; balance: Generated<string> };
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
  world_pools: { zone: string; resource: string; total: number; remaining: number };
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
