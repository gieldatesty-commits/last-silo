-- Ekwipunek etap 1 (docs/ekwipunek-v1.0.md §3): dwa zestawy zamiast flagi `items.equipped`,
-- zrzuty mocy zestawu przy dodaniu zjazdu i wysłaniu najazdu.
CREATE TABLE loadouts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loadout smallint NOT NULL CHECK (loadout IN (1, 2)),
  slot text NOT NULL,
  item_id bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, loadout, slot)
);
CREATE INDEX loadouts_item ON loadouts (item_id);
INSERT INTO loadouts (user_id, loadout, slot, item_id) SELECT user_id, 1, slot, id FROM items WHERE equipped;
DROP INDEX items_one_equipped_per_slot;
ALTER TABLE items DROP COLUMN equipped;
ALTER TABLE players ADD COLUMN active_loadout smallint NOT NULL DEFAULT 1 CHECK (active_loadout IN (1, 2));
ALTER TABLE dives ADD COLUMN loadout smallint, ADD COLUMN item_bonus double precision;
ALTER TABLE raids ADD COLUMN attack_power double precision, ADD COLUMN attacker_loadout smallint;
