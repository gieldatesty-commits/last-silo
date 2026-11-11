# Last Silo: kontekst dla Claude Code

Mobilna gra (Android, Flutter) w świecie Głębi, inspirowana Blood Wars, ale celowo odmienna (prawa autorskie). Autor: Damian, pracuje solo z AI. Odpowiadaj po polsku, zwięźle.
Spec: `docs/glebia-mvp-spec.md`. Balans i systemy: `docs/*-v1.0.md`. Nazwa „Last Silo” czeka na sprawdzenie znaku towarowego.

## Zasady projektu (nie łamać)
- Ekonomia zamknięta: brak wymiany na prawdziwe pieniądze. Subskrypcja daje wygodę, nie siłę (nie pay-to-win).
- Backend najtańszy i skalowalny; serwer jest autorytatywny, klient tylko wyświetla.
- Wszystkie liczby balansu w `config/game.yaml` (wersjonowany). Zmiana balansu = konfiguracja + symulacja (`npm run sim:world`) + dokument.
- Cała losowość z ziarna (mulberry32), zapisywana przy zdarzeniu. Zmiany portfela tylko przez niezmienny dziennik (`applyLedger`, `npm run audit` musi dawać 0 różnic).
- Akcje mutujące: nagłówek `Idempotency-Key`. Rozliczenia leniwe i idempotentne w `settle()` (kolejność: najazdy, karawany, zlecenia, rdzeń).

## Struktura
- `server/`: Node 22, TypeScript (ESM), Fastify 5, Kysely + pg, PostgreSQL 16, pg-boss, zod, vitest. `src/game` = czysta logika, `src/services` = transakcje, `src/app.ts` = trasy, `migrations/` = SQL.
- `client/`: Flutter (Android). `lib/api.dart` → `app_state.dart` → `screens/*`; wspólne `widgets.dart`, teksty i błędy w `strings.dart`.
- `config/game.yaml`, `docs/`, `tools/`, `docker-compose.yml`, `Caddyfile`.

## Komendy
```bash
# serwer (potrzebny Postgres 16; docker-compose.yml)
cd server && npm ci
export DATABASE_URL=postgres://lastsilo:lastsilo@localhost:5432/lastsilo JWT_SECRET=dev-secret-1234567890
export TEST_DATABASE_URL=postgres://lastsilo:lastsilo@localhost:5432/lastsilo_test
npm run dev | npm run typecheck | npx vitest run   # oczekiwane: 131 testów zielonych
npm run -s sim:world -- 180 --traders=5            # symulacja świata; po npm run-ie wymagane `--`
# klient
cd client && flutter create . --platforms=android --org pl.lastsilo --project-name lastsilo
flutter pub get && flutter analyze && flutter test
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```

## Stan (listopad 2026)
- Serwer: gotowy do bety. Zjazdy, budynki, Warsztat, Laboratorium, Kodeks, Radio, najazdy, ranking, rynek materiałów, karawany, zlecenia NPC, sezony (180 dni), balans 1.4.0.
- Klient: ekrany do całego API napisane, **nigdy niekompilowane ani nieuruchamiane**. Pierwszy krok: `flutter analyze`, `flutter test`, naprawa błędów, test na emulatorze.
- Do zrobienia: poprawki po pierwszym uruchomieniu klienta, push FCM, rozliczanie subskrypcji, grafika i dźwięk, wersja angielska (strings.dart → l10n), trening-boty jako cele najazdów, partiowanie zamykania sezonu, sprawdzenie znaku „Last Silo”, CI.
- Znane pułapki: lokalny Postgres bywa zatrzymany (`pg_ctlcluster 16 main start`); testy działają z `fileParallelism: false`; zmiana `insurance_fee` wymaga poprawienia testu karawan.
