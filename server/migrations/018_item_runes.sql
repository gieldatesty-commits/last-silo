-- Ekwipunek etap 3 (docs/ekwipunek-v1.0.md §5.4): runy osadzone w gniazdach przedmiotu; znikają razem z przedmiotem
CREATE TABLE item_runes (
  item_id bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  socket smallint NOT NULL CHECK (socket >= 0),
  rune_id text NOT NULL,
  PRIMARY KEY (item_id, socket)
);
