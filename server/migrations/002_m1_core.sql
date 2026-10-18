ALTER TABLE players
  ADD COLUMN level int NOT NULL DEFAULT 1,
  ADD COLUMN xp bigint NOT NULL DEFAULT 0,
  ADD COLUMN sila int,
  ADD COLUMN technika int,
  ADD COLUMN percepcja int,
  ADD COLUMN wytrwalosc int,
  ADD COLUMN free_points int NOT NULL DEFAULT 0,
  ADD COLUMN silo_lat double precision,
  ADD COLUMN silo_lon double precision,
  ADD COLUMN depth int NOT NULL DEFAULT 0,
  ADD COLUMN config_version text;
CREATE UNIQUE INDEX players_nickname_ci ON players (lower(nickname));

-- stan silosu: para liczona leniwie, ułamek rudy, ukryte złoże lokalne (nigdy nie wysyłane do klienta)
CREATE TABLE silos (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  steam double precision NOT NULL,
  ore_carry double precision NOT NULL DEFAULT 0,
  settled_at timestamptz NOT NULL,
  deposit_total double precision NOT NULL,
  deposit_remaining double precision NOT NULL,
  seed bigint NOT NULL
);

CREATE TABLE buildings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  level int NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  building_type text,
  to_level int,
  ends_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs (state, ends_at);
CREATE INDEX jobs_user_idx ON jobs (user_id, state);

CREATE TABLE idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz
);

-- idempotentne wpisy w ledgerze: ten sam (gracz, powód, ref) nie wejdzie dwa razy
CREATE UNIQUE INDEX ledger_ref_uniq ON ledger_entries (user_id, reason, ref) WHERE ref IS NOT NULL;
