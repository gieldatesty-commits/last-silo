-- regeneracja wspólnych pul stref: leniwie, z czasu ostatniej regeneracji
ALTER TABLE world_pools ADD COLUMN IF NOT EXISTS regen_at timestamptz NOT NULL DEFAULT now();
