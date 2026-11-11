-- Subskrypcja „Wygoda” (docs/subskrypcja-v1.0.md §2). Źródłem prawdy jest Google Play; tu jest ostatni pobrany stan.
-- players.subscription_until to pochodny cache liczony wyłącznie przez recomputeSubscription().
-- Tabela NIE jest czyszczona przy resecie sezonu (resetWorld w season.ts jej nie obejmuje).
CREATE TABLE subscriptions (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google_play' CHECK (provider IN ('google_play')),
  -- jeden zakup zasila najwyżej jedno konto
  purchase_token text NOT NULL UNIQUE,
  product_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'grace', 'on_hold', 'canceled_active', 'expired', 'revoked', 'pending')),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  auto_renewing boolean NOT NULL DEFAULT false,
  -- poprzedni token przy zmianie planu / ponownej subskrypcji (z odpowiedzi Google)
  linked_purchase_token text,
  -- czy zakup został potwierdzony w Google (bez potwierdzenia Google zwraca pieniądze po 3 dniach)
  acknowledged boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz NOT NULL,
  -- ostatnia odpowiedź Google, do audytu
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user ON subscriptions (user_id);
-- siatka bezpieczeństwa subscription-sync: wpisy, które mogą zmienić stan
CREATE INDEX subscriptions_sync ON subscriptions (expires_at) WHERE state IN ('active', 'grace', 'on_hold', 'canceled_active', 'pending');
