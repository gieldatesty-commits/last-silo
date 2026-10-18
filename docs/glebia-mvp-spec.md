# Głębia – specyfikacja MVP (wersja 0.1)

> Dokument roboczy dla pracy **solo + AI**. Opiera się na `bloodwars-research-mobile-brief.md` (sekcje 5, 7a–7d).
> Wszystkie liczby to **wartości startowe do strojenia** w symulatorze i na becie – nie finalny balans.
> **Aktualizacja 18.10.2026:** fabuła zmieniona na „Silosy i Rdzeniowcy” – patrz `swiat-v0.2-silosy.md` (sztolnia → silos, Kolosy → Starsi, każdy gracz ma silos w losowym miejscu planety, wrogiem jest prymitywny gatunek z okolic jądra). Poniższe sekcje używają jeszcze starych nazw; zmiany mechaniczne są w sekcjach 7–9 tamtego dokumentu (m.in. 6. budynek **Radiostacja**: najazdy, rynek i ranking dostępne dopiero po odkryciu innych silosów; zasoby skończone i ukryte).
> Nazwy (Głębia, żetony, para, zjazdy itd.) są robocze; przed publikacją sprawdzić znaki towarowe.
> Spec nie jest poradą prawną; punkty zgodności ze sklepem/RODO sprawdzić w aktualnych wymaganiach Google Play.

---

## 1. Cel MVP

**Cel:** zamknięta beta (30–50 graczy), w której nowy gracz przez **7 dni** może: założyć postać, rozbudować sztolnię, chodzić na zjazdy, robić najazdy async, handlować na prostym rynku i wracać dzięki powiadomieniom push – **bez ręcznych interwencji dewelopera**.

**Hipotezy do zweryfikowania:**
1. Pętla „zjazd → zasoby → budowa/rzemiosło → najazd/handel" jest satysfakcjonująca w krótkich sesjach.
2. Ligi siły + okna ochronne wystarczają, by nowi nie byli stale rabowani.
3. Powiadomienia push realnie zwiększają powroty.
4. Prosty rynek ma sens nawet przy małej liczbie graczy (z botami cenowymi jako „podłogą").

**Definicja ukończenia MVP (DoD):**
- 30 testerów gra 7 dni, brak utraty/duplikacji zasobów (audyt ledgera czysty),
- wszystkie timery kończą się na czas (±5 s) i wysyłają push,
- dane mierzone: D1/D7, czas do pierwszego zjazdu/najazdu/transakcji, średnia liczba sesji/dzień,
- backup/restore przetestowany.

---

## 2. Zakres

### W MVP (must have)
- Konto gościa + powiązanie z kontem Google (min. bezpieczny powrót po zmianie telefonu).
- Tworzenie postaci: nazwa, archetyp (4), 4 statystyki.
- **Sztolnia** z 5 budynkami: Szyb główny, Generator pary, Magazyn, Warsztat, Wartownia.
- **Zasoby:** ruda, para, żetony.
- **Zjazdy** (PvE solo): 3 trasy, timery, ryzyko, nagrody, drop przedmiotów.
- **Rzemiosło** (1 profesja w MVP: Kowal/Szwacz-lite): 6 receptur.
- **Ekwipunek:** 3 sloty (narzędzie, pancerz, lampa).
- **Najazdy** (PvP async) z ligami, oknami ochronnymi, raportem.
- **Rynek:** wystawienia o stałej cenie (kup teraz), prowizja, limity.
- **Ranking** sezonowy („Sezon 0").
- **Push** (FCM) dla zdarzeń kluczowych.
- **Tutorial** (6 kroków).
- **Telemetria** + panel logów/ledgera (minimalny).

### Poza MVP (backlog)
Cechy (klany), szturm na węzeł i mapa-graf, zejścia na Kolosy, więcej profesji, order book, abonament, kolejka akcji (struktura danych jednak od razu), iOS, wiele postaci, czat, panel admina z edytorem balansu.

---

## 3. Stos technologiczny (rekomendacja)

| Warstwa | Wybór | Uzasadnienie |
|---|---|---|
| Klient | **Flutter** (Android) | Dobry do UI-heavy gry tekstowo-ikonowej; ten sam kod pod iOS później |
| Serwer | **TypeScript (Node.js)** + Fastify lub NestJS | Jeden język, dużo wsparcia AI, szybkie prototypowanie; typy współdzielone z walidacją konfigu |
| Baza | **PostgreSQL** | Transakcje ACID (kluczowe dla ekonomii) |
| Zadania/timery | **pg-boss** (kolejka na Postgres) | Brak dodatkowej infrastruktury na start; opcjonalnie Redis później |
| Push | **Firebase Cloud Messaging** | Standard dla Androida |
| Hosting start | Jeden VPS + Docker Compose (API, worker, Postgres, reverse proxy z TLS) | Najtaniej; łatwa migracja do chmury |
| Konfiguracja gry | **YAML/JSON w repo + walidacja schematem** (np. zod) | Szybkie zmiany balansu bez przepisywania kodu |
| CI | GitHub Actions: testy, lint, build obrazów | Powtarzalne wdrożenia |
| Monitoring | logi strukturalne + prosty health-check/alerty | Wystarczy na betę |

**Zasady architektoniczne:**
1. **Serwer autorytatywny** – klient nigdy nie decyduje o wyniku, czasie ani saldzie.
2. **Czas = czas serwera.** Zakończenia akcji ustawiane jako zadania (scheduler) + **idempotentne rozliczanie** (`settle`) wywoływane też przy otwarciu aplikacji (łata na opóźnienia).
3. **Każda zmiana salda przez ledger** (patrz sekcja 5.1).
4. **Idempotency-Key** dla wszystkich operacji zmieniających stan (ochrona przed podwójnym kliknięciem/retry).
5. **RNG z ziarnem** zapisywanym przy zdarzeniu (powtarzalne rozstrzygnięcia, łatwe debugowanie).
6. **Wersjonowana konfiguracja** (`config_version`) – każde zdarzenie wie, według jakiego balansu zostało policzone.

**Struktura repozytorium (monorepo):**
```
/glebia
  /server      # API + worker
  /client      # Flutter
  /config      # YAML: budynki, trasy, receptury, przedmioty, ligi
  /tools       # symulator ekonomii, skrypty importu/audytu
  /docs        # brief, spec, decyzje
```

---

## 4. Model danych (tabele główne)

Uwaga: nazwy robocze; typy uproszczone.

| Tabela | Najważniejsze pola |
|---|---|
| `users` | id, created_at, auth_provider, auth_id, locale, deleted_at |
| `devices` | id, user_id, fcm_token, platform, last_seen_at |
| `players` | id, user_id, name (unikalna), archetype, level, xp, season_id, league, power_score, silo_lat, silo_lon, depth, created_at |
| `player_stats` | player_id, sila, technika, percepcja, wytrwalosc, free_points |
| `wallets` | player_id, ruda, para, zetony, para_updated_at (regeneracja liczona, nie ticking) |
| `ledger_entries` | id, player_id, currency, delta, reason, ref_type, ref_id, created_at, config_version (**niezmienialny dziennik**) |
| `buildings` | player_id, type, level, upgrade_started_at, upgrade_ends_at |
| `jobs` | id, player_id, kind (building/dive/craft), ends_at, state, payload, idempotency_key |
| `dives` | id, player_id, route_id, started_at, ends_at, seed, state, result_json |
| `raids` | id, attacker_id, defender_id, started_at, ends_at, seed, state, result_json |
| `items` | id, owner_id, template_id, quality, durability, equipped_slot |
| `item_templates` | (z configu) |
| `market_listings` | id, seller_id, kind (ore/item), item_id?, qty, unit_price, state, created_at, expires_at |
| `market_trades` | id, listing_id, buyer_id, seller_id, qty, price, fee, created_at |
| `notifications` | id, player_id, type, payload, sent_at, read_at |
| `seasons` | id, name, starts_at, ends_at, state |
| `events_log` | id, player_id?, type, payload, created_at (telemetria + audyt) |

**Reguła salda:** `wallets` = cache; prawdą jest suma `ledger_entries`. Nocny skrypt audytu porównuje oba (alarm przy różnicy).

---

## 5. Mechaniki MVP (wartości startowe)

### 5.1 Zasoby i ledger
- **Ruda** – surowiec do budowy i rzemiosła; produkowana pasywnie przez Szyb główny.
- **Para** – energia do akcji (zjazdy, najazdy); regeneruje się w czasie, pojemność zależy od Generatora.
- **Żetony** – waluta miękka, zamknięta; źródło: sprzedaż na rynku, nagrody ze zjazdów/najazdów.
- Dopuszczalne `reason` w ledgerze: `building_cost`, `dive_cost`, `dive_reward`, `raid_loot`, `raid_loss`, `craft_cost`, `market_sale`, `market_purchase`, `market_fee`, `tutorial_reward`, `admin_adjust`.

### 5.2 Postać i statystyki
- 4 archetypy (Górnik, Inżynier, Zwiadowca, Alchemik) z różnymi **startowymi rozkładami** 4 statystyk i drobnym bonusem pasywnym:
  - Górnik: +Siła, +Wytrwałość, bonus do rudy z zjazdów,
  - Inżynier: +Technika, tańsze ulepszenia budynków,
  - Zwiadowca: +Percepcja, mniejszy koszt pary na zjazdach,
  - Alchemik: balans, bonus do jakości rzemiosła (w MVP: +% szansy na wyższą jakość przedmiotu).
- Poziom: XP z zjazdów/najazdów; **+3 punkty statystyk na poziom**; poziom maksymalny w MVP: **30**.
- **Moc** (power_score) = `Siła*1.0 + Technika*0.6 + Percepcja*0.6 + Wytrwałość*0.8 + suma_bonusów_przedmiotów`.
  Liga wyliczana z mocy (progi w configu).

### 5.3 Sztolnia – budynki (5)
| Budynek | Efekt | Wzór (poziom L) – wartość startowa |
|---|---|---|
| **Szyb główny** | ruda/godz. | `prod = 40 * 1.30^(L-1)` |
| **Generator pary** | pojemność i regeneracja pary | `cap = 100 + 25*(L-1)`, `regen = 1 + 0.2*(L-1)` pary/min |
| **Magazyn** | pojemność zasobów i % chroniony przed najazdem | `cap = 1000 * 1.5^(L-1)`, `protected = min(0.6, 0.10*L)` |
| **Warsztat** | dostęp do receptur i ich tier | L1: tier 1, L3: tier 2, L5: tier 3 |
| **Wartownia** | obrona przed najazdami | `+3 * L` do obrony |

- **Koszt i czas ulepszenia:** `koszt(L) = bazowy * 1.6^(L-1)`, `czas(L) = t0 * 1.5^(L-1)` (t0 ~ 1 min dla L1 → ok. 8 godz. dla L8–9).
- Poziomy maks. w MVP: 8 (konfigurowalne).
- **Kolejka budowy:** 1 slot (wolny); liczba slotów jako parametr gracza (przyszły abonament).

### 5.4 Zjazdy (PvE solo)
- **Koszt:** para; **czas:** timer; **wynik:** szansa sukcesu.
- 3 trasy (przykład dla poziomu 1–5, skalowane przez config):
  | Trasa | Czas | Koszt pary | Trudność | Nagroda |
  |---|---|---|---|---|
  | Płytki | 3 min | 5 | niska | mało rudy, mało XP |
  | Średni | 15 min | 15 | średnia | więcej rudy, XP, szansa na przedmiot |
  | Głęboki | 60 min | 40 | wysoka | dużo rudy, wysoka szansa na przedmiot lepszej jakości |
- **Szansa sukcesu (skalowalna):**
  `moc_zjazdu = 0.5*Technika + 0.3*Percepcja + 0.2*Wytrwałość + bonus_przedmiotów`
  `p = clamp(0.5 + (moc_zjazdu - trudność) / (2*trudność), 0.10, 0.90)`
- **Porażka:** brak twardej śmierci; gracz traci część wydanej pary (nie zwrot) i dostaje **krótką „zadyszkę"** (blokadę następnego zjazdu na X min) – lekka kara dla tempa, nie dla postępu.
- **Drop:** tabela łupów w configu; jakość przedmiotu zależy od trasy i losowania z ziarna.
- **Limit aktywnych zjazdów:** 1 (parametr `queue_slots` dla przyszłego abonamentu).
- **Rozliczenie:** scheduler kończy zadanie o `ends_at`; gracz „odbiera" nagrodę przyciskiem lub automatycznie przy otwarciu aplikacji.

### 5.5 Rzemiosło i ekwipunek
- **6 receptur w MVP** (po 2 na 3 sloty): zużywają rudę i żetony, trwają kilka–kilkanaście minut.
- **Jakość:** Zwykła / Dobra / Doskonała; szansa zależy od tieru Warsztatu i (opcjonalnie) archetypu.
- **Trwałość:** zużycie przy zjazdach i najazdach; **naprawa za żetony/rudę** (stałe ujście zasobów).
- Przedmioty dają bonusy do: Siły (atak), Wytrwałości/obrony, Techniki/Percepcji (zjazdy).

### 5.6 Najazdy (PvP async)
- **Cel:** wybierany z listy 8–12 graczy **z tej samej ligi** (moc ±25%), bez graczy pod ochroną.
- **Koszt:** para; **czas:** 3 minuty (w przyszłości zależny od mapy).
- **Rozstrzygnięcie:**
  `A = Siła + 0.4*Percepcja + bonus_ataku`
  `D = Wytrwałość + 3*poziom_Wartowni + bonus_obrony`
  `P(wygrana atakującego) = 1 / (1 + exp(-3 * ln(A/D)))`
  Wynik losowany z ziarna; raport pokazuje 3–5 „rund" (generowane kosmetycznie na bazie wyniku).
- **Łup (jeśli wygra atakujący):** do **8%** niechronionej rudy i żetonów obrońcy; chroniony udział wynika z poziomu Magazynu (`protected`); górny limit łupu na jeden najazd.
- **Jeśli wygra obrońca:** atakujący nie dostaje łupu, traci wydaną parę; obrońca dostaje drobny XP.
- **Ochrona i limity:**
  - po byciu rabowanym: **ochrona 90 min**,
  - ten sam cel: maks. 1 najazd/3 godz. i 3/dobę,
  - gracz od poziomu 1–3 jest „pod ochroną nowicjusza" (nie może być celem; zdejmowana po poziomie 5 lub 3 dniach).
- **Raport:** jeden ekran (wynik, łup, zmiany statystyk, przycisk „kolejny cel").
- **Powiadomienie:** push do obrońcy o najeździe.

### 5.7 Rynek (prosty)
- **Wystawienia o stałej cenie** (kup teraz): ruda (w stosach), przedmioty.
- **Opłaty:** 1% depozytu przy wystawieniu (zwrot przy sprzedaży), **5% prowizji** od transakcji.
- **Limity MVP:** 5 aktywnych wystawień; cena w korytarzu `[0.2x … 5x]` mediany z 7 dni (anty-push); gracz z poziomem < 5 nie handluje (anty-multikonta).
- **Ceny odniesienia:** boty „podłogi cen" (zlecenia kupna od NPC po niskiej cenie), żeby rynek działał także przy małej liczbie graczy.
- **Wygasanie:** wystawienia wygasają po 48 godz.

### 5.8 Ranking i sezon
- **Sezon 0:** jeden sezon betowy, bez resetu w MVP (skrypt resetu jako zadanie etapu 6).
- **Ranking:** po mocy i po zdobytych łupach w ostatnich 7 dniach (dwie listy).

### 5.9 Tutorial (6 kroków)
1. Wybór archetypu i imienia.
2. Pierwsza budowa/ulepszenie Szybu głównego.
3. Pierwszy zjazd (skrócony timer).
4. Pierwsze rzemiosło (narzędzie).
5. Pierwszy najazd na bota-szkoleniowca.
6. Pierwsza sprzedaż/zakup na rynku (z podpowiedzią cen).
Nagroda: zestaw startowy (ruda, para, żetony) i wskazówka „co dalej" w panelu.

### 5.10 Powiadomienia push
- Zjazd zakończony, budowa/rzemiosło ukończone, najazd na Ciebie, sprzedano wystawienie, para pełna.
- Ustawienia: wyciszenie typów, godziny ciszy; zgoda na powiadomienia zgodnie z wymaganiami Androida.

---

## 6. API (zarys REST/JSON)

Nagłówki: `Authorization: Bearer <token>`, `Idempotency-Key` dla POST/PUT/DELETE.

| Grupa | Endpoint | Opis |
|---|---|---|
| Auth | `POST /auth/guest` | utworzenie konta gościa |
| | `POST /auth/link-google` | powiązanie z kontem |
| | `DELETE /me` | usunięcie konta (wymóg sklepu) |
| Profil | `GET /me`, `POST /players`, `POST /players/stats` | profil, utworzenie, rozdanie punktów |
| Sztolnia | `GET /sztolnia`, `POST /buildings/{type}/upgrade` | stan, ulepszenie |
| Zjazdy | `GET /dives/routes`, `POST /dives`, `GET /dives`, `POST /dives/{id}/claim` | lista tras, start, stan, odbiór |
| Rzemiosło | `GET /recipes`, `POST /craft`, `GET /jobs` | receptury, start, kolejka |
| Ekwipunek | `GET /inventory`, `POST /items/{id}/equip`, `POST /items/{id}/repair` | |
| Najazdy | `GET /raids/targets`, `POST /raids`, `GET /raids/{id}` | cele, start, raport |
| Rynek | `GET /market/listings`, `POST /market/listings`, `POST /market/listings/{id}/buy`, `DELETE /market/listings/{id}` | |
| Ranking | `GET /ranking?type=power|loot` | |
| Powiadomienia | `GET /notifications`, `POST /devices/token` | |
| Konfiguracja | `GET /config` | wersja i publiczna część balansu (do UI) |

**Zasady bezpieczeństwa API:** limity zapytań (rate limiting), walidacja schematami, brak ufania wartościom z klienta, logowanie anomalii (np. zbyt wiele akcji/min).

---

## 7. Ekrany klienta (mobile-first)

1. **Start/Logowanie/Tutorial**
2. **Sztolnia (ekran główny):** pionowy przekrój kolonii, paski zasobów (ruda/para/żetony) zawsze widoczne, pasek XP, lista budynków i stan zadań.
3. **Zjazdy:** 3 trasy + aktywny zjazd + przycisk „kolejny zjazd" (po odbiorze zostajesz na tym ekranie).
4. **Warsztat/Rzemiosło:** receptury, kolejka.
5. **Ekwipunek:** przełącznik tekst/ikony (zapamiętany), sloty, naprawy.
6. **Najazdy:** lista celów (sortowanie zapamiętane, duży przycisk ataku), raport w jednym widoku.
7. **Rynek:** wyszukiwanie, wystawienie, historia cen (prosty wykres), moje oferty.
8. **Ranking**
9. **Ustawienia:** powiadomienia, język, usunięcie konta, polityka prywatności.

**Zasady UX (z analizy skarg graczy BW):** duże cele dotykowe, brak zbędnego przewijania, zapamiętywanie filtrów/sortowania, jedna ścieżka „co robić teraz", natychmiastowa informacja zwrotna po akcji, tryb tekstowy jako opcja trwała.

---

## 8. Ekonomia – symulator i zabezpieczenia

- **Symulator (`/tools/sim`):** skrypt (np. TypeScript/Python) uruchamiający Monte Carlo dla 1000 graczy–botów przez 30 dni: zużycie pary, produkcję rudy, przepływ żetonów, ceny na rynku, tempo awansu.
- **Wskaźniki zdrowia ekonomii:** suma źródeł vs ujść na dobę, mediana majątku po 7 dniach, udział łupów w dochodach, czas do pierwszego ulepszenia L5.
- **Anty-inflacyjne ujścia w MVP:** koszt ulepszeń, naprawy przedmiotów, prowizja rynku, część pary „spalona" w nieudanych zjazdach.
- **Anty-nadużycia:** limity cen, nowe konta bez handlu, wykrywanie przelewów między kontami (podejrzane powtarzalne transakcje), logi do audytu, możliwość „zamrożenia" konta.

---

## 9. Telemetria i analityka

Zdarzenia (`events_log`): rejestracja, ukończenie tutoriala, pierwsze ulepszenie, pierwszy zjazd/najazd/transakcja, sesje (start/koniec), powroty z push, błędy API.
Wskaźniki: D1/D7 retention, liczba sesji dziennie, czas do pierwszej akcji PvP, odsetek graczy bez akcji po 24 godz., rozkład mocy po tygodniu.
Prywatność: minimalizacja danych, zgodnie z polityką prywatności i RODO; anonimizacja w analityce, tam gdzie to możliwe.

---

## 10. Plan etapów (solo + AI)

> Szacunki orientacyjne przy pracy po godzinach; skorygować po M1 na podstawie realnej prędkości.

| Etap | Zakres | Orientacyjny czas | Kryterium ukończenia |
|---|---|---|---|
| **M0 – Fundamenty** | repo, CI, Docker Compose, Postgres, szkielet API i klienta, config YAML + walidacja, auth gościa | 1–2 tyg. | `GET /me` działa na urządzeniu; wdrożenie 1-klik na VPS |
| **M1 – Rdzeń gry** | ledger, wallet, postać, statystyki, budynki + ulepszenia z timerami (pg-boss) | 2–3 tyg. | Budowa kończy się na czas, push działa, audyt ledgera zielony |
| **M2 – Zjazdy i ekwipunek** | trasy, rozstrzyganie, drop, przedmioty, naprawy | 2–3 tyg. | Pełna pętla zjazd→nagroda→ulepszenie; testy jednostkowe formuł z ziarnem |
| **M3 – Najazdy** | cele, ligi, rozstrzyganie, raport, ochrona, push | 2 tyg. | Najazd działa async; zasady ochrony przetestowane |
| **M4 – Rynek** | wystawienia, kupno, prowizje, limity, boty podłogi | 2 tyg. | Brak duplikacji zasobów przy równoległych zakupach (testy współbieżności) |
| **M5 – Tutorial, ranking, UX, ustawienia** | tutorial, ranking, polish, usunięcie konta, polityka prywatności | 2 tyg. | Nowy tester przechodzi tutorial bez pomocy |
| **M6 – Beta zamknięta** | telemetria, backup/restore, monitoring, 30–50 testerów, poprawki | 2–4 tyg. | DoD z sekcji 1 spełnione |

Łącznie: **ok. 13–19 tygodni** przy pracy po godzinach (to szacunek, nie obietnica).

---

## 11. Jakość i testowanie

- **Testy jednostkowe** wszystkich formuł z kontrolowanym ziarnem (powtarzalność).
- **Testy współbieżności** dla rynku i salda (równoległe zakupy, podwójne kliknięcia).
- **Testy integracyjne** API na bazie testowej, skrypty „bot-gracz" symulujące 7 dni.
- **Testy scheduler'a:** kończenie zadań po restarcie serwera, opóźnienia, ponowne rozliczenie.
- **Audyt nocny:** zgodność ledgera z saldami; alert.
- **Backup:** codzienny zrzut bazy poza serwer + próba odtworzenia przed betą.

---

## 12. Wykorzystanie AI w procesie (praktyka solo)

- **Kod:** generowanie szkieletów, testów, migracji; każdy kluczowy moduł ekonomii przeglądany ręcznie.
- **Grafika:** wspólny **style guide** (paleta, kontrast, oświetlenie, zestaw ikon), spójne prompty; ikony zasobów/budynków/przedmiotów jako paczka; **sprawdzić licencję komercyjną** użytego generatora i zachować zapisy promptów.
- **Teksty:** własne opisy, bez kopiowania z BW; terminy ze słownika (sekcja 7d briefu).
- **Zasada:** AI przyspiesza, ale **ledger, rynek i rozstrzyganie** powinny być napisane i zrozumiane przez Ciebie (praca wokół pieniędzy gry nie może być „czarną skrzynką").

---

## 13. Zgodność i publikacja (minimum)

- Polityka prywatności, informacja o danych (Data Safety w Google Play), zgoda na powiadomienia.
- **Usunięcie konta** z poziomu aplikacji (i ścieżka webowa, jeśli wymagana) – sprawdzić aktualne wymagania sklepu.
- Ocena wiekowa i zasady dla treści (przemoc stylizowana, brak hazardu).
- **Brak wypłat/wymiany na realne pieniądze** (ekonomia zamknięta).
- Ścieżka testów zamkniętych Google Play przed publikacją.
- Znak towarowy/nazwa: sprawdzić w UPRP/EUIPO i sklepach.

---

## 14. Ryzyka i ograniczenia

| Ryzyko | Skutek | Mitigacja |
|---|---|---|
| Zakres za duży na solo | Opóźnienia | Ścisły MVP; backlog poza zakresem; wycinanie rzemiosła do „lite" jeśli trzeba |
| Błędy w ekonomii/ledgerze | Utrata zaufania graczy | Ledger niezmienialny, testy współbieżności, nocny audyt |
| Zbyt mała liczba graczy na rynku/najazdach | Martwa pętla | Boty „podłogi cen", boty-cele szkoleniowe, ligi z szerokim zakresem na starcie |
| Balans „na oko" | Frustracja/nuda | Symulator + strojenie w becie z telemetrią |
| Wąskie gardło scheduler'a | Opóźnienia timerów | Idempotentny `settle` przy otwarciu + monitoring opóźnień |
| Ryzyko prawne/IP | Zgłoszenia, odrzucenie w sklepie | Własne nazwy/lore/grafika; konsultacja prawnika przed premierą |
| Wypalenie przy pracy solo | Brak postępu | Krótkie milestone'y, widoczne efekty co 2 tygodnie |

---

## 15. Decyzje przed M0 (zatwierdzone)

1. **Nazwa:** gra **Last Silo**; **Głębia** zostaje nazwą świata. Przed publikacją sprawdzić UPRP, EUIPO i Google Play (kolizje nazw).
2. **Serwer:** Fastify + TypeScript + Kysely (ew. Drizzle) + PostgreSQL + pg-boss.
3. **Logowanie:** gość + Google Sign-In (Credential Manager), z możliwością powiązania konta gościa. E-mail (magic link) po MVP, Apple razem z iOS.
4. **Język UI:** polski w MVP; wszystkie teksty w plikach tłumaczeń (Flutter ARB), angielski później.
5. **Hosting:** jeden VPS w UE (Hetzner, klasa CX22) + Docker Compose, codzienne backupy bazy na zewnętrzny storage. Budżet orientacyjnie 10–15 € miesięcznie plus domena i jednorazowe 25 USD za konto Google Play (ceny do weryfikacji przy zakupie).
6. **Analityka:** własna tabela `events_log` w Postgresie + Firebase Crashlytics. Firebase Analytics dopiero przy potrzebie kohort i lejków.

---

## 16. Backlog po MVP (kolejność sugerowana)
1. Cechy + skarbiec + panel zarządzania.
2. Mapa-graf, szturm na węzeł.
3. Zejścia na Kolosy (PvE cechowe).
4. Więcej profesji + order book rynku.
5. Abonament (kolejki akcji, panel cechu, alerty cen).
6. Sezony z resetem i bonusami startowymi.
7. iOS.

> Aktualizacja 18.10.2026 (kolejność po MVP wg `swiat-v0.2-silosy.md`, sekcja 14): karawany → dawne technologie → luźne sojusze → kolej między silosami → sezon „Wyjście” (powierzchnia). Zakres MVP bez zmian.
