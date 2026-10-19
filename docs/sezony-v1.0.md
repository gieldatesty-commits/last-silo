# Sezony (v1.0)

Decyzja 19.10: **sezon trwa 180 dni.** Po nim podsumowanie, przerwa i reset świata. Konto i tytuły zostają.

## Cykl
1. **Aktywny (180 dni)** – pełna gra. `GET /season`: numer, dzień, dni do końca, tytuły z poprzednich sezonów.
2. **Przerwa (48 h)** – akcje zmieniające stan zwracają `409 season_ended`; można oglądać wyniki (`GET /season/results`: top 10 i własne miejsce). W tym czasie obliczono ranking i przyznano bonusy.
3. **Start następnego** – reset świata, nowy sezon. Gracz zakłada postać od nowa (nick znów wolny, nowy archetyp i losowe położenie silosu → nowe regiony geologii i inni sąsiedzi).

Kroki wykonuje `seasonTick` (idempotentny, blokada advisory): co 5 min z pg-boss oraz leniwie przy pierwszym POST po terminie.

## Ranking i nagrody
Miejsce według mocy (statystyki + budynki), przy remisie łupy z najazdów, potem nick. Pierwsza pasująca nagroda:

| Tytuł | Warunek | Bonus startowy (ruda) |
|---|---|---|
| Mistrz Głębi | miejsce 1 | 400 |
| Starszy sztygar | top 10%, poz. ≥ 10 | 300 |
| Sztygar | top 33%, poz. ≥ 10 | 200 |
| Weteran sezonu | poz. ≥ 5 | 100 |

Bonus to **wygoda na starcie** (start ma 300 rudy), twardy limit `season.max_bonus_ore` = 500; nie daje przewagi w walce. Tytuł to wyłącznie prestiż (pokazywany w profilu).

## Reset
Księga (`ledger_entries`) trafia do `ledger_archive` z numerem sezonu; czyszczone są: portfele, silosy, budynki, zjazdy, zadania, przedmioty, badania, kontakty, najazdy, pule, klucze idempotencji i powiadomienia. Zostają: konta, `season_results`, bonus do odebrania (`players.carry_bonus_ore`, wypłata przy założeniu postaci jako `starting_grant/season_bonus`), subskrypcja, `events_log`.

## Uwagi
- Zamknięcie rozlicza wszystkich graczy i robi migawkę rankingu; przy dużej liczbie graczy trzeba zrobić to partiami (obecnie jedna transakcja).
- Ranking zamykany jest w chwili wykonania ticka (do 5 min po terminie), nie dokładnie o `ends_at`.
- Czas trwania, przerwa i nagrody w `config/game.yaml` (`season`). Balans pod 180 dni: `docs/balans-v1.0.md`.
- Do ustalenia później: czy ranking sezonowy ma osobną tablicę „na żywo” dla wszystkich (teraz ranking widzą nadający), oraz nagrody kosmetyczne w sklepie.
