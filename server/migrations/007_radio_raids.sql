ALTER TABLE players ADD COLUMN radio_on boolean NOT NULL DEFAULT true;
ALTER TABLE players ADD COLUMN protected_until timestamptz;
INSERT INTO buildings (user_id, type, level) SELECT user_id, 'radiostacja', 1 FROM players WHERE archetype IS NOT NULL ON CONFLICT DO NOTHING;

CREATE TABLE contacts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE raids (
  id bigserial PRIMARY KEY,
  attacker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  defender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  seed bigint NOT NULL,
  steam_cost integer NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','resolved')),
  result jsonb
);
CREATE INDEX raids_attacker ON raids (attacker_id, started_at);
CREATE INDEX raids_defender ON raids (defender_id, started_at);
CREATE INDEX raids_active ON raids (ends_at) WHERE state = 'active';
CREATE UNIQUE INDEX raids_one_active_per_attacker ON raids (attacker_id) WHERE state = 'active';
