CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_secret_hash text NOT NULL,
  google_sub text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE players (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname text UNIQUE,
  archetype text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- wallets to cache; źródłem prawdy jest ledger_entries
CREATE TABLE wallets (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource text NOT NULL,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (user_id, resource)
);

CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource text NOT NULL,
  delta bigint NOT NULL,
  reason text NOT NULL,
  ref text,
  config_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON ledger_entries (user_id, created_at);

CREATE TABLE events_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_name_idx ON events_log (name, created_at);
