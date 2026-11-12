# Ekwipunek etap 1: zestawy i bronie — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dwa zestawy ekwipunku przełączane ręcznie; przedmioty z profilem zjazd/atak/obrona; bronie i pancerze bojowe; zestaw działa przy zjazdach, atakach i obronie, bez działania wstecz.

**Architecture:** Profil przedmiotu to czysta funkcja w `src/game/upgrade.ts`. Tabela `loadouts` zastępuje `items.equipped`; `src/services/gear.ts` liczy profil zestawu i zużycie. Zjazd i atak zapisują zrzut mocy przy starcie (`dives.item_bonus`, `raids.attack_power`), obrona czyta aktywny zestaw obrońcy przy rozliczeniu (które `settle()` już robi przed każdą zmianą).

**Tech Stack:** Node 22, TypeScript ESM, Fastify 5, Kysely, PostgreSQL 16, zod 4, vitest; Flutter (klient).

**Spec:** `docs/ekwipunek-v1.0.md` (§2, §3, §7, §8 etap 1).

## Global Constraints
- Balans tylko w `config/game.yaml`; wersja configu `1.6.0`. Zero liczb gry w kodzie.
- Losowość tylko z ziarna (`rng`), zero `Math.random()`.
- Zasoby tylko przez `applyLedger`; `npm run audit` = 0 różnic (etap 1 nie dodaje nowych powodów w dzienniku).
- Każda akcja mutująca z `Idempotency-Key`, wewnątrz `idempotent(...)`, po `settle()`.
- Nowa migracja `server/migrations/016_loadouts.sql`; starych nie ruszać.
- Pole `equipped` w widoku przedmiotu zostaje i znaczy „w aktywnym zestawie”.
- Zjazd/atak sprzed migracji (`item_bonus`/`attack_power` = NULL) rozliczają się po staremu, z zestawu 1.
- Przed commitem: `npm run typecheck`, `npx vitest run` (w `server/`), `flutter analyze` + `flutter test` (w `client/`). Commity krótkie, po polsku.
- Jeśli symulacja nie spełnia kryteriów z §8 specu, nie zmieniać balansu samemu — raport do Damiana.

## Review Focus
1. Ten sam przedmiot w obu zestawach: założenie go w zestawie 2 nie zdejmuje go z zestawu 1; zdjęcie z jednego zostawia drugi. → test w zadaniu 2.
2. Dwa zjazdy w kolejce i przełączenie między ich dodaniem: każdy rozlicza się własnym zrzutem i zużywa przedmioty swojego zestawu. → test w zadaniu 3.
3. Przełączenie zestawu przez obrońcę po dotarciu napastnika, ale przed rozliczeniem, nie zmienia wyniku najazdu. → test w zadaniu 4.
4. Koniec sezonu: `loadouts` wyczyszczone, `active_loadout` = 1 (bez tego `TRUNCATE items` padnie na FK). → test w zadaniu 2.
5. Ponowienie `activate` z tym samym kluczem nie przełącza drugi raz; inny klucz na aktywny zestaw = 409 `already_active`. → test w zadaniu 2.

---

### Task 1: Profil przedmiotu, bronie i badanie w configu

**Files:**
- Modify: `server/src/config.ts` (schemat `items.recipes`)
- Modify: `config/game.yaml` (`version`, receptury, badanie `balistyka`)
- Modify: `server/src/game/upgrade.ts`
- Test: `server/test/game.test.ts`, `server/test/items.test.ts` (liczba receptur 13 → 20)

**Interfaces:**
- Produces: `type Profile = { dive: number; attack: number; defense: number }`; `itemProfile(c: GameConfig, rc: Recipe, quality: number, tier: number): Profile`; `addProfiles(a: Profile, b: Profile): Profile`; `ZERO_PROFILE: Profile` — wszystko eksportowane z `src/game/upgrade.ts`. `itemBonus(...)` zostaje i zwraca `itemProfile(...).dive`.

- [ ] **Step 1: Testy jednostkowe w `game.test.ts`**

```ts
it('profil przedmiotu: zjazd/atak/obrona × jakość × tier', () => {
  const lom = cfg.items.recipes.find((r) => r.id === 'lom_bojowy')!;
  expect(itemProfile(cfg, lom, 1, 0)).toEqual({ dive: 0, attack: 1.0, defense: 0 });
  const p = itemProfile(cfg, lom, 0.9, 2); // 1,0 × 0,9 × 1,2
  expect(p.attack).toBeCloseTo(1.08, 6);
  const kilof = cfg.items.recipes.find((r) => r.id === 'kilof')!;
  expect(itemProfile(cfg, kilof, 1, 0)).toEqual({ dive: 0.6, attack: 0, defense: 0 });
  expect(itemBonus(cfg, kilof, 1, 0)).toBe(0.6);
  const pancerny = cfg.items.recipes.find((r) => r.id === 'kombinezon_pancerny')!;
  expect(itemProfile(cfg, pancerny, 1, 0).defense).toBe(0.8);
});
it('config 1.6.0: 7 receptur bojowych, balistyka odblokowuje karabin i płytę', () => {
  expect(cfg.version).toBe('1.6.0');
  const ids = ['lom_bojowy', 'nitownica', 'karabin_pneumatyczny', 'napiersnik', 'plyta_wartownika', 'noktowizor', 'celownik'];
  for (const id of ids) expect(cfg.items.recipes.some((r) => r.id === id)).toBe(true);
  const bal = cfg.research.techs.find((t) => t.id === 'balistyka')!;
  expect(bal.unlocks).toEqual(['karabin_pneumatyczny', 'plyta_wartownika']);
});
```

- [ ] **Step 2: Uruchom** `cd server && npx vitest run test/game.test.ts` — Expected: FAIL (`itemProfile` nie istnieje).

- [ ] **Step 3: Schemat i config**
  - `config.ts`: w recepturze `bonus: z.number().min(0)` (było `pos`), dodać `attack: z.number().min(0).default(0)`, `defense: z.number().min(0).default(0)`.
  - `game.yaml`: `version: 1.6.0`; receptury z tabeli §2 specu (sloty, Warsztat, profil, koszt, `radio: 5` gdzie podano, `tech: balistyka` dla karabinu i płyty; wytrzymałość: łom 20, napierśnik 25, nitownica 30, noktowizor 30, celownik 35, karabin 40, płyta 45; `bonus: 0` dla bojowych); `kombinezon_pancerny` dostaje `defense: 0.8`.
  - `game.yaml` badanie: `{ id: balistyka, name: Balistyka, branch: inzynieria, lab: 5, ore: 3000, tokens: 25, seconds: 14400, radio: 5, materials: { siarka: 15 }, requires: [metalurgia], unlocks: [karabin_pneumatyczny, plyta_wartownika] }`.

- [ ] **Step 4: `itemProfile` w `upgrade.ts`** — `mnożnik = quality × tierBonusMult(c, tier)`; każde pole receptury × mnożnik. `itemBonus` deleguje do `itemProfile`.

- [ ] **Step 5: Uruchom** `npm run typecheck && npx vitest run` — Expected: PASS (w `items.test.ts` poprawić oczekiwaną liczbę receptur na 20).

- [ ] **Step 6: Commit** `git commit -m "Ekwipunek: profil zjazd/atak/obrona, bronie i Balistyka (config 1.6.0)"`

---

### Task 2: Migracja 016, zestawy w serwisie i API

**Files:**
- Create: `server/migrations/016_loadouts.sql`
- Modify: `server/src/db.ts` (typy), `server/src/services/gear.ts`, `server/src/services/items.ts`, `server/src/services/season.ts`, `server/src/services/silo.ts` (`getSilo`: `player.activeLoadout`), `server/src/app.ts`
- Test: `server/test/items.test.ts`, `server/test/season.test.ts`

**Interfaces:**
- Consumes: `itemProfile`, `addProfiles`, `ZERO_PROFILE` (Task 1).
- Produces (w `gear.ts`):
  - `type LoadoutNo = 1 | 2`
  - `activeLoadout(db: Trx, userId: string): Promise<LoadoutNo>`
  - `loadoutProfile(db: Trx, cfg: GameConfig, userId: string, loadout: LoadoutNo): Promise<Profile>` — suma profili niezepsutych przedmiotów zestawu.
  - `wearLoadout(trx: Transaction<Database>, userId: string, loadout: LoadoutNo): Promise<void>` — −1 wytrzymałości przedmiotom zestawu z `durability > 0`.
  - `equippedBonus(db, cfg, userId)` = `(await loadoutProfile(db, cfg, userId, await activeLoadout(db, userId))).dive` (zgodność); `wearEquipped` usunąć (zastępuje `wearLoadout`).
- Produces (w `items.ts`): `equipTx(trx, ctx, userId, id, equip: boolean, loadout?: LoadoutNo)`; `activateLoadoutTx(trx, ctx, userId, loadout: LoadoutNo): Promise<{ activeLoadout: LoadoutNo }>`.
- Produces (API): `GET /items` += `activeLoadout`, `loadouts: {"1": {[slot]: itemId | null}, "2": {...}}`, `loadoutStats: {"1": Profile, "2": Profile}`; przedmiot += `attack`, `defense`, `inLoadouts: number[]` (`bonus` = zjazd jak dziś, `equipped` = w aktywnym). `POST /items/:id/equip|unequip` przyjmuje opcjonalne `{loadout: 1|2}`. `POST /loadouts/:n/activate` (200, `{activeLoadout}`), błędy `invalid_loadout` (400), `already_active` (409).

- [ ] **Step 1: Migracja `016_loadouts.sql`**

```sql
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
```
`db.ts`: tabela `loadouts`, `players.active_loadout: Generated<number>`, `dives.loadout/item_bonus: number | null`, `raids.attack_power/attacker_loadout: number | null`, usunąć `items.equipped`.

- [ ] **Step 2: Testy w `items.test.ts` (nowy `describe('Zestawy')`)**

```ts
it('przedmiot w obu zestawach; zdjęcie z jednego zostawia drugi', async () => {
  // kilof w zestawie 1 (domyślnie aktywny) i w zestawie 2
  await post(h, `/items/${k.id}/equip`, 'ld-1');
  await post(h, `/items/${k.id}/equip`, 'ld-2', { loadout: 2 });
  let r = (await app.inject({ url: '/items', headers: h })).json();
  expect(r.loadouts['1'].narzedzie).toBe(k.id);
  expect(r.loadouts['2'].narzedzie).toBe(k.id);
  expect(r.items.find((i) => i.id === k.id).inLoadouts).toEqual([1, 2]);
  await post(h, `/items/${k.id}/unequip`, 'ld-3', { loadout: 2 });
  r = (await app.inject({ url: '/items', headers: h })).json();
  expect(r.loadouts['1'].narzedzie).toBe(k.id);
  expect(r.loadouts['2'].narzedzie).toBeNull();
});
it('aktywacja: equipped i loadoutStats idą za aktywnym zestawem; ponowienie idempotentne; already_active', async () => {
  // kilof w 1, łom bojowy w 2
  expect((await post(h, '/loadouts/2/activate', 'act-1')).json()).toEqual({ activeLoadout: 2 });
  const again = await post(h, '/loadouts/2/activate', 'act-1');
  expect(again.headers['idempotent-replay']).toBe('true');
  expect((await post(h, '/loadouts/2/activate', 'act-2')).json().error).toBe('already_active');
  expect((await post(h, '/loadouts/3/activate', 'act-3')).statusCode).toBe(400);
  const r = (await app.inject({ url: '/items', headers: h })).json();
  expect(r.activeLoadout).toBe(2);
  expect(r.items.find((i) => i.id === lom.id).equipped).toBe(true);
  expect(r.items.find((i) => i.id === k.id).equipped).toBe(false);
  expect(r.loadoutStats['2'].attack).toBeGreaterThan(0);
  expect(r.loadoutStats['1'].dive).toBeGreaterThan(0);
  expect((await app.inject({ url: '/silo', headers: h })).json().player.activeLoadout).toBe(2);
});
it('zepsuty przedmiot nie liczy się do profilu zestawu', async () => { /* durability = 0 przez UPDATE, loadoutStats['1'].dive === 0 */ });
```
Istniejące testy założeń (`items.test.ts:99–114`) zostają bez zmian: działają na aktywnym zestawie 1.

W `season.test.ts`: po zamknięciu sezonu `SELECT count(*) FROM loadouts` = 0 i `players.active_loadout` = 1 dla gracza, który miał 2.

- [ ] **Step 3: Uruchom** `npx vitest run test/items.test.ts test/season.test.ts` — Expected: FAIL.

- [ ] **Step 4: Implementacja**
  - `gear.ts`: funkcje z Interfaces; zapytania przez `loadouts` join `items`.
  - `items.ts`: `view` dostaje `active: LoadoutNo` i mapę `itemId → LoadoutNo[]`; `equipTx` — założenie = upsert `(user_id, loadout, slot) → item_id` (slot z przedmiotu), zdjęcie = delete wiersza tego zestawu, jeśli wskazuje ten przedmiot; `activateLoadoutTx` — `settle()`, `already_active` gdy równy, potem `UPDATE players`.
  - `app.ts`: body `z.object({ loadout: z.union([z.literal(1), z.literal(2)]).optional() }).optional()` dla equip/unequip; trasa `POST /loadouts/:n/activate` z `idemRoute` i `idempotent` jak `/items/:id/:action`; `n` spoza 1|2 → `invalid_loadout`.
  - `season.ts`: dopisać `loadouts` do `TRUNCATE` (przed `items`) i ustawić `active_loadout = 1` tam, gdzie resetowane są wiersze `players`.
  - `silo.ts:getSilo`: `player.activeLoadout`.

- [ ] **Step 5: Uruchom** `npm run typecheck && npx vitest run && npm run audit` — Expected: PASS, audyt 0.

- [ ] **Step 6: Commit** `git commit -m "Ekwipunek: dwa zestawy (migracja 016), przełączanie i API"`

---

### Task 3: Zrzut mocy zjazdu

**Files:**
- Modify: `server/src/services/silo.ts` (`startDiveTx`, `resolveDueDives`, `listRoutes`)
- Test: `server/test/dive.test.ts` lub `server/test/m2.test.ts` (tam, gdzie są testy kolejki)

**Interfaces:**
- Consumes: `activeLoadout`, `loadoutProfile`, `wearLoadout` (Task 2).
- Produces: `dives.loadout` i `dives.item_bonus` zapisywane przy `startDiveTx`; odpowiedź `POST /dives` += `loadout`.

- [ ] **Step 1: Testy**

```ts
it('zjazd liczy zestaw z chwili dodania; przełączenie potem nic nie zmienia', async () => {
  // zestaw 1: kilof; zestaw 2: pusty. Dodaj zjazd na zestawie 2, przełącz na 1, rozlicz.
  // Oczekiwane: wynik === resolveDive(..., bonus = 0 + fx.divePower, ...) dla tego ziarna; kilof bez zużycia.
});
it('dwa zjazdy w kolejce, przełączenie między dodaniami: każdy ze swoim zestawem i zużyciem', async () => {
  // zjazd A na zestawie 1 (kilof), activate 2 (łom), zjazd B na zestawie 2.
  // Po rozliczeniu obu: kilof −1, łom −1; dives.item_bonus A = 0,6×jakość, B = 0.
});
it('zjazd sprzed migracji (item_bonus NULL) rozlicza się z zestawu 1', async () => { /* UPDATE dives SET item_bonus = NULL, loadout = NULL */ });
```

- [ ] **Step 2: Uruchom** — Expected: FAIL.

- [ ] **Step 3: Implementacja** — `startDiveTx`: `const lo = await activeLoadout(trx, userId)`, `item_bonus = (await loadoutProfile(trx, cfg, userId, lo)).dive`, zapis w `insertInto('dives')`. `resolveDueDives`: `bonus = (d.item_bonus ?? (await loadoutProfile(trx, cfg, userId, 1)).dive) + fx.divePower`; `wearLoadout(trx, userId, (d.loadout ?? 1) as LoadoutNo)`. `listRoutes`: szansa z aktywnego zestawu (bez zmian w zachowaniu, przez `equippedBonus`).

- [ ] **Step 4: Uruchom** `npm run typecheck && npx vitest run` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Ekwipunek: zjazd zapisuje moc zestawu przy dodaniu do kolejki"`

---

### Task 4: Zestaw w najazdach (atak, obrona, liga, zużycie)

**Files:**
- Modify: `server/src/services/raids.ts` (`candidateOf`, `startRaidTx`, `resolveRaid`)
- Test: `server/test/m3.test.ts`

**Interfaces:**
- Consumes: `activeLoadout`, `loadoutProfile`, `wearLoadout` (Task 2); `attackPower`, `defensePower`, `playerPower` (`src/game/radio.ts`, bez zmian sygnatur).
- Produces: `raids.attack_power`, `raids.attacker_loadout` przy `startRaidTx`; `Candidate.power` = `playerPower(...) + profile.attack + profile.defense` (aktywny zestaw).

- [ ] **Step 1: Testy w `m3.test.ts`**

```ts
it('broń w aktywnym zestawie podnosi szansę; zrzut z chwili wysłania', async () => {
  // A z łomem w zestawie 2, aktywny 2. Wyślij najazd, przełącz A na 1, rozlicz.
  // result.chancePct === round(raidWinChance(Siła + 0,4·Perc + atak_łomu, D) × 100).
});
it('obrona z aktywnego zestawu obrońcy; przełączenie po dotarciu, przed rozliczeniem, nie zmienia wyniku', async () => {
  // B z napierśnikiem w zestawie 2 (aktywny). A wysyła najazd, tick do ends_at + 1 s,
  // B wywołuje POST /loadouts/1/activate (to robi settle() → najazd rozliczony na zestawie 2).
  // chancePct liczony z obroną + napierśnik; po aktywacji wynik w GET /raids bez zmian.
});
it('najazd zużywa przedmioty: atakujący zestaw z wysłania, obrońca aktywny', async () => { /* −1 wytrzymałości po obu stronach */ });
it('liga uwzględnia profil aktywnego zestawu', async () => {
  // dwaj gracze tuż w lidze; jeden aktywuje zestaw z bronią podnoszącą moc ponad 40% → targets: out_of_league
});
it('najazd sprzed migracji (attack_power NULL) liczy atak ze statystyk', async () => { /* UPDATE raids SET attack_power = NULL */ });
```

- [ ] **Step 2: Uruchom** `npx vitest run test/m3.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementacja**
  - `candidateOf`: dodać profil aktywnego zestawu do `power` (zwracać też `profile` do użycia niżej, żeby nie liczyć dwa razy).
  - `startRaidTx`: `attack_power = attackPower(statsOf(p)) + profile.attack`, `attacker_loadout = lo`.
  - `resolveRaid`: `A = raid.attack_power ?? attackPower(statsOf(att))`; `D = defensePower(cfg, statsOf(def), defLv.wartownia) + (await loadoutProfile(trx, cfg, raid.defender_id, await activeLoadout(trx, raid.defender_id))).defense`; po wyniku `wearLoadout` dla atakującego (`attacker_loadout ?? 1`) i obrońcy (aktywny).

- [ ] **Step 4: Uruchom** `npm run typecheck && npx vitest run && npm run audit` — Expected: PASS, audyt 0.

- [ ] **Step 5: Commit** `git commit -m "Ekwipunek: zestaw w najazdach (atak ze zrzutu, obrona aktywnego, liga, zużycie)"`

---

### Task 5: Symulacja świata z dwoma zestawami i wyniki w specu

**Files:**
- Modify: `server/src/sim/world-sim.ts`
- Modify: `docs/ekwipunek-v1.0.md` (nowy §10 „Wyniki etapu 1”)

**Interfaces:**
- Consumes: `itemProfile` (Task 1), `attackPower`, `defensePower`, `playerPower`.
- Produces: w symulacji `p.gear2: Map<slot, Gear>` (zestaw bojowy), `p.active: 1 | 2`, `combatOf(p, set): Profile`; nowa linia raportu „Zestawy”.

- [ ] **Step 1: Model**
  - Hardcore: kupuje sprzęt bojowy do `gear2` (najlepsza dostępna receptura z `attack + defense > 0` na slot, przy tych samych warunkach zapasu rudy co dziś), zjazdy na zestawie 1, przed atakiem przełącza na 2 i od razu z powrotem (atak ze zrzutu), więc broni się zestawem 1.
  - Regularni: jak hardcore, ale kupują sprzęt bojowy dopiero od poziomu najazdów i z 2× większym zapasem rudy.
  - Okazjonalni: jeden zestaw, nie przełączają.
  - Atak w `tryRaid`: `attackPower(p.stats) + combatOf(p, 2).attack` (hardcore/regularni) albo z zestawu 1; obrona celu z jego `active` (zawsze 1 poza chwilą ataku). Moc ligowa: `playerPower + attack + defense` aktywnego. Zużycie przedmiotów w najazdach jak w serwisie.
  - Raport: śr. atak/obrona zestawu bojowego, odsetek graczy z bronią, udział najazdów w dochodzie (już jest).

- [ ] **Step 2: Uruchom 1.5.0 (punkt odniesienia) i 1.6.0** — punkt odniesienia w osobnym drzewie: `git worktree add ../ls-base fdfca61` (stan przed etapem 1), tam `npm ci` i `npm run -s sim:world -- 180 --traders=5 --seed=N` dla N ∈ {1, 2, 3}; to samo na bieżącym kodzie; potem `git worktree remove ../ls-base`. Zanotować udział najazdów, medianę rudy hardcore w dniu 180 i dochód ze zjazdów.

- [ ] **Step 3: Sprawdzić kryteria §8 specu** (1, 2, 3, 5; kryterium 4 dotyczy etapu 2). Jeśli któreś pada: STOP, zapisać liczby w §10 i zgłosić Damianowi bez zmian w balansie.

- [ ] **Step 4: Dopisać §10 w `docs/ekwipunek-v1.0.md`** — tabela ziarno × (udział najazdów 1.5.0 → 1.6.0, mediana rudy hardcore, udział zjazdów), wniosek jednym akapitem.

- [ ] **Step 5: Uruchom** `npm run typecheck && npx vitest run` — Expected: PASS.

- [ ] **Step 6: Commit** `git commit -m "Symulacja: dwa zestawy i sprzęt bojowy; wyniki etapu 1 w specyfikacji"`

---

### Task 6: Makieta Warsztatu z zestawami (bramka przed kodem klienta)

**Files:**
- Modify: artefakt Design `https://claude.ai/artifact/4uLiaBVPYtTnnFZRjrturM` — nowy artboard `WarsztatZestawy.dc.html` (obok `Warsztat.dc.html`).

- [ ] **Step 1:** Odczytać artefakt (`Artifact action: read`) i zbudować artboard na tym samym stylu (`Ls`, Space Grotesk/Inter) z: przełącznikiem Zestaw I / Zestaw II (aktywny opisany słowem „aktywny”), podsumowaniem zjazd/atak/obrona obu zestawów, slotami z ikoną profilu (kilof vs broń), znacznikiem „w obu zestawach”, wierszem w Zjazdach „idziesz zestawem I” i w Najazdach „atak X · obrona Y (zestaw II)”.
- [ ] **Step 2:** Opublikować i pokazać Damianowi. **Czekać na akceptację** — bez niej Task 7 nie startuje.

---

### Task 7: Klient — zestawy w Warsztacie, Zjazdach, Najazdach i Laboratorium

**Files:**
- Modify: `client/lib/screens/workshop_screen.dart`, `client/lib/screens/dives_screen.dart`, `client/lib/screens/raids_screen.dart`, `client/lib/lab_layout.dart` (`techPos['balistyka']`), `client/lib/strings.dart`
- Test: `client/test/dives_workshop_test.dart`, `client/test/more_screens_test.dart`, fikstury `client/test/fixtures/items.json` (z prawdziwego `GET /items` po Task 2)

**Interfaces:**
- Consumes: API z Task 2 (`activeLoadout`, `loadouts`, `loadoutStats`, `inLoadouts`, `attack`, `defense`, `POST /loadouts/:n/activate`, `equip` z `{loadout}`) i `player.activeLoadout` z `/silo`.

- [ ] **Step 1: Fikstura** — zapisać `GET /items` i `GET /silo` z serwera deweloperskiego (gracz z kilofem w I i łomem w II) do `client/test/fixtures/`.
- [ ] **Step 2: Testy widżetów**
  - Warsztat: przełącznik pokazuje „Zestaw I · aktywny”; stuknięcie „Zestaw II” wysyła `POST /loadouts/2/activate`; karta łomu pokazuje „atak 1,0” słowem; 320×640 przy ×1,5 bez przepełnień i uciętego tekstu (istniejący pomocnik).
  - Zakładanie z widoku zestawu II wysyła `equip` z `{loadout: 2}`.
  - Zjazdy: wiersz „Zjazd pójdzie zestawem I”.
  - Najazdy: „atak X · obrona Y” aktywnego zestawu.
  - Laboratorium: `balistyka` ma pozycję z `techPos` (nie z pierścienia awaryjnego).
- [ ] **Step 3: Uruchom** `flutter test` — Expected: FAIL.
- [ ] **Step 4: Implementacja wg makiety z Task 6**; komunikaty `invalid_loadout` („Nie ma takiego zestawu.”) i `already_active` („Ten zestaw jest już aktywny.”) w `strings.dart`; stany sygnalizowane słowem/znakiem, nie tylko kolorem; cele dotyku ≥ 44 dp.
- [ ] **Step 5: Uruchom** `flutter analyze && flutter test` — Expected: No issues, all passed.
- [ ] **Step 6: Sprawdzenie na emulatorze** (`-gpu swiftshader_indirect`): przełączenie zestawu, założenie łomu w II, zjazd, ekran Najazdów; porównać pola z `curl` `GET /items`.
- [ ] **Step 7: Commit** `git commit -m "Klient: dwa zestawy w Warsztacie, zestaw w Zjazdach i Najazdach, Balistyka w Lab"`
