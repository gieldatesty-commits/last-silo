-- Ekwipunek etap 2 (docs/ekwipunek-v1.0.md §4.1): rzadkość losowana przy wytwarzaniu z zapisanego ziarna; stare przedmioty: zwykłe, bez ziarna
ALTER TABLE items ADD COLUMN rarity text NOT NULL DEFAULT 'zwykly', ADD COLUMN seed bigint;
