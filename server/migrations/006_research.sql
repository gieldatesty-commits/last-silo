CREATE TABLE research (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tech_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active','done')),
  ends_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, tech_id)
);
CREATE UNIQUE INDEX research_one_active ON research (user_id) WHERE state = 'active';
-- istniejący gracze dostają Laboratorium na poziomie 1
INSERT INTO buildings (user_id, type, level) SELECT user_id, 'laboratorium', 1 FROM players WHERE archetype IS NOT NULL ON CONFLICT DO NOTHING;
