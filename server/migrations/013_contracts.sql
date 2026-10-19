-- zlecenia karawanowe (NPC): wspolna tablica ofert na doby (deterministyczna), kazda oferta do wziecia przez jednego gracza; w bazie tylko przyjete
CREATE TABLE contracts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day integer NOT NULL,
  slot integer NOT NULL,
  material text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  km integer NOT NULL,
  sector text NOT NULL,
  unit_reward integer NOT NULL,
  insured boolean NOT NULL DEFAULT false,
  insurance_fee bigint NOT NULL DEFAULT 0,
  seed integer NOT NULL,
  ambush_chance double precision NOT NULL,
  state text NOT NULL DEFAULT 'transit' CHECK (state IN ('transit', 'delivered', 'ambushed')),
  delivered_qty integer,
  reward bigint,
  accepted_at timestamptz NOT NULL,
  arrives_at timestamptz NOT NULL,
  UNIQUE (day, slot)
);
CREATE INDEX contracts_due ON contracts (user_id, arrives_at) WHERE state = 'transit';
