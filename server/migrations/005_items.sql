CREATE TABLE items (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id text NOT NULL,
  slot text NOT NULL,
  quality double precision NOT NULL,
  durability integer NOT NULL CHECK (durability >= 0),
  max_durability integer NOT NULL,
  equipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_user ON items (user_id);
CREATE UNIQUE INDEX items_one_equipped_per_slot ON items (user_id, slot) WHERE equipped;
