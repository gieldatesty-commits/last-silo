# Ekwipunek v1.0: zestawy, bronie, rzadkość, runy, komplety

Cel: więcej decyzji w ekwipunku i długoterminowe ujścia rudy i materiałów, bez nowych źródeł dochodu i bez pay-to-win. Zasady z `CLAUDE.md` obowiązują w całości: balans tylko w `config/game.yaml`, losowość tylko z ziarna, zasoby tylko przez dziennik (`applyLedger`, `npm run audit` = 0 różnic), akcje mutujące z `Idempotency-Key`, nowe tabele = nowe migracje.

Wszystkie liczby poniżej to **wartości startowe do symulacji** (`sim:world`, kilka ziaren). Ostateczne trafiają do configu i do §8 tego dokumentu.

## 0. Stan wyjściowy (config 1.5.0)
- 4 sloty: `narzedzie`, `ochrona`, `lampa`, `sprzet`. Przedmiot ma jakość (losowaną przy wytwarzaniu), wytrzymałość i tier wzmocnienia 0–5.
- Przedmioty działają **tylko na zjazdy**: `bonus = receptura.bonus × jakość × (1 + 0,10·tier)` dodaje się do mocy zjazdu.
- Bonus zjazdu liczy się **przy rozliczeniu** (`resolveDueDives`) z aktualnie założonych przedmiotów.
- Najazdy liczą `atak = Siła + 0,4·Percepcja` i `obrona = Wytrwałość + bonus Wartowni` z samych statystyk. Moc ligowa (`playerPower`) = suma statystyk + 2 × suma poziomów budynków.
- Na koniec sezonu przedmioty i portfele są czyszczone (`docs/sezony-v1.0.md`).

## 1. Decyzje (uzgodnione z Damianem)
1. Dwa zestawy ekwipunku, przełączane **ręcznie**. Aktywny zestaw działa przy **zjazdach, atakach i obronie**.
2. Bronie i pancerze bojowe dzielą sloty z narzędziami zjazdowymi (kilof **albo** broń), żeby zestaw zjazdowy i bojowy naprawdę się różniły.
3. Rzadkość losowana przy wytwarzaniu **oraz** wzmacnianie do tieru 10.
4. Runy: poziomy I–II z Warsztatu, poziom III tylko z łupu zjazdów. Wyjęcie runy kosztuje rudę, runa wraca do magazynu.
5. Komplety: bonus od 2 i 4 założonych części z aktywnego zestawu.
6. Poza v1: handel runami i rzadkimi przedmiotami na Rynku, łączenie run, rozbieranie przedmiotów, przelosowanie rzadkości, szansa porażki przy wzmacnianiu.

Nazewnictwo w grze: **zestaw** = jeden z dwóch układów ekwipunku (Zestaw I, Zestaw II); **komplet** = grupa przedmiotów dająca bonus za założenie kilku części.

## 2. Profil przedmiotu i bronie
Każda receptura ma profil z trzech liczb: `bonus` (moc zjazdu, nazwa zostaje dla zgodności), `attack`, `defense` (domyślnie 0).

```
mnożnik = jakość × rzadkość.mult × (1 + bonus_per_tier · tier)
zjazd  = receptura.bonus   × mnożnik + runy(zjazd)
atak   = receptura.attack  × mnożnik + runy(atak)
obrona = receptura.defense × mnożnik + runy(obrona)
```
Przedmiot zepsuty (wytrzymałość 0) nie daje nic, także run i części kompletu.

Nowe receptury (startowo):

| id | Nazwa | Slot | Warsztat | Profil | Koszt | Wymaga |
|---|---|---|---|---|---|---|
| lom_bojowy | Łom bojowy | narzedzie | 2 | atak 0,6 | 350 rudy, 2 żet. | – |
| nitownica | Nitownica | narzedzie | 4 | atak 1,2 | 1500 rudy, 12 żet., miedź 12 | Radio 5 |
| karabin_pneumatyczny | Karabin pneumatyczny | narzedzie | 6 | atak 1,92 | 4200 rudy, 38 żet., siarka 30, miedź 15 | Radio 5, badanie `balistyka` |
| napiersnik | Napierśnik | ochrona | 3 | obrona 1,2 | 650 rudy, 4 żet. | – |
| plyta_wartownika | Płyta Wartownika | ochrona | 6 | obrona 3,0 | 4500 rudy, 40 żet., kryształ 30 | Radio 5, badanie `balistyka` |
| noktowizor | Noktowizor | lampa | 4 | atak 0,48, obrona 0,6 | 1600 rudy, 14 żet., kryształ 12 | Radio 5 |
| celownik | Celownik | sprzet | 5 | atak 0,84 | 2400 rudy, 20 żet., kryształ 10, siarka 8 | Radio 5 |

Istniejące receptury dostają `attack: 0`, `defense: 0`, poza **Kombinezonem pancernym** (`defense: 0,8`), który z nazwy jest hybrydą. Nowe badanie `balistyka` (gałąź inżynieria, Lab 5) odblokowuje Karabin i Płytę.

Wzory najazdu:
```
atak   = Siła + 0,4·Percepcja + atak(zestaw atakującego)
obrona = Wytrwałość + bonus Wartowni + obrona(aktywny) + passive_defense_share × obrona(drugi zestaw)
moc ligowa = playerPower(...) + atak(aktywny) + obrona silosu (jak wyżej)
```
`items.loadouts.passive_defense_share = 0,75` (config 1.6.0): pancerz chroni silos także wtedy, gdy gracz siedzi w zestawie zjazdowym. Bez tego atak (przełączenie na chwilę wysłania) był darmowy, a obrona nie (§10).
Moc ligowa uwzględnia aktywny zestaw, więc przełączenie zmienia ligę. To zamierzone: kto siedzi w zestawie bojowym, trafia na silniejszych.

## 3. Zestawy
### 3.1 Dane
- Tabela `loadouts(user_id, loadout smallint 1|2, slot text, item_id bigint)`, PK `(user_id, loadout, slot)`, FK `item_id → items(id) ON DELETE CASCADE`. Jeden przedmiot może być w obu zestawach.
- `players.active_loadout smallint NOT NULL DEFAULT 1 CHECK (active_loadout IN (1,2))`.
- Migracja przenosi obecne `items.equipped = true` do zestawu 1, potem usuwa indeks `items_one_equipped_per_slot` i kolumnę `items.equipped`.
- Slot w `loadouts` musi się zgadzać ze slotem przedmiotu (sprawdza serwis).

### 3.2 Zrzuty stanu: nic nie działa wstecz
Dziś bonus zjazdu liczy się przy rozliczeniu. Przy dwóch zestawach dałoby się dodać zjazd z zestawem bojowym i przełączyć na zjazdowy tuż przed rozliczeniem. Dlatego:
- **Zjazd** zapisuje przy dodaniu do kolejki `dives.loadout` (który zestaw) i `dives.item_bonus` (moc z przedmiotów, run i kompletu w tej chwili). Rozliczenie używa zapisanej mocy, ale nie większej niż moc zapisanego zestawu w chwili rozliczenia (`min`): przedmiot zepsuty na wcześniejszym zjeździe w kolejce albo zdjęty nic już nie daje, a przełączenie zestawu nie podnosi mocy. Zużycie: przedmioty, które **w chwili rozliczenia** są w zapisanym zestawie i nie są zepsute, tracą 1 wytrzymałości. (Jeśli gracz wyjął przedmiot z zestawu, ten się nie zużywa; moc i tak była zapisana.)
- **Atak** zapisuje przy wysłaniu `raids.attack_power` (pełny atak ze statystykami i zestawem) i `raids.attacker_loadout`.
- **Obrona** liczy się z zestawu aktywnego u obrońcy w chwili rozliczenia, plus `passive_defense_share` obrony drugiego zestawu. Warunek konieczny: `POST /loadouts/{n}/activate`, `equip`, osadzanie i wyjmowanie run najpierw wołają `settle()`, które rozlicza też najazdy, w których gracz jest **obrońcą**, a które dotarły (`ends_at <= now`). Dziś `settle()` już to robi dla obu stron (`raids.ts`, rozliczanie najazdów gracza jako atakującego lub obrońcy); test etapu 1 ma to utrwalić: przełączenie po dotarciu napastnika, ale przed rozliczeniem, nie zmienia wyniku.
- Zjazdy sprzed migracji (bez `item_bonus`) rozliczają się po staremu, z zestawu 1.
- Najazd zużywa przedmioty: atakującemu zestaw z `attacker_loadout`, obrońcy aktywny zestaw, po 1 wytrzymałości.

### 3.3 API
- `GET /items`: dodatkowo `activeLoadout`, `loadouts: {"1": {slot: itemId|null}, "2": {...}}`, `loadoutStats: {"1": {dive, attack, defense}, "2": {...}}`. Pole `equipped` w widoku przedmiotu zostaje i znaczy „w aktywnym zestawie” (zgodność z obecnym klientem); dochodzi `inLoadouts: [1,2]`.
- `POST /items/{id}/equip` `{equip: bool, loadout?: 1|2}` (domyślnie aktywny). Założenie zastępuje przedmiot w tym slocie tego zestawu.
- `POST /loadouts/{1|2}/activate` + `Idempotency-Key`. Kody błędów: `invalid_loadout`, `already_active` (409, bez skutku).
- `GET /silo` zwraca `player.activeLoadout`.

## 4. Rzadkość i wzmacnianie do tieru 10
### 4.1 Rzadkość
Losowana przy wytwarzaniu z ziarna przedmiotu: pierwsza liczba z `rng(seed)` daje jakość (jak dziś), druga rzadkość. Ziarno zapisujemy w `items.seed` (nowa kolumna; dziś ziarno idzie tylko do losowania).

| id | Nazwa | Szansa | mult | Gniazda | Znak |
|---|---|---|---|---|---|
| zwykly | Zwykły | 70% | 1,00 | 0 | ● |
| solidny | Solidny | 22% | 1,08 | 1 | ◆ |
| mistrzowski | Mistrzowski | 7% | 1,18 | 2 | ★ |
| unikatowy | Unikatowy | 1% | 1,30 | 3 | ✦ |

Config: `items.rarity: [{id, name, chance, mult, sockets}]` (suma szans = 1, sprawdza zod). Klient pokazuje nazwę i znak, nie tylko kolor. Przedmioty sprzed migracji: `zwykly`. Rzadkości nie da się zmienić.

### 4.2 Tiery 6–10
- Tiery 1–5 bez zmian (Warsztat `workshop_base + t`, Radio 5, wzrost ×1,7).
- Tiery 6–10: Warsztat 10, badanie `kuznia_glebi` (Lab 8) dla 6–7 i `kuznia_rdzenia` (Lab 10, wymaga `kuznia_glebi`) dla 8–10. Koszt rudy od tieru 6: `koszt(5) × growth_high^(t−5)`, startowo `growth_high: 1,35` (tier 10 Wiertła rdzeniowego ≈ 100 tys. rudy zamiast ≈ 320 tys. przy ×1,7). Żetony i materiały jak dziś (× numer tieru).
- Bez szansy porażki. Bonus +10% za tier, naprawa +15% za tier, jak dziś.
- Config: `items.upgrade.max_tier: 10`, `growth_high`, `high_tiers: [{from: 6, tech: kuznia_glebi}, {from: 8, tech: kuznia_rdzenia}]`. Kod błędu: `tech_required`.
- Cel symulacji: gracz hardcore ma pierwszy przedmiot na tierze 10 w 5. miesiącu sezonu, nie wcześniej.

## 5. Runy
### 5.1 Rodzaje
Runa w magazynie to zasób w portfelu (`wallets`/dziennik), id `runa_{rodzaj}_{poziom}`, np. `runa_zyly_1`. Bonus runy jest **stały** (nie mnoży się przez jakość, rzadkość ani tier).

| Rodzaj | Działa na | I | II | III |
|---|---|---|---|---|
| zyly (Żyły) | moc zjazdu | +0,2 | +0,4 | +0,7 |
| ostrza (Ostrza) | atak | +0,3 | +0,6 | +1,0 |
| bastionu (Bastionu) | obrona | +0,3 | +0,6 | +1,0 |
| trwalosci (Trwałości) | koszt naprawy tego przedmiotu | −5% | −10% | −18% |

Runy Trwałości w jednym przedmiocie sumują się, ale naprawa nie tanieje bardziej niż o 40% (`runes.repair_cap`).

### 5.2 Wytwarzanie (poziomy I–II)
`POST /runes/{runeId}/craft` + `Idempotency-Key`, w Warsztacie.

| Poziom | Warsztat | Radio | Ruda | Żetony | Materiał |
|---|---|---|---|---|---|
| I | 3 | 5 | 300 | 0 | 8 |
| II | 6 | 5 | 1200 | 10 | 25 |

Materiał: Żyły = miedź, Ostrza = siarka, Bastionu = kryształ, Trwałości = po równo z trzech (zaokrąglone w górę). Powód w dzienniku: `rune_craft_cost`, wpis `+1` runy: `rune_craft`.

### 5.3 Łup (poziom III)
Przy udanym zjeździe druga gałąź losowania z ziarna zjazdu: `szansa = runes.drop.base × (minuty trasy / 480) × mnożnik strefy`, startowo `base: 0,02`, mnożniki stref rosnące z głębokością (`runes.drop.zone_mult`). Rodzaj losowany równo. Porażka = brak runy. Wpis w dzienniku `dive_reward` z ref `dive:{id}:rune`. Runa pojawia się w raporcie zjazdu (`rune: runeId|null`).

Zmiana losowania zjazdu nie może zmienić wyników istniejących pól (ruda, żetony, próbki, materiały) dla tego samego ziarna: runa bierze **osobny strumień** `rng(seed ^ RUNE_SALT)`. Test wektorowy w `test/` to pilnuje.

### 5.4 Osadzanie i wyjmowanie
- Tabela `item_runes(item_id bigint FK ON DELETE CASCADE, socket smallint, rune_id text, PRIMARY KEY (item_id, socket))`; `socket` od 0 do liczby gniazd z rzadkości − 1.
- `POST /items/{id}/runes` `{socket, rune}` + `Idempotency-Key`: `settle()`, blokada przedmiotu, wpis `−1` runy (`rune_socket`), zapis w `item_runes`. Błędy: `no_socket`, `socket_taken`, `unknown_rune`, `insufficient_{runeId}`.
- `POST /items/{id}/runes/{socket}/remove` + `Idempotency-Key`: opłata w rudzie (I 100, II 400, III 1000; `rune_unsocket_fee`), wpis `+1` runy (`rune_unsocket`), usunięcie wiersza. Błąd: `socket_empty`, `insufficient_ore`.
- `GET /items`: przedmiot ma `sockets` (liczba) i `runes: [{socket, runeId}]`; dochodzi `runes: {runeId: liczba}` z portfela i lista receptur run z blokadami.
- Na koniec sezonu runy znikają z portfeli, a `item_runes` z przedmiotami (FK).

## 6. Komplety
Config `items.sets: [{id, name, pieces: [recipeId...], bonus2: {...}, bonus4: {...}}]`. Bonus liczy się z **aktywnego zestawu** (dla zjazdu: z zestawu zapisanego w `dives.loadout`, w chwili dodania), tylko z niezepsutych części; każda receptura należy do co najwyżej jednego kompletu.

Dozwolone efekty (te same mechanizmy, co badania i zestaw): `dive_power` (stała), `dive_ore_pct`, `attack`, `defense`, `repair_pct`.

| id | Nazwa | Części | 2 części | 4 części |
|---|---|---|---|---|
| sztygar | Komplet Sztygara | mlot_pneumatyczny, helm_wzmocniony, lampa_wibracyjna, detektor_zylowy | dive_ore_pct 5 | dive_power 0,8 |
| rdzen | Komplet Rdzenia | wiertlo_rdzeniowe, kombinezon_izolowany, lampa_rezonansowa, skaner_sejsmiczny | dive_ore_pct 6 | repair_pct −25, dive_power 1,2 |
| wartownik | Komplet Wartownika | karabin_pneumatyczny, plyta_wartownika, noktowizor, celownik | defense 1,5 | attack 2,0 |

Progi nie sumują się z samymi sobą: 4 części dają bonus2 **i** bonus4. `dive_ore_pct` z kompletu mnoży się z mnożnikiem archetypu i badań tak jak `fx.diveOre`. `GET /items` zwraca `sets: [{id, name, pieces, have: {"1": n, "2": n}, bonus2, bonus4}]`.

## 7. Klient
Przed kodem: makieta nowego Warsztatu w artefakcie Design (jak Zjazdy i Warsztat w warstwie wizualnej), z:
- przełącznikiem **Zestaw I / Zestaw II** na górze (aktywny opisany słowem, nie tylko kolorem) i podsumowaniem zjazd/atak/obrona każdego zestawu;
- znakiem i nazwą rzadkości, gniazdami (puste/zajęte, z nazwą runy dla czytnika ekranu);
- postępem kompletu („Sztygar 2/4” + brakujące części);
- zakładką lub sekcją run (magazyn, wytwarzanie, osadzanie, wyjmowanie z kosztem).

Ekran Zjazdów pokazuje, którym zestawem pójdzie zjazd; Najazdy pokazują aktywny zestaw i jego atak/obronę. Komunikaty błędów z §3.3, §4.2 i §5 trafiają do `strings.dart`. Testy jak dotąd: fikstury z prawdziwego API, 320×640 przy tekście ×1,5, Semantics.

## 8. Wdrożenie (etapy) i symulacja
Każdy etap: migracja, config (`version`), `src/game` + testy jednostkowe, serwisy + testy na Postgresie, `sim:world` dla kilku ziaren, dopisek z wynikami w tym dokumencie, klient + testy, `npm run audit` = 0, commit. Etapy da się wypuścić osobno.

| Etap | Zakres | Migracja | Config |
|---|---|---|---|
| 1 | Zestawy, profil atak/obrona, bronie, zrzuty stanu, zużycie w najazdach, moc ligowa | 016: `loadouts`, `players.active_loadout`, `dives.loadout`, `dives.item_bonus`, `raids.attack_power`, `raids.attacker_loadout`, przeniesienie `equipped` | 1.6.0 |
| 2 | Rzadkość, tiery 6–10, badania `kuznia_glebi`, `kuznia_rdzenia` | 017: `items.rarity`, `items.seed` | 1.7.0 |
| 3 | Runy: wytwarzanie, łup III, osadzanie, wyjmowanie | 018: `item_runes` | 1.8.0 |
| 4 | Komplety | – | 1.9.0 |

**Wdrożenie etapu 1:** migracja 016 usuwa `items.equipped` (przenosi do `loadouts`), więc powrót do serwera sprzed 1.6.0 wymaga odtworzenia bazy z kopii. Przed wdrożeniem: kopia bazy.

`sim:world` musi modelować nowe wybory: gracze hardcore utrzymują dwa zestawy i przełączają przed atakiem, regularni mają jeden zestaw zjazdowy i czasem bojowy, okazjonalni nie przełączają wcale.

Kryteria akceptacji symulacji (po każdym etapie):
1. Zjazdy zostają głównym źródłem dochodu.
2. Udział najazdów w dochodzie rośnie najwyżej o 3 punkty procentowe względem 1.5.0.
3. Ruda nie zalega w setkach tysięcy (mediana graczy hardcore w dniu 180).
4. Pierwszy tier 10 u hardcore nie wcześniej niż w 5. miesiącu.
5. Ochrona początkujących działa: gracze poniżej `beginner_protection_level` nie są celem bez względu na zestaw.

Jeśli kryterium nie wychodzi, nie zmieniamy balansu na własną rękę: liczby idą do Damiana.

## 9. Ryzyka
- **Przełączanie jako obowiązek:** jeśli zestaw bojowy w obronie daje dużo więcej, gracze będą siedzieć w nim stale i stracą na zjazdach, albo przeciwnie. Symulacja mierzy, ile dochodu traci gracz, który nigdy nie przełącza (cel: najwyżej kilka procent).
- **Dodatkowe zapytania w `settle()`:** zestaw, runy i komplety w każdym rozliczeniu zjazdu. Zrzut mocy przy dodaniu do kolejki to ogranicza; rozliczenie czyta tylko zapisane liczby i zużywa przedmioty jednym `UPDATE`.
- **Zgodność klienta:** pole `equipped` zostaje (znaczy „w aktywnym zestawie”), więc obecny klient działa do czasu nowego Warsztatu.

## 10. Wyniki etapu 1 (config 1.6.0, `sim:world -- 180 --traders=5`)
Punkt odniesienia: 1.5.0 (commit fdfca61). W symulacji hardcore i regularni budują zestaw bojowy (II) i przełączają się na niego tylko na chwilę wysłania najazdu, więc bronią się zestawem zjazdowym (I); okazjonalni mają jeden zestaw.

| Ziarno | Łupy z najazdów w dochodzie 1.5.0 → 1.6.0 | Najazdy na gracza/dobę | Udział zjazdów (hardcore / regularni) | Ruda w magazynie (średnio) | Mediana utraconego dochodu |
|---|---|---|---|---|---|
| 1 | 10,4% → 19,1% | 0,56 → 1,54 | 70/73% → 68/69% | 30,3 tys. → 21,1 tys. | 7,1% → 15,4% |
| 2 | 9,4% → 19,1% | 0,52 → 1,53 | 71/72% → 69/70% | 29,4 tys. → 21,4 tys. | 7,7% → 16,2% |
| 3 | 10,8% → 19,0% | 0,59 → 1,52 | 70/73% → 68/70% | 30,3 tys. → 20,6 tys. | 8,4% → 15,4% |

Kryteria z §8: 1 (zjazdy głównym źródłem) **spełnione**; 2 (najazdy +≤3 pkt) **niespełnione: +9 pkt**; 3 (ruda nie zalega) spełnione (spada o ok. 30%, głównie przez naprawy: 29% → 38% dochodu); 5 (ochrona początkujących) bez zmian w kodzie.

Przyczyna: asymetria. Atak korzysta z zestawu bojowego za darmo (przełączenie na chwilę wysłania, zrzut ataku), a obrona wymaga siedzenia w zestawie bojowym kosztem zjazdów, więc nikt tego nie robi. Średni atak zestawu II: 6,8 (hardcore), 5,5 (regularni), wobec obrony zestawu I: 1,4 / 0,0. Boty atakują tylko przy szansie ≥ 50%, a broń podnosi szansę ponad próg u wielu par, stąd prawie 3× więcej najazdów.

**Balansu nie zmieniano; decyzja u Damiana.** Możliwe kierunki: (a) mniejszy atak broni; (b) obrona liczy też część profilu zestawu nieaktywnego albo pancerz z obu zestawów; (c) atak z zestawu aktywnego w chwili **dotarcia** (zestaw bojowy trzeba utrzymać przez czas dojazdu, więc kosztuje zjazdy); (d) czas przełączenia zestawu (np. kilka minut „przezbrajania”).

### 10.1 Decyzja: obrona z obu zestawów + słabsze bronie (config 1.6.0)
Damian wybrał obronę z obu zestawów. Sam udział (0,5 / 0,75 / 1,0) obniżał łupy tylko do 17 / 16 / 14% dochodu, więc dobrano też atak broni (próby: ×0,4–×0,6). Wybrany wariant: **atak przedmiotów ×0,6** (wartości w tabeli §2) i **`passive_defense_share: 0,75`**.

| Ziarno | Łupy w dochodzie (1.5.0 → 1.6.0) | Najazdy/gracz/dobę | Udział zjazdów (hardcore / regularni) | Ruda w magazynie | Mediana utraconego dochodu |
|---|---|---|---|---|---|
| 1 | 10,4% → 10,3% | 0,56 → 0,82 | 69/71% | 24,6 tys. | 10,2% |
| 2 | 9,4% → 10,1% | 0,52 → 0,84 | 69/70% | 24,1 tys. | 10,2% |
| 3 | 10,8% → 9,8% | 0,59 → 0,81 | 68/71% | 24,3 tys. | 10,2% |

Kryteria §8: 1, 2, 3 spełnione (5 bez zmian w kodzie). Średni atak zestawu bojowego 4,1 (hardcore) / 3,3 (regularni), obrona silosu 4,8 / 2,7: sprzęt waży w obie strony. Najazdów jest ok. 50% więcej niż w 1.5.0, ale łup na najazd mniejszy; mediana utraconego dochodu rośnie z ok. 7,5% do 10%. Okazjonalni nie budują zestawu bojowego i bronią się samymi statystykami; do obserwacji w becie.
