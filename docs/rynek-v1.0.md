# Rynek graczy (M4, v1.0)

Handel materiałami (miedź, kryształy, siarka) za rudę. Włączony od **Radiostacji 5** i **poziomu gracza 5** (anty-multikonta); `config/game.yaml` → `market`.

## Zasady
- **Wystawienie „kup teraz”:** materiał, ilość (≤ 200), cena za sztukę w rudzie. Towar schodzi z portfela od razu (depozyt), wraca po anulowaniu lub wygaśnięciu (48 h). Do 8 aktywnych wystawień.
- **Korytarz cen:** od oferty bota podłogi (30% ceny NPC) do ceny Handlarza Przekaźnikowego (NPC). Kupowanie drożej niż u NPC nie ma sensu, a poniżej oferty bota sprzedający wolałby sprzedać botowi.
- **Kupno:** całości lub części oferty; towar jedzie karawaną do silosu kupującego. Sprzedający dostaje cenę minus **5% prowizji**; prowizja znika z gry (ujście rudy).
- **Bot podłogi cen:** kupuje materiały po stałej cenie (30% ceny NPC), max 10 szt. na dobę na gracza. Zapewnia wyjście także przy małej liczbie graczy i dolną granicę cen.
- **Handlarz NPC:** nadal sprzedaje materiały po stałej cenie (sufit cen), wiec brak ofert nie blokuje gry.
- Kupno to fizyczna dostawa **karawaną** (czas, opłata i ryzyko zależą od dystansu, patrz `karawany-v1.0.md`). Handlarz NPC dostarcza natychmiast po pełnej cenie.

## API
| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/market` | ceny NPC i bota, korytarze, średnia z 7 dni, wolumen, najlepsza oferta, pozostały dzienny limit bota |
| GET | `/market/listings?material=` | aktywne oferty, od najtańszej (max 50) |
| GET | `/market/mine` | moje oferty i ostatnie transakcje |
| POST | `/market/listings` | `{material, qty, unitPrice}`, `Idempotency-Key` |
| POST | `/market/listings/:id/buy` | `{qty}`, `Idempotency-Key` |
| DELETE | `/market/listings/:id` | anulowanie, zwrot towaru |
| POST | `/market/sell-npc` | `{material, qty}` sprzedaż botowi podłogi, `Idempotency-Key` |

## Bezpieczeństwo ekonomii
- Każda zmiana salda idzie przez księgę (nowe powody: `market_listing`, `market_return`; istniejące `market_sale`, `market_purchase`, `market_fee`). Materiał nie powstaje i nie znika przy transakcji między graczami (test sprawdza sumę).
- Wygasłe oferty są zwracane leniwie (przy dowolnym odczycie rynku), bez zadań w tle.
- Zakup blokuje wiersz oferty (`FOR UPDATE`); portfele aktualizowane w stałej kolejności po id użytkownika, więc wzajemne zakupy nie zakleszczają się (testy współbieżności).
- Reset sezonu czyści oferty i historię.

## Wyniki symulacji (180 dni, 50 graczy; boty sprzedają nadwyżki po 55–90% ceny NPC)
| | bez rynku | z rynkiem |
|---|---|---|
| zakupy u NPC | 38,3 tys. rudy/gracza (11,9% dochodu) | 8,1 tys. (2,6%) |
| zakupy od graczy | – | 24,1 tys. po śr. 90 rudy za szt. (ok. 60% ceny NPC) |
| prowizje (ujście) | – | 1,2 tys. (0,4%) |
| sprzedaż botowi (źródło rudy) | – | 16,7 tys. (5,4% dochodu) |
| zapas materiałów po 180 dniach | 414 / 599 / 492 | 70 / 107 / 96 |
| zalegająca ruda | 23 tys. | 30 tys. |

Wniosek: rynek zastępuje większość zakupów u NPC tańszymi ofertami graczy (regiony z nadwyżką zaopatrują te z niedoborem), a bot podłogi zamienia nadwyżki materiałów w ok. 5% dochodu. Zjazdy, tempo poziomów i sukcesy bez zmian. Spora część nadwyżek to skutek nadprodukcji botów (`mat_per_hour`), więc po becie warto ją ponownie skalibrować.

## Granice i dalsze kroki
- Materiały to jedyny towar. Przedmioty (z jakością i wzmocnieniem) to naturalne rozszerzenie, ale wymagają przemyślenia balansu (moc za rudę).
- „Handel bez kopania” działa jako arbitraż między ofertami graczy a ceną NPC (do 35% marży na sztuce przed prowizją), ale podaż pochodzi z cudzych zjazdów; bez karawan i regionalnych cen marża jest niewielka.
- Do zrobienia: historia cen jako wykres w kliencie, powiadomienia o sprzedaży, limity aktywności botów (wykrywanie wash tradingu między kontami).
