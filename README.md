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
| GET | `/items` | ekwipunek, receptury (zablokowane poziomem Warsztatu), zakres jakości |
| POST | `/items/craft` | wytworzenie `{recipeId}`; ruda + żetony; `Idempotency-Key` |
| POST | `/items/:id/equip` · `/unequip` · `/repair` | założenie (1 na slot), zdjęcie, naprawa za rudę; `Idempotency-Key` |
| GET | `/radio` | stan Radiostacji + słyszane sygnały (kierunek, dystans zaokrąglony; nick dopiero po kontakcie) |
| POST | `/radio/contact` | namierzenie `{signalId}` (para); `Idempotency-Key` |
| POST | `/radio/broadcast` | `{on}` – cisza radiowa / nadawanie (od Nadajnika) |
| GET | `/raids/targets` · `/raids` | cele (słyszalni, znani, w lidze) · historia i aktywne |
| POST | `/raids` | start najazdu `{targetId}`; rozstrzygany leniwie po dojeździe; `Idempotency-Key` |
| GET | `/ranking?type=power\|loot` | ranking nadających (Nadajnik) |
| GET | `/geology` | jakościowy opis geologii okolicy: który materiał obfituje (bez liczb) |
| POST | `/items/:id/upgrade` | wzmocnienie przedmiotu o tier (tier 1–5; Warsztat 5+t, Radiostacja 5; koszt: ruda, żetony, materiały); `Idempotency-Key` |
| GET | `/season` | sezon: numer, faza (aktywny/przerwa), dzień, dni do końca, bonus do odebrania, tytuły |
| GET | `/season/results` | wyniki ostatniego sezonu: top 10 i własne miejsce |
| POST | `/exchange/buy` | zakup materiału u NPC za rudę `{material, qty}`; od Radiostacji 5; `Idempotency-Key` |
| GET | `/codex` | Kodeks Rdzeniowców: wpisy odkrywane badaniami (zablokowane bez treści, tylko podpowiedź) |
| GET | `/research` | drzewo badań Laboratorium: stan, wymogi, koszt, czas (skracany poziomem Laboratorium) |
| POST | `/research/:id/start` | start badania (jedno naraz); `Idempotency-Key` |
| POST | `/players/stats` | rozdanie wolnych punktów statystyk |

Narzędzia: `npm run sim [dni] [--deposit=N] [--check=godz]` (jeden gracz: złoże i ulepszenia), `npm run sim:world [dni] [--players=N]` (świat ze wspólnymi pulami i stylami gry), `npm run audit` (portfele vs dziennik, kod 1 przy różnicy).

## Status
- [x] Sezony 180 dni (docs/sezony-v1.0.md): licznik, blokada po końcu, ranking mocy, tytuły i bonus startowy, reset świata z archiwum księgi
- [x] Balans v1.0 (docs/balans-v1.0.md): wolniejsze poziomy, budynki do 10, regeneracja pul, wzmacnianie przedmiotów, łagodniejsze najazdy; sezon ok. 180 dni
- [x] Materiały i geologia: miedź/kryształy/siarka, profil regionu z położenia na kuli, wymagane dopiero od Radiostacji 5; wymiana z NPC; spec w docs/swiat-v0.3-surowce.md (energia geotermalna zaplanowana)
- [x] M3 (serwer): Radiostacja (Odbiornik/Nadajnik/Szyfr/Przekaźniki), kontakt, najazdy async z łupem i ochroną, ranking; symulacja najazdów (`--noraids=1` wyłącza)
- [x] Balans 0.7.0: 6 tras wysokich poziomów (strefa rdzenia, od poziomu 9 do 25, mnożnik nagrody), tańsze naprawy, mniej próbek; wyniki w docs/balans-v0.7.md
- [x] Rdzeniowcy: zasób Próbki rdzeniowe (z głębokich zjazdów), gałąź badań (obserwacja, anatomia, język wibracji I–III, wiertła, izolacja), 10 wpisów kodeksu; poprawka księgi (debet na pustym portfelu)
- [x] Dział nauki: Laboratorium (budynek), 13 badań w gałęziach górnictwo / inżynieria / rdzeniowcy (bonusy do zjazdów, tańsze naprawy i ulepszenia, jakość, odblokowanie receptur); 13 receptur w 4 slotach
- [x] M2b (serwer): Warsztat, 6 receptur, jakość zależna od poziomu Warsztatu, trwałość (−1 na zjazd), naprawy, bonus do mocy zjazdu; klient nie ruszany
- [x] M0: szkielet, logowanie gościa, Docker/CI (obraz i klient niesprawdzone, brak Dockera i Fluttera w środowisku autora)
- [x] M1 (serwer): ledger, postać, statystyki, silos, 5 budynków, ulepszenia z timerami (pg-boss), ukryte złoże lokalne, idempotencja, audyt, symulator. 33 testy.
- [ ] M1 (reszta): push FCM, ekran silosu w kliencie
- [x] M2a (serwer): 3 trasy zjazdów, XP i poziomy, punkty statystyk, zadyszka po porażce, wspólne ukryte pule stref. 51 testów.
- [ ] M2b: przedmioty, rzemiosło i naprawy (Warsztat), ekran zjazdów w kliencie
