# Last Silo

Mobilna gra w świecie Głębi (podziemna kolonia). Spec: `docs/glebia-mvp-spec.md`.

## Uruchomienie lokalnie (serwer)
```bash
cd server && npm ci
export DATABASE_URL=postgres://lastsilo:lastsilo@localhost:5432/lastsilo
export JWT_SECRET=dev-secret-1234567890
npm run dev          # migracje odpalają się przy starcie
npm test             # wymaga bazy lastsilo_test (TEST_DATABASE_URL)
```

## Wdrożenie na VPS
```bash
cp .env.example .env   # uzupełnij hasła i DOMAIN
docker compose up -d --build
```

## API (stan po M1)
| Metoda | Ścieżka | Opis |
|---|---|---|
| POST | `/auth/guest` | konto gościa (lub ponowne logowanie z `userId` + `guestSecret`) |
| GET | `/me` | podstawowy profil |
| POST | `/players` | tworzy postać: `{nickname, archetype}`, losuje pozycję silosu i ukryte złoże |
| GET | `/silo` | stan silosu; rozlicza produkcję, parę i ukończone ulepszenia |
| POST | `/buildings/:type/upgrade` | ulepszenie budynku; wymaga nagłówka `Idempotency-Key` |
| GET | `/dives/routes` | trasy zjazdów: koszt, czas, Twoja szansa, zakres nagród, bogactwo strefy (opis, bez liczb) |
| POST | `/dives` | start zjazdu `{routeId}`; wymaga `Idempotency-Key` |
| GET | `/dives/history` | ostatnie rozstrzygnięte zjazdy |
| POST | `/players/stats` | rozdanie wolnych punktów statystyk |

Narzędzia: `npm run sim [dni] [--deposit=N] [--check=godz]` (jeden gracz: złoże i ulepszenia), `npm run sim:world [dni] [--players=N]` (świat ze wspólnymi pulami i stylami gry), `npm run audit` (portfele vs dziennik, kod 1 przy różnicy).

## Status
- [x] M0: szkielet, logowanie gościa, Docker/CI (obraz i klient niesprawdzone, brak Dockera i Fluttera w środowisku autora)
- [x] M1 (serwer): ledger, postać, statystyki, silos, 5 budynków, ulepszenia z timerami (pg-boss), ukryte złoże lokalne, idempotencja, audyt, symulator. 33 testy.
- [ ] M1 (reszta): push FCM, ekran silosu w kliencie
- [x] M2a (serwer): 3 trasy zjazdów, XP i poziomy, punkty statystyk, zadyszka po porażce, wspólne ukryte pule stref. 51 testów.
- [ ] M2b: przedmioty, rzemiosło i naprawy (Warsztat), ekran zjazdów w kliencie
