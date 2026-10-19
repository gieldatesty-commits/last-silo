# Zlecenia karawanowe (NPC) v1.0

Wspólna dzienna tablica ofert „dostarcz N sztuk materiału do faktorii w kierunku Y”. Dopełnia rynek graczy i karawany: daje handlarzowi stały popyt, ale jest celowo mała.

## Zasady
- Wymagania: Radiostacja L5 i poziom gracza 5 (jak rynek).
- Tablica jest wspólna dla świata i deterministyczna (ziarno z configu + doba UTC + slot), więc nie trzeba jej zapisywać. W bazie lądują tylko przyjęte zlecenia, a `UNIQUE (day, slot)` gwarantuje, że ofertę bierze jeden gracz (drugi dostaje 409 `offer_taken`).
- Liczba ofert na dobę: `max(min_offers, ceil(gracze × offers_per_player))` = 3 przy małym świecie, ok. 1 na 20 graczy powyżej.
- Przyjęcie od razu zabiera ładunek z magazynu (`contract_cargo`) i wysyła karawanę. Czas, zasadzka i ubezpieczenie (6%) działają jak w karawanach.
- Nagroda `qty × unit_reward` jest wypłacana po dotarciu (`contract_reward`), proporcjonalnie do dostarczonych sztuk. Ubezpieczenie chroni przed stratą.
- `unit_reward = cena NPC × (1,05 + 0,06 × km/1000)`, dystans 1500–8000 km, ilość 6–15 szt., max 2 aktywne zlecenia na gracza. Oferta wygasa po końcu doby.

## API
- `GET /contracts`: dzisiejsze oferty (`status`: open / mine / taken), aktywne i ostatnie zlecenia.
- `POST /contracts/:day/:slot/accept` z `{insure?: boolean}` i nagłówkiem Idempotency-Key.

## Kalibracja (symulacja 180 dni, 50 graczy)
| wariant | nagrody z zleceń | uwagi |
|---|---|---|
| 3 oferty na gracza dziennie (pierwsza wersja) | 53–65% dochodu | faucet, ruda zalegała 70–95k |
| wspólna tablica, 0,17 oferty/gracza | 20–23% | nadal za dużo |
| **0,05 oferty/gracza (obowiązuje)** | **6,7–7,3%** | zjazdy nadal główne źródło |

## Uczciwie o handlu
Handel bez kopania nadal się nie opłaca (handlarze w symulacji: −30…+80 rudy/dobę wobec ok. 1900 u regularnych graczy). Zlecenia to nisza i dodatek do zjazdów, nie osobna kariera. Boty w symulacji są prostsze od ludzi, więc dostrojenie trzeba potwierdzić na danych z prawdziwej bety. Wskazane dźwignie: `offers_per_player`, `reward_base`, `reward_per_1000km`, `qty`.
