-- Konto Google (docs/konto-google-v1.0.md): wiele urządzeń na konto, jednorazowe nonce, usuwanie konta bez psucia historii innych graczy.

-- §1: powiązanie z Google (users.google_sub istnieje od 001)
ALTER TABLE users ADD COLUMN google_linked_at timestamptz;

-- §1: każde urządzenie ma własny sekret gościa; logowanie Google na nowym telefonie nie wylogowuje starego
CREATE TABLE user_devices (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_devices_user ON user_devices (user_id);
-- istniejące konta: dotychczasowy sekret staje się pierwszym urządzeniem (users.guest_secret_hash zostaje, ale nie jest już czytany)
INSERT INTO user_devices (user_id, secret_hash, created_at, last_seen_at) SELECT id, guest_secret_hash, created_at, created_at FROM users;

-- §3.2: jednorazowe nonce do tokenu ID Google (TTL w kodzie)
CREATE TABLE auth_nonces (
  nonce text PRIMARY KEY,
  created_at timestamptz NOT NULL
);

-- §2.5: transakcja z botem oznaczona jawnie; dotąd „bot” = buyer_id IS NULL, co po usunięciu kupującego dawało fałszywe transakcje botów
ALTER TABLE market_trades ADD COLUMN bot_trade boolean NOT NULL DEFAULT false;
UPDATE market_trades SET bot_trade = true WHERE buyer_id IS NULL;

-- §2.5: wyniki zamkniętych sezonów zostają po usunięciu konta (zanonimizowane), więc user_id może być NULL
ALTER TABLE season_results DROP CONSTRAINT season_results_pkey;
ALTER TABLE season_results DROP CONSTRAINT season_results_user_id_fkey;
ALTER TABLE season_results ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE season_results ADD CONSTRAINT season_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE season_results ADD PRIMARY KEY (season_id, rank);
CREATE UNIQUE INDEX season_results_season_user ON season_results (season_id, user_id) WHERE user_id IS NOT NULL;
DROP INDEX IF EXISTS season_results_rank;
