-- kolejka zjazdów: wiele aktywnych (trwający + oczekujące) na gracza; limit w kodzie (2 / 3 z abonamentem)
DROP INDEX IF EXISTS dives_one_active;
ALTER TABLE players ADD COLUMN subscription_until timestamptz;
