# Last Silo: instrukcja dla Claude Code

Mobilna gra (Android, Flutter) w świecie **Głębi**: podziemne silosy rozsiane po nienazwanej sferze, wróg to Rdzeniowcy. Inspirowana Blood Wars, ale celowo odmienna (prawa autorskie). Autor: Damian, pracuje solo z AI. **Odpowiadaj po polsku, zwięźle, bez lania wody.** Nazwa „Last Silo” czeka na sprawdzenie znaku towarowego.

Szczegóły: spec `docs/glebia-mvp-spec.md`, systemy i balans `docs/*-v1.0.md` (balans, sezony, rynek, karawany, kontrakty, ekwipunek, subskrypcja, konto Google, warstwa wizualna), API w `README.md`. Plany wdrożeń: `docs/superpowers/plans/`.

## Zasady projektu (nie łamać bez zgody Damiana)
1. **Ekonomia zamknięta**: brak wymiany na prawdziwe pieniądze. Subskrypcja daje wygodę (kolejka, powiadomienia), nie siłę. Zero pay-to-win.
2. **Serwer jest autorytatywny**; klient tylko wyświetla i wysyła intencje. Tanio i skalowalnie (jeden VPS, Postgres).
3. **Cały balans w `config/game.yaml`** (wersjonowany, obecnie 1.9.0). Zmiana balansu = config + symulacja + dopisek w dokumencie. Nie wpisuj liczb gry w kod (także w kliencie: liczby przychodzą z API).
4. **Losowość tylko z ziarna** (mulberry32 w `src/game`), ziarno zapisane przy zdarzeniu. Zero `Math.random()` w logice gry.
5. **Pieniądze/zasoby tylko przez niezmienny dziennik** (`ledger.ts`, `applyLedger`). Po zmianach w ekonomii `npm run audit` musi dawać 0 różnic.
6. **Akcje mutujące wymagają `Idempotency-Key`**; rozliczenia są leniwe i idempotentne w `settle()` (kolejność: najazdy → karawany → zlecenia → rdzeń; blokada wiersza `silos FOR UPDATE`).
7. Nowa tabela/kolumna = nowa migracja SQL w `server/migrations/` (kolejne numery, aktualnie do 019). Nie edytuj starych po wdrożeniu.

## Struktura
- `server/` — Node 22, TypeScript (ESM, NodeNext), Fastify 5, Kysely + pg, PostgreSQL 16, pg-boss 12, zod 4, vitest.
  - `src/game/` czysta logika (formuły, zjazdy, rynek, karawany, kontrakty, upgrade + rzadkość, runy, komplety, geologia), bez bazy.
  - `src/services/` transakcje i reguły: silo, items (zestawy, runy w gniazdach), gear (profil zestawu), runes, research, codex, radio, raids, trade, market, caravans, contracts, season, subscription, account.
  - `src/app.ts` trasy HTTP · `config.ts` schematy zod configu · `db.ts` typy Kysely · `scheduler.ts` zadania pg-boss (m.in. `season-tick` co 5 min, `subscription-sync`) · `billing.ts`, `google-id.ts` (Google Play, Google Sign-In za interfejsami z atrapami) · `sim/` symulatory.
  - `test/` ~227 testów (potrzebują Postgresa; `fileParallelism: false`).
- `client/` — Flutter (Android). `lib/api.dart` (HTTP, JWT gościa, klucze idempotencji) → `app_state.dart` (ChangeNotifier) → `screens/*`. Wspólne: `widgets.dart` (`Loader`, `act`, dialogi), `strings.dart` (teksty PL, komunikaty błędów, opisy run/kompletów), `format.dart` (`fmtInt`, `fmtDec` z przecinkiem), `palette.dart` + `ui.dart` (ciemny motyw `Ls`, komponenty `Ls*`), grafiki jako CustomPainter (`building_art.dart`, `resource_art.dart`, `slot_icon.dart`, konstelacja Laboratorium).
  - `test/` ~98 testów widżetów na fiksturach z prawdziwego API (`test/fixtures/`), w tym 320×640 przy tekście ×1,5 (bez przepełnień i uciętego tekstu).
- `config/game.yaml`, `docs/`, `docker-compose.yml` + `Caddyfile` (produkcja na VPS: app + db + caddy), `.env.example`.

## Uruchomienie lokalnie
```bash
# 1) baza deweloperska (docker-compose.yml to stos produkcyjny, nie używaj go do dev)
docker run -d --name lastsilo-db -p 5432:5432 -e POSTGRES_USER=lastsilo -e POSTGRES_PASSWORD=lastsilo -e POSTGRES_DB=lastsilo postgres:16
docker exec lastsilo-db createdb -U lastsilo lastsilo_test

# 2) serwer (bash; w PowerShellu ustaw zmienne przez $env:NAZWA="...")
cd server && npm ci
export DATABASE_URL=postgres://lastsilo:lastsilo@localhost:5432/lastsilo
export TEST_DATABASE_URL=postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test
export JWT_SECRET=dev-secret-1234567890
npm run typecheck && npx vitest run      # oczekiwane: wszystkie testy zielone
npm run dev                              # :3000, migracje odpalają się przy starcie

# 3) narzędzia
npm run -s sim:world -- 180 --traders=5  # symulacja świata (`--` po nazwie skryptu jest wymagane)
npm run audit                            # portfele vs dziennik, kod 1 przy różnicy

# 4) klient
cd ../client
flutter create . --platforms=android --org pl.lastsilo --project-name lastsilo   # generuje android/ (raz)
flutter pub get && flutter analyze && flutter test
flutter run --dart-define=API_URL=http://10.0.2.2:3000   # emulator; telefon: IP komputera w LAN
```
Dla `http://` dodaj `android:usesCleartextTraffic="true"` w `AndroidManifest.xml` (tylko dev).

## Stan (listopad 2026)
- **Serwer**: zjazdy, budynki, Warsztat, Laboratorium, Kodeks, Radio, najazdy, ranking, rynek, karawany, zlecenia NPC, sezony 180 dni; subskrypcja „Wygoda” (Google Play Billing, RTDN, `subscription-sync`) i konto Google (Sign-In, wiele urządzeń, usuwanie konta) — tylko serwer.
- **Ekwipunek** (`docs/ekwipunek-v1.0.md`, wszystkie 4 etapy): dwa zestawy (aktywny działa w zjazdach, atakach i obronie; zrzut mocy przy dodaniu zjazdu / wysłaniu najazdu), profil zjazd/atak/obrona i bronie, rzadkość z ziarna + tiery do 10 (Kuźnie), runy (portfel, gniazda, łup III), komplety. Ruda ponad pojemność Magazynu nie jest chroniona przed najazdem. Balans 1.9.0.
- **Klient działa** (sprawdzony na emulatorze): wszystkie ekrany API w nowej warstwie wizualnej, start i onboarding, zestawy, rzadkość, runy, komplety. Nie ma jeszcze ekranów konta Google ani subskrypcji.
- **CI** (`.github/workflows/ci.yml`): serwer (typecheck, vitest na Postgresie, build) i klient (format 160, `analyze --fatal-infos`, testy w losowej kolejności); przypięte `ubuntu-24.04`, Node 22, Flutter 3.47.9.
- Makiety: artefakt Design „Last Silo: warstwa wizualna” (https://claude.ai/artifact/4uLiaBVPYtTnnFZRjrturM). Nowy ekran: najpierw makieta, potem kod.

## Do zrobienia później
Klient konta Google i subskrypcji (+ konfiguracja Play Console/Google Cloud po stronie Damiana), strona WWW do usuwania konta (wymóg Sklepu Play), build wydania (podpisany AAB, testy wewnętrzne), push FCM, boty treningowe jako cele najazdów, partiowanie zamykania sezonu, komplet Sztygara prawie nieużywany w symulacji (Rdzeń go wypiera), dźwięk, wersja angielska (przenieść `strings.dart` do l10n), sprawdzenie znaku „Last Silo”, geotermia (odłożona).

## Konwencje i pułapki
- Commity: krótkie, po polsku, jedna zmiana logiczna. Przed commitem: `npm run typecheck`, testy, a w `client/` `dart format .` (szerokość 160), `flutter analyze --fatal-infos` i `flutter test`. CI (`.github/workflows/ci.yml`) sprawdza to samo przy pushu do `main` i w PR.
- Zmiana balansu: uruchom `sim:world` dla kilku ziaren (`--seed=N`) i sprawdź, że zjazdy zostają głównym źródłem dochodu, a ruda nie zalega w setkach tysięcy.
- Testy czasu używają zegara kontekstu (`ctx.now()`); znaczniki czasu zapisuj z niego, nie z `now()` bazy.
- `insurance_fee` w configu jest sprawdzany w teście karawan; zmieniając wartość, popraw test.
- Błędy API to kody w polu `error` (np. `insufficient_ore`); komunikaty PL dopisuj w `client/lib/strings.dart`.
- Łupy z najazdów są na granicy kryterium balansu (wzrost najwyżej +3 pkt względem 1.5.0 ≈ 10,2% dochodu; teraz 10,5–12,6%): każda zmiana ataku/obrony wymaga `sim:world` na 3 ziarnach.
- `applyLedger` po cichu pomija wpis z powtórzonym `ref` (w obrębie gracza i powodu): ref musi być unikalny na operację (np. `randomUUID`), powtórki żądań łapie `Idempotency-Key`.
- Klient: stany sygnalizuj znakiem i słowem, nie tylko kolorem; cele dotyku ≥ 44 dp; minimalne zamiast sztywnych rozmiarów; etykiety `Semantics` nie-przycisków z `container: true` (inaczej się scalają).
- Windows/dev: Docker Desktop bywa wyłączony (`docker start lastsilo-db`); emulator uruchamiaj z `-gpu swiftshader_indirect -no-snapshot-load`; nie usuwaj worktree z junction do `node_modules` przez `git worktree remove --force` (kasuje zawartość celu).
