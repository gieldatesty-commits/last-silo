# Ekwipunek etap 2: rzadkość i tiery 6–10 — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rzadkość przedmiotu losowana z ziarna przy wytwarzaniu (mnożnik profilu, liczba gniazd na przyszłe runy) oraz wzmacnianie do tieru 10 za badania „Kuźnia Głębi” i „Kuźnia Rdzenia”.

**Architecture:** Czyste funkcje w `src/game/upgrade.ts` (losowanie rzadkości, mnożnik w `itemProfile`, koszt tieru z gałęzią `growth_high` i wymaganym badaniem). Migracja 017 dodaje `items.rarity` i `items.seed`. Serwisy `items.ts`/`gear.ts` przekazują rzadkość do profilu; `upgradeTx` sprawdza badanie. Klient pokazuje rzadkość nazwą i znakiem oraz wymagania wzmocnienia.

**Tech Stack:** Node 22, TypeScript ESM, Fastify 5, Kysely, PostgreSQL 16, zod 4, vitest; Flutter.

**Spec:** `docs/ekwipunek-v1.0.md` §4 (i §8 etap 2).

## Global Constraints
- Balans tylko w `config/game.yaml`; wersja `1.7.0`. Zero liczb gry w kodzie.
- Losowość tylko z ziarna: jakość = 1. liczba `rng(seed)`, rzadkość = 2. liczba tego samego strumienia (istniejące jakości dla tych samych ziaren się nie zmieniają). Ziarno zapisane w `items.seed`.
- Rzadkość startowo (spec §4.1): `zwykly 0,70 ×1,00 0 gniazd`, `solidny 0,22 ×1,08 1`, `mistrzowski 0,07 ×1,18 2`, `unikatowy 0,01 ×1,30 3`. Suma szans = 1 (zod). Nazwy w configu; znaki ● ◆ ★ ✦ w kliencie.
- Tiery 1–5 bez zmian. Tiery 6–10: Warsztat na maksimum (`maxLevelOf(cfg, 'warsztat')` = 10), ruda `koszt(5) × growth_high^(t−5)`, `growth_high: 1.35`, żetony i materiały jak dziś (× t); badanie `kuznia_glebi` od tieru 6, `kuznia_rdzenia` od 8. `max_tier: 10`. Błąd `tech_required` (409).
- Bez szansy porażki, bez przelosowania rzadkości. Przedmioty sprzed migracji: `zwykly`, `seed` NULL.
- Zasoby tylko przez `applyLedger`; `npm run audit` = 0. Nowa migracja `017_item_rarity.sql`.
- Przed commitem: `npm run typecheck`, `npx vitest run`; w `client/` `flutter analyze` + `flutter test`. Commity po polsku.
- Kryterium symulacji (§8): pierwszy tier 10 u hardcore **nie wcześniej niż w dniu 120**; zjazdy główne źródło dochodu; łupy bez skoku względem 1.6.1 (12–13,5%); ruda nie zalega. Niespełnione → STOP, liczby do Damiana.

## Review Focus
1. Ten sam `seed` daje tę samą jakość co przed etapem 2 (strumień: jakość pierwsza) — test wektorowy w Task 1.
2. Przedmiot sprzed migracji (`rarity` = 'zwykly', `seed` NULL) ma mnożnik 1 i 0 gniazd, profil jak dotąd — test w Task 2.
3. Wzmocnienie 5 → 6 bez badania: 409 `tech_required`, nic nie pobrane z dziennika (audyt 0) — test w Task 3.
4. Tier 10 to koniec: `nextUpgrade` = null, kolejne wzmocnienie 409 `max_tier` — test w Task 3.
5. Rzadkość w zestawie: profil zestawu (zjazd/atak/obrona) i zrzut zjazdu uwzględniają mnożnik rzadkości — test w Task 2.

---

### Task 1: Config 1.7.0 i czyste funkcje (rzadkość, koszt tierów)

**Files:**
- Modify: `server/src/config.ts`, `config/game.yaml`, `server/src/game/upgrade.ts`, `server/src/game/research.ts` (pole `done` w `Effects`)
- Test: `server/test/game.test.ts`

**Interfaces:**
- Produces (`upgrade.ts`):
  - `type Rarity = { id: string; name: string; chance: number; mult: number; sockets: number }`
  - `rollRarity(c: GameConfig, u: number): Rarity` — `u` ∈ [0,1): kumulacja szans w kolejności z configu.
  - `rarityOf(c: GameConfig, id: string | null | undefined): Rarity` — nieznane/NULL → pierwsza (`zwykly`).
  - `itemProfile(c, rc, quality, tier, rarityMult = 1): Profile` — profil × `rarityMult`.
  - `upgradeTierCost(c, rc, toTier)` zwraca dodatkowo `tech: string | null` (najwyższy wymagany próg z `high_tiers`, którego `from <= toTier`); `workshop` = `min(workshop_base + toTier, maxLevelOf(c, 'warsztat'))`; ruda wg Global Constraints.
- Produces (`research.ts`): `Effects.done: Set<string>` (ukończone badania).
- Config (`items`): `rarity: [...]`, `upgrade.max_tier: 10`, `upgrade.growth_high: 1.35`, `upgrade.high_tiers: [{ from: 6, tech: kuznia_glebi }, { from: 8, tech: kuznia_rdzenia }]`.
- Config (`research.techs`):
  - `{ id: kuznia_glebi, name: Kuźnia Głębi, branch: inzynieria, lab: 8, ore: 9000, tokens: 60, seconds: 43200, radio: 5, materials: { miedz: 40, krysztal: 30, siarka: 30 }, requires: [precyzja, balistyka] }`
  - `{ id: kuznia_rdzenia, name: Kuźnia Rdzenia, branch: inzynieria, lab: 10, ore: 20000, tokens: 120, samples: 20, seconds: 86400, radio: 5, materials: { miedz: 80, krysztal: 60, siarka: 60 }, requires: [kuznia_glebi, wiertla_rdzeniowe] }`

- [ ] **Step 1: Testy (`game.test.ts`)**

```ts
it('rzadkość: progi szans z configu, suma 1, nieznana = zwykły', () => {
  expect(c.items.rarity.map((r) => r.id)).toEqual(['zwykly', 'solidny', 'mistrzowski', 'unikatowy']);
  expect(rollRarity(c, 0).id).toBe('zwykly');
  expect(rollRarity(c, 0.6999).id).toBe('zwykly');
  expect(rollRarity(c, 0.70).id).toBe('solidny');
  expect(rollRarity(c, 0.92).id).toBe('mistrzowski');
  expect(rollRarity(c, 0.995).id).toBe('unikatowy');
  expect(rarityOf(c, null)).toMatchObject({ id: 'zwykly', mult: 1, sockets: 0 });
  expect(rarityOf(c, 'unikatowy')).toMatchObject({ mult: 1.3, sockets: 3 });
});
it('profil z rzadkością: × mult', () => {
  const kilof = c.items.recipes.find((r) => r.id === 'kilof')!;
  expect(itemProfile(c, kilof, 1, 0, 1.3).dive).toBeCloseTo(0.78, 6);
});
it('koszt tierów 6–10: Warsztat 10, growth_high, badania', () => {
  const w = c.items.recipes.find((r) => r.id === 'wiertlo_rdzeniowe')!;
  const t5 = upgradeTierCost(c, w, 5), t6 = upgradeTierCost(c, w, 6), t10 = upgradeTierCost(c, w, 10);
  expect(t5).toMatchObject({ workshop: 10, tech: null });
  expect(t6).toMatchObject({ workshop: 10, tech: 'kuznia_glebi' });
  expect(upgradeTierCost(c, w, 8).tech).toBe('kuznia_rdzenia');
  expect(t6.ore).toBe(Math.ceil(t5.ore * 1.35));
  expect(t10.ore).toBe(Math.ceil(t5.ore * 1.35 ** 5));
  expect(t10.tokens).toBe(c.items.upgrade.tokens_per_tier * 10);
});
it('ten sam seed: jakość jak przed etapem 2 (pierwsza liczba strumienia)', () => {
  const r = rng(12345); const q = r(); const u = r();
  expect(q).toBe(rng(12345)());
  expect(rollRarity(c, u).id).toBeTypeOf('string');
});
```
- [ ] **Step 2:** `npx vitest run test/game.test.ts` → FAIL (`rollRarity` nie istnieje).
- [ ] **Step 3:** Schemat zod (`rarity` z `superRefine` sumy = 1 ± 1e-9; `growth_high`, `high_tiers`, `max_tier` do 10 już dozwolone), config 1.7.0 z wartościami z Interfaces, funkcje.
- [ ] **Step 4:** `npm run typecheck && npx vitest run` → PASS (poprawić oczekiwaną wersję configu w teście z Task 1 etapu 1).
- [ ] **Step 5:** Commit `Ekwipunek: rzadkość i tiery 6–10 w configu (1.7.0), funkcje kosztu i losowania`.

---

### Task 2: Migracja 017, rzadkość przy wytwarzaniu i w profilach

**Files:**
- Create: `server/migrations/017_item_rarity.sql`
- Modify: `server/src/db.ts`, `server/src/services/items.ts` (`craftTx`, `view`), `server/src/services/gear.ts` (`loadoutProfile`)
- Test: `server/test/items.test.ts`

**Interfaces:**
- Consumes: `rollRarity`, `rarityOf`, `itemProfile(..., rarityMult)` (Task 1).
- Produces: widok przedmiotu += `rarity: { id, name, sockets }`; `craftTx` zapisuje `rarity` i `seed`; event `item_crafted` += `rarity`.

- [ ] **Step 1: Migracja**
```sql
ALTER TABLE items ADD COLUMN rarity text NOT NULL DEFAULT 'zwykly', ADD COLUMN seed bigint;
```
- [ ] **Step 2: Testy (`items.test.ts`)**
  - `wytworzenie: rzadkość z drugiej liczby strumienia ziarna, zapisane ziarno` — dla `nextSeed = s` oczekiwane `rarity.id === rollRarity(config, (r => (r(), r()))(rng(s))).id` i `quality` jak `min + (max−min) × rng(s)()`; wiersz `items.seed === s`.
  - `rzadkość mnoży profil przedmiotu i zestawu` — `UPDATE items SET rarity='unikatowy'` na założonym kilofie → `bonus` i `loadoutStats['1'].dive` ≈ ×1,3 względem `zwykly`.
  - `przedmiot sprzed migracji (rarity domyślne, seed NULL): mnożnik 1, 0 gniazd`.
- [ ] **Step 3:** RED. **Step 4:** implementacja (rzadkość także w `loadoutProfile`, więc zrzut zjazdu i najazdy dostają ją bez zmian w `silo.ts`/`raids.ts`). **Step 5:** `typecheck` + `vitest` + `npm run audit` (po `npm run migrate` na bazie dev) → PASS. **Step 6:** Commit `Ekwipunek: rzadkość przy wytwarzaniu (migracja 017) i w profilach`.

---

### Task 3: Wzmacnianie do tieru 10 z badaniami

**Files:**
- Modify: `server/src/services/items.ts` (`upgradeTx`, `view.nextUpgrade`)
- Test: `server/test/items.test.ts`

**Interfaces:**
- Consumes: `upgradeTierCost(...).tech`, `Effects.done`.
- Produces: `nextUpgrade` += `tech`, `techName`; błąd 409 `tech_required`.

- [ ] **Step 1: Testy**
  - `tier 5 → 6 bez Kuźni Głębi: 409 tech_required, dziennik bez zmian` (przedmiot z `tier = 5` przez SQL, Warsztat i Radio podniesione, zasoby z `grant`; po próbie `auditLedger` = [] i saldo rudy bez zmian).
  - `z Kuźnią Głębi (research done): 6 i 7 przechodzą, 8 wymaga Kuźni Rdzenia` (wpis `research(state='done')` przez SQL).
  - `tier 10: nextUpgrade null, kolejne 409 max_tier`.
- [ ] **Step 2:** RED. **Step 3:** implementacja. **Step 4:** PASS + audit. **Step 5:** Commit `Ekwipunek: wzmacnianie do tieru 10 (Kuźnia Głębi, Kuźnia Rdzenia)`.

---

### Task 4: Symulacja (rzadkość, tiery do 10) i wyniki w specu

**Files:**
- Modify: `server/src/sim/world-sim.ts`, `docs/ekwipunek-v1.0.md` (§10.2)

- [ ] **Step 1:** W symulacji: rzadkość wylosowana z ziarna wytwarzania (`rng(craftSeed++)`: 1. jakość pomijana, bo sim używa `qualityMid`; 2. rzadkość), `Gear.rarity`, mnożnik w `setProfile`/`gearBonus`; wzmacnianie do `max_tier` z wymaganym badaniem (`p.done.has(tech)`) i `workshop` z `upgradeTierCost`; `p.firstTier10At`; w raporcie: dzień pierwszego tieru 10 (min i mediana dla hardcore), rozkład rzadkości wytworzonych przedmiotów.
- [ ] **Step 2:** `sim:world -- 180 --traders=5 --seed=N`, N ∈ {1,2,3}: przed (1.6.1: osobny `git worktree add ../ls-base <commit przed etapem 2>` z własnym `npm ci`, **bez junction** — w etapie 1 `git worktree remove --force` skasował przez junction `server/node_modules`) i po; na koniec `git worktree remove ../ls-base`.
- [ ] **Step 3:** Kryteria z Global Constraints. Niespełnione → STOP, liczby w §10.2, decyzja u Damiana.
- [ ] **Step 4:** §10.2 w specu: tabela ziarno × (pierwszy tier 10 hardcore, łupy, ruda w magazynie, wydatki na wzmocnienia).
- [ ] **Step 5:** Commit `Symulacja: rzadkość i tiery do 10; wyniki etapu 2`.

---

### Task 5: Klient — rzadkość, tiery do 10, Kuźnie w Laboratorium

**Files:**
- Modify: `client/lib/strings.dart` (`rarityMarks`, `tech_required`), `client/lib/screens/workshop_screen.dart`, `client/lib/lab_layout.dart` (`techPos` dla `kuznia_glebi`, `kuznia_rdzenia`, dobrane obliczeniowo jak Balistyka: krawędzie > promień + 4 dp od obcych węzłów)
- Test: `client/test/loadouts_test.dart` (lub nowy `client/test/rarity_test.dart`), fikstury `items_loadouts.json` i `research.json` odświeżone z prawdziwego API (skrypt fikstur ze scratchpada etapu 1)

**Interfaces:**
- Consumes: `rarity {id, name, sockets}`, `nextUpgrade {…, tech, techName}`, `maxTier` = 10.
- Produces: `rarityMarks = {'zwykly': '●', 'solidny': '◆', 'mistrzowski': '★', 'unikatowy': '✦'}`.

- [ ] **Step 1: Testy**
  - karta przedmiotu: chip „◆ Solidny” (znak + nazwa), w Semantics karty i wiersza ekwipunku nazwa rzadkości.
  - wzmocnienie: przy `nextUpgrade.tech` przycisk „Wzmocnij” wyłączony, opis „Wymaga badania: Kuźnia Głębi”; 10 kropek tieru mieści się na 320×640 przy ×1,5 (bez przepełnień, bez uciętego tekstu).
  - `techPos` zawiera obie Kuźnie; `lab_layout_test` (krawędzie z dala od węzłów) przechodzi; `errorText('tech_required')` po polsku.
- [ ] **Step 2:** RED. **Step 3:** implementacja. **Step 4:** `flutter analyze && flutter test` → PASS. **Step 5:** emulator: wytworzenie (toast z rzadkością), karta, Laboratorium z Kuźniami; porównanie z `curl GET /items`. **Step 6:** Commit `Klient: rzadkość przedmiotów, wzmacnianie do tieru 10, Kuźnie w Laboratorium`.
