-- sezony (~180 dni): licznik, wyniki, archiwum ksiegi, bonus startowy do kolejnego sezonu
CREATE TABLE seasons (
  id integer PRIMARY KEY,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'ended')),
  closed_at timestamptz
);

CREATE TABLE season_results (
  season_id integer NOT NULL REFERENCES seasons(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  rank integer NOT NULL,
  players_total integer NOT NULL,
  power integer NOT NULL,
  level integer NOT NULL,
  loot bigint NOT NULL DEFAULT 0,
  title text,
  start_bonus_ore integer NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, user_id)
);
CREATE INDEX season_results_rank ON season_results (season_id, rank);

CREATE TABLE ledger_archive (LIKE ledger_entries, season_id integer NOT NULL);

ALTER TABLE players ADD COLUMN IF NOT EXISTS carry_bonus_ore integer NOT NULL DEFAULT 0 CHECK (carry_bonus_ore >= 0);
