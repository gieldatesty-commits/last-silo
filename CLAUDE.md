# Last Silo: instrukcja dla Claude Code

Mobilna gra (Android, Flutter) w świecie **Głębi**: podziemne silosy rozsiane po nienazwanej sferze, wróg to Rdzeniowcy. Inspirowana Blood Wars, ale celowo odmienna (prawa autorskie). Autor: Damian, pracuje solo z AI. **Odpowiadaj po polsku, zwięźle, bez lania wody.** Nazwa „Last Silo” czeka na sprawdzenie znaku towarowego.

Szczegóły: spec `docs/glebia-mvp-spec.md`, systemy i balans `docs/*-v1.0.md` (balans, sezony, rynek, karawany, kontrakty, surowce), API w `README.md`.

## Zasady projektu (nie łamać bez zgody Damiana)
1. **Ekonomia zamknięta**: brak wymiany na prawdziwe pieniądze. Subskrypcja daje wygodę (kolejka, powiadomienia), nie siłę. Zero pay-to-win.
2. **Serwer jest autorytatywny**; klient tylko wyświetla i wysyła intencje. Tanio i skalowalnie (jeden VPS, Postgres).
3. **Cały balans w `config/game.yaml`** (wersjonowany, obecnie 1.4.0). Zmiana balansu = config + symulacja + dopisek w dokumencie. Nie wpisuj liczb gry w kod.
4. **Losowość tylko z ziarna** (mulberry32 w `src/game`), ziarno zapisane przy zdarzeniu. Zero `Math.random()` w logice gry.
5. **Pieniądze/zasoby tylko przez niezmienny dziennik** (`ledger.ts`, `applyLedger`). Po zmianach w ekonomii `npm run audit` musi dawać 0 różnic.
6. **Akcje mutujące wymagają `Idempotency-Key`**; rozliczenia są leniwe i idempotentne w `settle()` (kolejność: najazdy → karawany → zlecenia → rdzeń; blokada wiersza `silos FOR UPDATE`).
7. Nowa tabela/kolumna = nowa migracja SQL w `server/migrations/` (kolejne numery, aktualnie do 013). Nie edytuj starych po wdrożeniu.

## Struktura
- `server/` — Node 22, TypeScript (ESM, NodeNext), Fastify 5, Kysely + pg, PostgreSQL 16, pg-boss 12, zod 4, vitest.
  - `src/game/` czysta logika (formuły, zjazdy, rynek, karawany, kontrakty, upgrade, geologia), bez bazy.
  - `src/services/` transakcje i reguły: silo, items, gear, research, codex, radio, raids, trade, market, caravans, contracts, season.
  - `src/app.ts` trasy HTTP · `config.ts` schematy zod configu · `db.ts` typy Kysely · `scheduler.ts` zadania pg-boss (m.in. `season-tick` co 5 min) · `sim/` symulatory.
  - `test/` ~131 testów (potrzebują Postgresa; `fileParallelism: false`).
- `client/` — Flutter (Android). `lib/api.dart` (HTTP, JWT gościa, klucze idempotencji) → `app_state.dart` (ChangeNotifier) → `screens/*`. Wspólne: `widgets.dart` (`Loader`, `act`, dialogi), `strings.dart` (teksty PL i komunikaty błędów), `format.dart`.
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
- **Serwer gotowy do bety**: zjazdy, budynki, Warsztat (+tiery), Laboratorium, Kodeks, Radio, najazdy, ranking, rynek materiałów, karawany, zlecenia NPC, sezony 180 dni, balans 1.4.0.
- **Klient: ekrany do całego API są napisane, ale NIGDY nie były skompilowane ani uruchomione.** Spodziewaj się błędów kompilacji i drobnych niezgodności z kształtem odpowiedzi serwera (klient pisany na podstawie kodu serwera, bez testu na żywo).

## Pierwsze zadania (w tej kolejności)
1. Postaw bazę i serwer, uruchom `npx vitest run`. Napraw tylko to, co faktycznie pada, i podaj mi wynik.
2. W `client/`: `flutter pub get`, `flutter analyze`, `flutter test`. Napraw wszystkie błędy kompilacji i testów.
3. Uruchom serwer + emulator i przejdź ręcznie: nowy gość → utworzenie postaci → Silos → ulepszenie budynku → zjazd → Warsztat (wytwórz, załóż) → Lab → Więcej (Radio, Najazdy, Ranking, Rynek, Zlecenia, Sezon, Geologia). Przy każdym ekranie porównaj pola, których używa klient, z odpowiedzią `curl` z serwera i popraw rozbieżności (najpewniejsze miejsca: `/silo`, `/radio`, `/raids/targets`, `/market`, `/contracts`, `/season`).
4. Dopiero potem nowe funkcje.

## Do zrobienia później
Push FCM, rozliczanie subskrypcji (wygoda, nie siła), grafika i dźwięk, wersja angielska (przenieść `strings.dart` do l10n), boty treningowe jako cele najazdów, partiowanie zamykania sezonu, sprawdzenie znaku „Last Silo”, CI (GitHub Actions: typecheck + vitest + flutter analyze/test), geotermia (odłożona).

## Konwencje i pułapki
- Commity: krótkie, po polsku, jedna zmiana logiczna. Przed commitem: `npm run typecheck`, testy, a w `client/` `flutter analyze`.
- Zmiana balansu: uruchom `sim:world` dla kilku ziaren (`--seed=N`) i sprawdź, że zjazdy zostają głównym źródłem dochodu, a ruda nie zalega w setkach tysięcy.
- Testy czasu używają zegara kontekstu (`ctx.now()`); znaczniki czasu zapisuj z niego, nie z `now()` bazy.
- `insurance_fee` w configu jest sprawdzany w teście karawan; zmieniając wartość, popraw test.
- Błędy API to kody w polu `error` (np. `insufficient_ore`); komunikaty PL dopisuj w `client/lib/strings.dart`.
