# Bilans ekonomii – config 0.7.0 (symulacja 50 graczy, `npm run sim:world`)

| Dzień | Śr. poziom | Udział zjazdów w dochodzie | Szansa zjazdu | Pula rdzenia |
|---|---|---|---|---|
| 14 | 13,3 | 50% | 77% | 97% |
| 56 | 24,3 | 69% | 79% | 61% |
| 90 | 28,8 | 76% | 83% | 35% |

- Sprzęt i badania podnoszą szansę zjazdu z 66% do 79% (dzień 56) i kosztują ok. 55–60% dochodu (badania, wytwarzanie, naprawy).
- Hardcore ≈ 2,5–3× więcej rudy ze zjazdów niż okazjonalni; okazjonalni dopełniają dochód szybem (udział zjazdów 46–56%).
- Abonament (3 sloty): +8% zjazdów, +2 poziomy do dnia 56.
- Próbki: zapas ≈ 12 (dzień 56), 15 z 18 badań do dnia 90, kodeks 6,5 z 10 – próbki są wąskim gardłem gałęzi Rdzeniowców (celowo).
- OTWARTE: po ~dniu 40 gracze mają wszystko kupione, a ruda leży w magazynie (ok. 34k w dniu 56, 55k w dniu 90). Potrzebne kolejne ujścia (rynek, najazdy, karawany, przebudowy), inaczej udział zjazdów i inflacja rosną.

## M3 – Radiostacja i najazdy (config 0.8.0)

Boty: punkty 60% Technika / 20% Siła / 20% Wytrwałość (realistyczniejsze niż same Techniki; szansa zjazdu spada do ok. 60%).

| Wariant najazdów | Najazdy/gracz/dobę | Łup w dochodzie | Strata mediany | Strata największa |
|---|---|---|---|---|
| łup 8%, ochrona 90 min, 8/dobę, limit 8000 | 0,89 | 16,5% | 11% | 42% |
| **łup 5%, ochrona 6 h, 5/dobę, limit 4000 (przyjęte)** | 0,49 | 6,5% | 5% | 16% |
| łup 4%, ochrona 8 h, 4/dobę | 0,41 | 4,2% | 3,5% | 10% |

- Wygrane atakujących ≈ 51% (liga ±40%, szansa ≥ 50% wymagana przez bota). Najazdy przenoszą rudę, nie tworzą jej (audyt księgi zgodny).
- Okazjonalni rzadko napadają (2 w 56 dni), ale bywają celem; ochrona Magazynu (do 60%) i Wartownia ograniczają straty.
- OTWARTE: boty-cele szkoleniowe dla pierwszego najazdu; kosztów Radiostacji nie przesymulowano osobno (bot rozbudowuje ją jak inne budynki).
