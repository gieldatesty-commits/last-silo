# Ekwipunek etap 4: komplety — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Komplety przedmiotów (Sztygar, Rdzeń, Wartownik): bonus za 2 i 4 założone, niezepsute części w jednym zestawie; działa w zjazdach (ze zrzutem), najazdach, obronie silosu i naprawach.

**Architecture:** Czysta funkcja `setBonuses(cfg, recipeIds)` w nowym `src/game/sets.ts`. `gear.loadoutProfile` dolicza `dive_power`/`attack`/`defense` kompletów, więc zrzut zjazdu, najazdy i `siloDefense` dostają je bez zmian. `dive_ore_pct` kompletu potrzebuje własnego zrzutu: migracja 019 dodaje `dives.set_ore_pct` (zapis przy dodaniu, rozliczenie `min(zrzut, teraz)` jak moc). `repair_pct` obniża koszt naprawy przedmiotów należących do zestawu z aktywnym bonusem.

**Tech Stack:** Node 22, TypeScript ESM, Fastify 5, Kysely, PostgreSQL 16, zod 4, vitest; Flutter.

**Spec:** `docs/ekwipunek-v1.0.md` §6 (i §8 etap 4, §10.3 uwaga o zapasie łupów).

## Global Constraints
- Balans w `config/game.yaml`, wersja `1.9.0`. Komplety startowo jak w §6: Sztygar (mlot_pneumatyczny, helm_wzmocniony, lampa_wibracyjna, detektor_zylowy) 2: `dive_ore_pct 5`, 4: `dive_power 0.8`; Rdzeń (wiertlo_rdzeniowe, kombinezon_izolowany, lampa_rezonansowa, skaner_sejsmiczny) 2: `dive_ore_pct 6`, 4: `repair_pct -25`, `dive_power 1.2`; Wartownik (karabin_pneumatyczny, plyta_wartownika, noktowizor, celownik) 2: `defense 1.5`, 4: `attack 2.0`.
- 4 części dają bonus2 **i** bonus4. Liczą się tylko niezepsute części w danym zestawie. Receptura w najwyżej jednym komplecie (walidacja zod), części muszą istnieć w recepturach.
- Zjazd: `dive_power` kompletu wchodzi do `dives.item_bonus` (już `min(zrzut, teraz)`); `dive_ore_pct` do `dives.set_ore_pct` przy dodaniu, rozliczenie `min(zrzut, teraz)`; mnożnik rudy = archetyp × badania × `(1 + set_ore_pct/100)`. Zjazdy sprzed migracji 019: `set_ore_pct` NULL = liczone teraz z zapisanego zestawu (bez zrzutu, jak `item_bonus` NULL).
- Najazd: atak kompletu w zrzucie ataku (przez `loadoutProfile`), obrona przez `siloDefense` (aktywny pełny + 0,75 drugiego, jak dziś).
- Naprawa: `repair_pct` kompletu zestawu, w którym przedmiot jest (najlepszy z jego zestawów), mnoży koszt naprawy; łącznie z badaniami i runami Trwałości.
- Bez nowych zasobów w dzienniku. Migracja `019_set_ore.sql`. `npm run audit` = 0.
- **Kryterium łupów (§8.2, punkt odniesienia 1.5.0 ≈ 10,2%):** wzrost najwyżej +3 pkt. Po etapie 3 zapas to ok. 1,1–1,6 pkt; Wartownik dokłada atak. Symulacja ma dwa warianty osadzania run (jak dziś i z Bastionu w zestawie obronnym I); jeśli kryterium pada w obu — STOP, liczby do Damiana (propozycje: słabszy bonus4 Wartownika, słabsze Ostrza).
- Pozostałe kryteria §8 jak w etapach 1–3 (zjazdy głównym źródłem, ruda nie zalega, pierwszy tier 10 hardcore ≥ dzień 120).
- Przed commitem: `npm run typecheck`, `npx vitest run`; w `client/` `flutter analyze` + `flutter test`.

## Review Focus
1. Część zepsuta nie liczy się do progu (3 dobre + 1 zepsuta = tylko bonus2) — test w Task 1/2.
2. Te same części w dwóch zestawach: każdy zestaw liczy swój próg osobno (np. 4 w I, 2 w II) — test w Task 2.
3. Przełączenie zestawu po dodaniu zjazdu nie podnosi rudy z kompletu (`set_ore_pct` = min(zrzut, teraz)); zjazd sprzed migracji (NULL) liczy się z zapisanego zestawu — test w Task 3.
4. `repair_pct` kompletu nie obniża naprawy przedmiotu spoza tego zestawu — test w Task 2.
5. Konfiguracja z recepturą w dwóch kompletach albo nieznaną częścią nie przechodzi walidacji — test w Task 1.

---

### Task 1: Config 1.9.0 i czyste funkcje kompletów

**Files:** Modify `server/src/config.ts` (`items.sets` + walidacja w `superRefine`), `config/game.yaml`; Create `server/src/game/sets.ts`; Test `server/test/game.test.ts`.

**Interfaces (Produces, `sets.ts`):**
- `type SetBonus = { dive_power: number; dive_ore_pct: number; attack: number; defense: number; repair_pct: number }`, `ZERO_SET`.
- `setBonuses(cfg, recipeIds: string[]): { total: SetBonus; active: { id, name, have, bonus2: boolean, bonus4: boolean }[] }` — `recipeIds` = niezepsute przedmioty jednego zestawu (duplikaty receptur liczą się raz).
- `setProgress(cfg, recipeIdsByLoadout: { '1': string[]; '2': string[] })` → lista dla `GET /items`: `[{ id, name, pieces, have: {'1': n, '2': n}, bonus2, bonus4 }]`.

- [ ] Testy: 1 część = nic; 2 części Sztygara = `dive_ore_pct 5`; 4 = `dive_ore_pct 5` + `dive_power 0.8`; 4 Rdzenia = `dive_ore_pct 6`, `dive_power 1.2`, `repair_pct -25`; dwa komplety naraz sumują się; duplikat receptury liczy się raz; walidacja: receptura w dwóch kompletach i nieznana część → `parseGameConfig` rzuca.
- [ ] RED → config + `sets.ts` → PASS → commit `Ekwipunek: komplety w configu (1.9.0) i czyste funkcje`.

### Task 2: Komplety w profilu zestawu, naprawach i `GET /items`

**Files:** Modify `server/src/services/gear.ts` (`loadoutProfile` + nowe `loadoutSetBonus(db, cfg, userId, loadout): SetBonus`), `server/src/services/items.ts` (widok: `sets`, `loadoutStats` z kompletami, `setsActive: {'1': [...], '2': [...]}`; `repairCost` × `(1 + repair_pct/100)` najlepszego zestawu przedmiotu; `repairTx` tak samo); Test `server/test/sets.test.ts` (nowy).
- [ ] Testy: 4 części Sztygara w zestawie I → `loadoutStats['1'].dive` += 0,8 i `sets` pokazuje `have['1'] = 4`, `bonus4 true`; zepsuta jedna → tylko bonus2 (dive bez +0,8); te same 2 części także w II → `have['2'] = 2`; Wartownik 2 w II → `loadoutStats['2'].defense` += 1,5 i `siloDefense` uwzględnia (pełne w II jako aktywnym, ×0,75 gdy aktywny I); Rdzeń 4 w I → `repairCost` przedmiotu z zestawu I ×0,75, a przedmiot tylko w II bez zniżki; `repairTx` pobiera obniżony koszt; audyt 0.
- [ ] RED → implementacja → PASS → commit `Ekwipunek: komplety w profilu zestawu, naprawach i GET /items`.

### Task 3: Ruda z kompletu w zjazdach (migracja 019, zrzut)

**Files:** Create `server/migrations/019_set_ore.sql` (`ALTER TABLE dives ADD COLUMN set_ore_pct double precision;`); Modify `server/src/db.ts`, `server/src/services/silo.ts` (`startDiveTx`: zapis; `resolveDueDives`: `min(zrzut, teraz)` i mnożnik rudy; `listRoutes`: zakres rudy z aktywnego zestawu); Test `server/test/sets.test.ts`.
- [ ] Testy: 2 części Sztygara w I → `dives.set_ore_pct = 5` przy dodaniu; ruda zjazdu = `resolveDive(..., oreMult × 1,05, ...)` dla tego ziarna; przełączenie na pusty zestaw po dodaniu: zjazd i tak rozliczony z zapisanego zestawu (5%), a zdjęcie części przed rozliczeniem obniża do 0 (min); `set_ore_pct` NULL → liczone z zestawu I teraz; `/dives/routes` pokazuje zakres rudy ×1,05.
- [ ] RED → implementacja → PASS → commit `Ekwipunek: ruda z kompletu w zjazdach (migracja 019, zrzut)`.

### Task 4: Symulacja (komplety + wariant Bastionu w obronie) i wyniki w specu

**Files:** Modify `server/src/sim/world-sim.ts` (komplety z `setBonuses` w `setProfile`, `dive_ore_pct` w mnożniku rudy, `repair_pct` w naprawach; wybór receptur preferuje dobranie brakującej części kompletu, gdy różnica mocy ≤ 10%; flaga `--bastion=1`: boty osadzają Bastionu w slocie ochrony zestawu I zamiast Żył), `docs/ekwipunek-v1.0.md` (§10.4).
- [ ] 3 ziarna × 2 warianty run (bez i z `--bastion=1`); raport: odsetek graczy z bonus2/bonus4 każdego kompletu, łupy (% dochodu i względem 1.5.0), ruda w magazynie, pierwszy tier 10, udział zjazdów.
- [ ] Kryteria z Global Constraints; łupy > +3 pkt względem 1.5.0 w obu wariantach → STOP z liczbami.
- [ ] §10.4 + commit `Symulacja: komplety; wyniki etapu 4`.

### Task 5: Makieta kompletów (bramka przed kodem klienta)

- [ ] Artefakt Design (`https://claude.ai/artifact/4uLiaBVPYtTnnFZRjrturM`): artboard `WarsztatKomplety.dc.html` obok `WarsztatRuny.dc.html` — na karcie przedmiotu postęp kompletu („Komplet Sztygara 2/4 w zestawie I”, progi: ✓ 2 części: ruda +5%, ○ 4 części: zjazd +0,8, brakujące części słowem); aktywne bonusy kompletów pod kafelkami zestawów; oznaczenie receptury należącej do kompletu. **Czekać na akceptację Damiana.**

### Task 6: Klient — komplety

**Files:** Modify `client/lib/screens/workshop_screen.dart`, `client/lib/strings.dart` (opis efektów kompletu: `setEffectText`), Test `client/test/sets_test.dart`, fikstury z prawdziwego API (skrypt fikstur: komplet Sztygara 4/4 w I, Wartownik 2/4 w II).
- [ ] Testy: karta części kompletu pokazuje postęp i progi znakiem i słowem (✓ / ○), brakujące części; kafelki zestawów pokazują aktywne bonusy kompletów; receptura z kompletu ma dopisek „komplet Sztygara”; 320×640 ×1,5 bez przepełnień i uciętego tekstu; liczby przez `fmtDec`.
- [ ] RED → implementacja wg makiety → PASS → emulator (komplet 2/4 → 4/4 po założeniu części, porównanie z `curl GET /items`) → commit `Klient: komplety w Warsztacie`.
