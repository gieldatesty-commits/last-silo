-- ulepszanie przedmiotów (poziom wzmocnienia 0..max_tier)
ALTER TABLE items ADD COLUMN IF NOT EXISTS tier integer NOT NULL DEFAULT 0 CHECK (tier >= 0);
