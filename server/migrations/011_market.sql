-- rynek graczy: wystawienia materialow za rude (kup teraz), historia transakcji (takze sprzedaz botom podlogi cen)
CREATE TABLE market_listings (
  id bigserial PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material text NOT NULL,
  qty integer NOT NULL CHECK (qty >= 0),
  qty_initial integer NOT NULL CHECK (qty_initial > 0),
  unit_price integer NOT NULL CHECK (unit_price > 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'sold', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX market_listings_active ON market_listings (material, unit_price, id) WHERE state = 'active';
CREATE INDEX market_listings_seller ON market_listings (seller_id) WHERE state = 'active';
CREATE INDEX market_listings_expiry ON market_listings (expires_at) WHERE state = 'active';

CREATE TABLE market_trades (
  id bigserial PRIMARY KEY,
  listing_id bigint REFERENCES market_listings(id) ON DELETE SET NULL,
  buyer_id uuid REFERENCES users(id) ON DELETE SET NULL,   -- NULL = bot podlogi cen
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price integer NOT NULL CHECK (unit_price > 0),
  gross bigint NOT NULL,
  fee bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_trades_material_time ON market_trades (material, created_at);
CREATE INDEX market_trades_seller_time ON market_trades (seller_id, created_at);
