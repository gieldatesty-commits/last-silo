import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export interface Database {
  users: {
    id: string;
    guest_secret_hash: string;
    google_sub: string | null;
    created_at: Date;
  };
  players: {
    user_id: string;
    nickname: string | null;
    archetype: string | null;
    created_at: Date;
  };
  wallets: {
    user_id: string;
    resource: string;
    balance: string; // bigint z pg jako string
  };
  ledger_entries: {
    id: string;
    user_id: string;
    resource: string;
    delta: string;
    reason: string;
    ref: string | null;
    config_version: string;
    created_at: Date;
  };
  events_log: {
    id: string;
    user_id: string | null;
    name: string;
    props: unknown;
    created_at: Date;
  };
}

export type Db = Kysely<Database>;

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString });
  return { db: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), pool };
}
