# Ekwipunek etap 3: runy — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runy jako zasoby w portfelu: wytwarzane w Warsztacie (poziomy I–II), łup ze zjazdów (poziom III), osadzane w gniazdach przedmiotu (liczba gniazd z rzadkości) i wyjmowane za opłatą w rudzie; stały bonus do profilu (zjazd/atak/obrona) albo zniżka napraw.

**Architecture:** Czyste funkcje w nowym `src/game/runes.ts` (id run, bonus, koszt wytwarzania, opłata za wyjęcie, losowanie łupu z osobnego strumienia ziarna zjazdu). Migracja 018: tabela `item_runes`. Serwis `src/services/runes.ts` (wytwarzanie, osadzanie, wyjmowanie) przez `applyLedger`. Bonus run trafia do profilu w jednym miejscu (`itemProfileWithRunes`, używane przez `gear.loadoutProfile` i widok przedmiotu), więc zrzuty zjazdów i najazdy dostają go bez zmian. Łup runy w `resolveDueDives`.

**Tech Stack:** Node 22, TypeScript ESM, Fastify 5, Kysely, PostgreSQL 16, zod 4, vitest; Flutter.

**Spec:** `docs/ekwipunek-v1.0.md` §5 (i §8 etap 3).

## Global Constraints
- Balans tylko w `config/game.yaml`, wersja `1.8.0`. Startowe liczby (spec §5): bonusy Żyły 0,2/0,4/0,7 (zjazd), Ostrza 0,3/0,6/1,0 (atak), Bastionu 0,3/0,6/1,0 (obrona), Trwałości −5/−10/−18% kosztu napraw, łącznie najwyżej −40% (`repair_cap: 0.4`); wytwarzanie I: Warsztat 3, Radio 5, 300 rudy, 0 żet., 8 materiału; II: Warsztat 6, Radio 5, 1200 rudy, 10 żet., 25 materiału; materiał: Żyły miedź, Ostrza siarka, Bastionu kryształ, Trwałości po ⌈n/3⌉ z każdego; opłata za wyjęcie I/II/III: 100/400/1000 rudy; łup III: `szansa = drop.base × (minuty trasy / drop.reference_minutes) × drop.zone_mult[strefa]`, start `base 0.02`, `reference_minutes 480`, `zone_mult { gorne: 0.5, glebokie: 1.0, jadro: 1.5 }`; rodzaj losowany równo.
- Id runy: `runa_{rodzaj}_{poziom}` (np. `runa_zyly_1`); rodzaje: `zyly`, `ostrza`, `bastionu`, `trwalosci`. Runy są zasobami w portfelu: każdy ruch przez `applyLedger`, `npm run audit` = 0.
- Nowe powody w dzienniku: `rune_craft` (+1 runa), `rune_craft_cost`, `rune_socket` (−1), `rune_unsocket` (+1), `rune_unsocket_fee` (ruda). Łup: `dive_reward` z ref `dive:{id}:rune`.
- Losowość: łup runy z **osobnego strumienia** `rng((seed ^ RUNE_SALT) >>> 0)` (stała `RUNE_SALT` w kodzie nie jest liczbą gry) — istniejące wyniki zjazdu (ruda, żetony, próbki, materiały) dla tego samego ziarna bez zmian (test wektorowy).
- Bonus runy jest stały (nie mnożony przez jakość/tier/rzadkość). Zepsuty przedmiot nie daje nic, także run.
- Każda akcja: `Idempotency-Key`, `settle()` najpierw, blokada przedmiotu `FOR UPDATE`. Błędy: `no_socket` (gniazdo spoza zakresu rzadkości), `socket_taken`, `socket_empty`, `unknown_rune`, `rune_not_craftable` (poziom III), `workshop_too_low`, `radio_too_low`, `insufficient_{runeId}` / `insufficient_ore`.
- Migracja `018_item_runes.sql`; FK `item_id → items ON DELETE CASCADE` (koniec sezonu czyści razem z przedmiotami; `TRUNCATE` w `season.ts` musi objąć `item_runes`).
- Kryteria symulacji (§8): zjazdy głównym źródłem dochodu; łupy bez skoku względem 1.7.0 (10,3–10,9%); ruda nie zalega; pierwszy tier 10 u hardcore nie wcześniej niż dzień 120. Niespełnione → STOP, liczby do Damiana.
- Przed commitem: `npm run typecheck`, `npx vitest run`; w `client/` `flutter analyze` + `flutter test`.

## Review Focus
1. Ten sam `seed` zjazdu: ruda, żetony, próbki, materiały identyczne jak przed etapem 3 (łup runy z osobnego strumienia) — test w Task 1.
2. Osadzenie w przedmiocie bez gniazd (rzadkość zwykła) albo w gnieździe ≥ liczby gniazd: 409 `no_socket`, portfel bez zmian — test w Task 3.
3. Wyjęcie runy przy braku rudy na opłatę: 402 `insufficient_ore`, runa zostaje w przedmiocie — test w Task 3.
4. Zepsuty przedmiot z runami: profil zestawu bez bonusu run; po naprawie bonus wraca — test w Task 3.
5. Koniec sezonu: `item_runes` puste, runy w portfelu wyczyszczone (portfele) — test w Task 2.

---

### Task 1: Config 1.8.0 i czyste funkcje run

**Files:** Modify `server/src/config.ts`, `config/game.yaml`; Create `server/src/game/runes.ts`; Test `server/test/game.test.ts`.

**Interfaces (Produces, `src/game/runes.ts`):**
- `RUNE_KINDS` z configu: `cfg.runes.kinds: [{ id, name, effect: 'dive'|'attack'|'defense'|'repair_pct', values: [n,n,n], material: string|'mix' }]`.
- `runeId(kind: string, level: 1|2|3): string`; `parseRune(cfg, id): { kind, level, effect, value, name } | null`; `allRuneIds(cfg): string[]` (12).
- `runesProfile(cfg, ids: string[]): Profile` (suma stałych bonusów; `repair_pct` nie wchodzi do profilu).
- `runesRepairMult(cfg, ids: string[]): number` = `1 − min(repair_cap, Σ|repair_pct|/100)`.
- `runeCraftCost(cfg, id): { ore, tokens, materials: Record<string, number>, workshop, radio } | null` (null dla poziomu III).
- `unsocketFee(cfg, id): number`.
- `rollRuneDrop(cfg, route: { seconds: number; zone: string }, seed: number): string | null` — `rng((seed ^ RUNE_SALT) >>> 0)`: 1. liczba vs szansa, 2. rodzaj.

- [ ] **Step 1: Testy** — `allRuneIds` = 12; `parseRune('runa_ostrza_2')` → attack 0,6; `runesProfile(['runa_zyly_1','runa_zyly_3'])` → dive 0,9; `runesRepairMult` dla 3× `runa_trwalosci_3` = 0,6 (cap 40%); `runeCraftCost('runa_trwalosci_2')` → materiały po ⌈25/3⌉ = 9 z miedź/kryształ/siarka; `runeCraftCost('runa_zyly_3')` = null; `unsocketFee` 100/400/1000; `rollRuneDrop` deterministyczny dla ziarna, częstość na 20 000 ziaren dla trasy 480 min w strefie `jadro` ≈ 0,03 (± 0,005); **wektor**: `resolveDive(..., seed)` daje identyczny wynik przed i po (porównanie z wartością zapisaną w teście na commicie bazowym — przed implementacją policzyć i wpisać).
- [ ] **Step 2:** RED. **Step 3:** schemat zod (`runes` + walidacja: `material` ∈ materiały geologii lub `mix`, 3 wartości), config 1.8.0, `runes.ts`. **Step 4:** `typecheck` + `vitest` PASS. **Step 5:** Commit `Ekwipunek: runy w configu (1.8.0) i czyste funkcje`.

### Task 2: Migracja 018, powody w dzienniku, wytwarzanie run

**Files:** Create `server/migrations/018_item_runes.sql`, `server/src/services/runes.ts`; Modify `server/src/db.ts`, `server/src/ledger.ts` (powody), `server/src/app.ts` (`POST /runes/:id/craft`), `server/src/services/items.ts` (`GET /items` += `runes: {runeId: n}` z portfela i `runeRecipes: [{ id, kind, level, name, effect, value, ore, tokens, materials, workshop, radio, locked }]`), `server/src/services/season.ts`; Test `server/test/runes.test.ts` (nowy, wzorem `items.test.ts`).

```sql
CREATE TABLE item_runes (
  item_id bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  socket smallint NOT NULL CHECK (socket >= 0),
  rune_id text NOT NULL,
  PRIMARY KEY (item_id, socket)
);
```
- [ ] Testy: wytworzenie `runa_zyly_1` (Warsztat 3, Radio 5): koszt w dzienniku, +1 runa w portfelu, idempotencja, `workshop_too_low`, `radio_too_low`, `insufficient_miedz`, `rune_not_craftable` dla poziomu III, `unknown_rune`; `auditLedger` = []; `GET /items` pokazuje portfel run i receptury; koniec sezonu: `item_runes` puste (test w `season.test.ts`).
- [ ] RED → implementacja → PASS → commit `Ekwipunek: wytwarzanie run (migracja 018)`.

### Task 3: Osadzanie, wyjmowanie, bonus run w profilu i naprawie

**Files:** Modify `server/src/services/runes.ts` (`socketTx`, `unsocketTx`), `server/src/app.ts` (`POST /items/:id/runes` `{socket, rune}`, `POST /items/:id/runes/:socket/remove`), `server/src/game/upgrade.ts` lub `gear.ts` (`itemProfileWithRunes`), `server/src/services/gear.ts` (`loadoutProfile` z runami), `server/src/services/items.ts` (widok: `sockets`, `runes: [{socket, runeId, name}]`, profil z runami, koszt naprawy × `runesRepairMult`; `repairTx` też); Test `server/test/runes.test.ts`.
- [ ] Testy: osadzenie w gnieździe 0 przedmiotu „solidnego” (1 gniazdo): −1 runa, profil +bonus, `loadoutStats` +bonus; `no_socket` dla zwykłego i dla gniazda 1; `socket_taken`; `insufficient_runa_*`; wyjęcie: opłata w rudzie, +1 runa, gniazdo puste; `socket_empty`; brak rudy → 402 i runa zostaje; zepsuty przedmiot: bez bonusu run w `loadoutStats`, po naprawie wraca; Trwałości obniża `repairCost` (i pobranie w `repairTx`); zrzut zjazdu uwzględnia runę (`dives.item_bonus`); audyt 0.
- [ ] RED → implementacja → PASS → commit `Ekwipunek: osadzanie i wyjmowanie run, bonus w profilu i naprawach`.

### Task 4: Łup run poziomu III ze zjazdów

**Files:** Modify `server/src/services/silo.ts` (`resolveDueDives`: po sukcesie `rollRuneDrop`, wpis `dive_reward` z ref `dive:{id}:rune`, `result.rune`), widok historii zjazdów (`/dives/history`: `rune`); Test `server/test/runes.test.ts`.
- [ ] Testy: ziarno dobrane tak, by `rollRuneDrop` dał runę (szukanie w pętli jak `findSeed` w `m2.test.ts`): po rozliczeniu +1 runa III w portfelu, `result.rune`, historia ją pokazuje; porażka zjazdu = brak runy nawet przy „trafionym” ziarnie; ponowne rozliczenie nie dubluje (ref); audyt 0.
- [ ] RED → implementacja → PASS → commit `Ekwipunek: runy poziomu III z łupu zjazdów`.

### Task 5: Symulacja i wyniki w specu

**Files:** Modify `server/src/sim/world-sim.ts`, `docs/ekwipunek-v1.0.md` (§10.3).
- [ ] Model: łup run III z `rollRuneDrop`; wytwarzanie run I–II, gdy przedmiot w zestawie ma wolne gniazdo i stać z zapasem (hardcore: zapas ×2, regularni ×4, okazjonalni nie wytwarzają); osadzanie w najlepszym przedmiocie zestawu (Żyły do zestawu I, Ostrza/Bastionu do II); profil z run w `setProfile`; Trwałości pomijane w modelu (opisać). Raport: run wytworzonych/z łupu, osadzonych, wydatki na runy (% dochodu), materiały zużyte na runy.
- [ ] 3 ziarna przed (wyniki 1.7.0 z §10.2) i po; kryteria z Global Constraints; niespełnione → STOP.
- [ ] §10.3 + commit `Symulacja: runy; wyniki etapu 3`.

### Task 6: Makieta run w Warsztacie (bramka przed kodem klienta)

- [ ] W artefakcie Design (`https://claude.ai/artifact/4uLiaBVPYtTnnFZRjrturM`) nowy artboard `WarsztatRuny.dc.html` obok `WarsztatZestawy.dc.html`: gniazda na karcie przedmiotu (puste/zajęte, nazwa runy słowem), arkusz wyboru runy z portfela, potwierdzenie wyjęcia z opłatą, sekcja „Runy” (portfel + wytwarzanie I–II z kosztami), runa III w historii zjazdów. Pokazać Damianowi i **czekać na akceptację**.

### Task 7: Klient — runy

**Files:** Modify `client/lib/screens/workshop_screen.dart` (gniazda, arkusz wyboru, wyjmowanie z potwierdzeniem, filtr/sekcja „Runy”), `client/lib/screens/dives_screen.dart` (runa w historii), `client/lib/strings.dart` (nazwy run, błędy), `client/lib/resource_art.dart` (ikona runy, jeśli potrzebna — inaczej znak); Test `client/test/runes_test.dart`, fikstury z prawdziwego API (skrypt fikstur ze scratchpada).
- [ ] Testy: karta przedmiotu „solidnego” pokazuje 1 gniazdo „puste” (Semantics „gniazdo 1: puste”); stuknięcie → arkusz z runami z portfela → POST `/items/{id}/runes` `{socket: 0, rune}`; gniazdo zajęte pokazuje nazwę runy i „Wyjmij · 100 rudy” → potwierdzenie → POST `.../runes/0/remove`; sekcja „Runy”: wytworzenie wysyła `/runes/{id}/craft`, poziom III oznaczony „tylko z łupu”; 320×640 ×1,5 bez przepełnień i uciętego tekstu; komunikaty błędów po polsku.
- [ ] RED → implementacja (wg makiety) → PASS → emulator (osadzenie, wyjęcie, wytworzenie, porównanie z `curl GET /items`) → commit `Klient: runy w Warsztacie i łup run w Zjazdach`.
