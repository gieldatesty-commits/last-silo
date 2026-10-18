ALTER TABLE silos ADD COLUMN winded_until timestamptz;

CREATE TABLE dives (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id text NOT NULL,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  seed bigint NOT NULL,
  steam_cost double precision NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'resolved')),
  result jsonb
);
CREATE INDEX dives_user_idx ON dives (user_id, state);
-- co najwyżej jeden aktywny zjazd na gracza (slot); wartość konfigu queue_slots dojdzie z abonamentem
CREATE UNIQUE INDEX dives_one_active ON dives (user_id) WHERE state = 'active';

-- wspólne, ukryte pule stref (nigdy nie wysyłane do klienta)
CREATE TABLE world_pools (
  zone text NOT NULL,
  resource text NOT NULL,
  total double precision NOT NULL,
  remaining double precision NOT NULL,
  PRIMARY KEY (zone, resource)
);
