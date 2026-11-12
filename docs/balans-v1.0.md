# Balans v1.0 – długa rozgrywka (sezon ~180 dni)

Cel: świat ma dawać cele i sensowne wybory przez cały sezon (ok. 6 miesięcy), bez wczesnego „końca gry”, bez eksplozji dochodu i bez zalegającej rudy. Pomiar: `npm run sim:world -- 180` (50 graczy: 30% hardcore, 50% regularni, 20% okazjonalni, boty działają bez przerw, więc są szybsze od ludzi).

## Co wykazała symulacja v0.9 (przed zmianami)
- Poziom 30 osiągnięty ok. dnia 120; potem brak celu.
- Wszystkie budynki na poz. 8 ok. dnia 60; ruda zalega (45 tys. na gracza, 22% dochodu), a przy pełnym magazynie produkcja z szybu staje.
- Pula strefy rdzenia wyczerpana w 88% → dochód z zjazdów spada po dniu 120.
- Najazdy w późnej grze: 2,5/gracza/dobę, łupy 120% dochodu (boty z poz. 30 nie mają nic innego do roboty).

## Zmiany (config 1.0.0)
| Obszar | Zmiana | Efekt |
|---|---|---|
| Tempo poziomów | `xp_exp` 2,0 → 2,2 | poz. 30 bot osiąga ok. dnia 170–180 (okazjonalni ok. 26 po 180 dniach) |
| Budynki | `max_level` 10 dla Warsztatu, Wartowni, Laboratorium, Radiostacji; produkcyjne (szyb, generator, magazyn) zostają na 8 (`max_level_by_building`) | nowy cel + brak eksplozji dochodu (próba z poz. 12 dla wszystkich dała 260 tys. z szybu i zanik najazdów – odrzucona) |
| Pule stref | regeneracja `regen_per_day`: górne 0,5%, głębokie 0,5%, rdzeń 0,3% puli dziennie (leniwie, `world_pools.regen_at`) | rdzeń stabilizuje się na ok. 34% po 180 dniach zamiast 12%; dochód z zjazdów nie spada |
| Wzmacnianie przedmiotów | tier 1–5: ruda ×0,6·1,7^(t−1) ceny receptury, 15·t żetonów, materiały (6/5/4)·t; wymaga Warsztatu 5+t i Radiostacji 5; +10% bonusu i +15% kosztu napraw za tier | stały cel dla rudy i materiałów (19% dochodu), materiały zyskują sens po Radiostacji 5 |
| Najazdy | `loot_cap_ore` 4000 → 3000 (+ Wartownia do 10) | 0,5 najazdu/gracza/dobę, łupy 7% dochodu |

## Wyniki (180 dni, 50 graczy, ziarno 1)
| Dzień | Śr. poziom | Pula rdzenia |
|---|---|---|
| 30 | 15,0 | 100% |
| 60 | 19,2 | 86% |
| 90 | 22,6 | 70% |
| 120 | 25,1 | 54% |
| 150 | 27,7 | 42% |
| 180 | 29,1 | 34% |

- Dochód łączny na gracza 322 tys.: zjazdy 66%, szyb 34%.
- Wydatki: budynki 21%, badania 8%, wytwarzanie 6%, naprawy 26%, wzmocnienia 19%; w magazynie zostaje 23 tys. (7%).
- Sukcesy zjazdów 70% (bez sprzętu 51%), najazdy 7% dochodu.
- Ziarno 2, 150 graczy, 30% abonentów: te same wyniki ±3% (abonament daje wygodę, nie moc; ok. +2% dochodu).
- 365 dni: poziom 30 dla wszystkich, ruda zalega tylko 18 tys.; w drugim półroczu gra wchodzi w „end-game” (najazdy rosną do 34% dochodu), co jest argumentem za resetem sezonowym.

## Otwarte sprawy
- Boty są szybsze od ludzi; po testach z prawdziwymi graczami skalować `xp_exp` i koszty.
- Rynek (M4) dołoży ujścia (opłaty 5–10%), a handel materiałami zmieni ich popyt.
- Najazdy w drugim półroczu rosną; do rozważenia ranking sezonowy zamiast stałego zachęcania do łupów.

## Magazyn: nadwyżka bez ochrony (config 1.6.1)
Pojemność Magazynu zatrzymuje tylko wydobycie szybu; zjazdy, łupy i zlecenia mogą ją przekroczyć (w symulacji średnio ok. 24 tys. rudy przy pojemności ok. 17 tys. na Magazynie 8). Od 1.6.1 Magazyn chroni przed najazdem tylko część rudy mieszczącą się w pojemności: `chronione = floor(protected × min(ruda, pojemność))` (`protectedOre` w `src/game/formulas.ts`), cała nadwyżka jest do wzięcia (dalej `loot_fraction` i `loot_cap_ore`). Poniżej pojemności nic się nie zmienia. Klient pokazuje rudę ponad pojemność jako „pojemność + nadwyżka” z opisem „nadwyżka bez ochrony”.

`sim:world -- 180 --traders=5`, łupy z najazdów w dochodzie (1.6.0 → 1.6.1): ziarno 1: 9,7% → 13,5%; ziarno 2: 10,1% → 12,0%; ziarno 3: 10,1% → 12,9%. Mediana utraconego dochodu ok. 10% → 12,3–12,7%; ruda w magazynie bez zmian (ok. 24–25 tys.). Względem 1.5.0 (ok. 10,2%) to +1,8 do +3,3 pkt, czyli na granicy kryterium „+3 pkt” z `docs/ekwipunek-v1.0.md` §8 (ziarno 1 lekko ponad). Decyzja o ewentualnej korekcie (`loot_fraction`, `loot_cap_ore`) u Damiana.
