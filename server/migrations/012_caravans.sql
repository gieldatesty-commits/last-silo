-- karawany: zakupy z rynku sa dostarczane fizycznie (czas i oplata zaleza od dystansu, ryzyko zasadzki)
CREATE TABLE shipments (
  id bigserial PRIMARY KEY,
  buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES users(id) ON DELETE SET NULL,
  trade_id bigint REFERENCES market_trades(id) ON DELETE SET NULL,
  material text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  delivered_qty integer,
  km integer NOT NULL,
  ship_fee bigint NOT NULL DEFAULT 0,
  insurance_fee bigint NOT NULL DEFAULT 0,
  insured boolean NOT NULL DEFAULT false,
  seed integer NOT NULL,
  ambush_chance double precision NOT NULL,
  state text NOT NULL DEFAULT 'transit' CHECK (state IN ('transit', 'delivered', 'ambushed')),
  departed_at timestamptz NOT NULL,
  arrives_at timestamptz NOT NULL
);
CREATE INDEX shipments_due ON shipments (buyer_id, arrives_at) WHERE state = 'transit';
