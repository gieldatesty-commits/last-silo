# Karawany (v1.0)

Kupno na rynku to fizyczna dostawa z silosu sprzedającego do silosu kupującego. Dzięki temu rynek jest **regionalny**: bliskie oferty są tańsze w dowozie, dalekie rzadko opłacają się wobec ceny Handlarza NPC. Konfiguracja: `caravans` w `config/game.yaml`.

## Zasady
- **Pieniądze od razu, towar po czasie.** Kupujący płaci cenę oferty i opłatę przewozową; sprzedający dostaje cenę minus 5% prowizji natychmiast. Towar leży „w drodze” do `arrives_at` i trafia do portfela przy najbliższym rozliczeniu silosu (leniwie, jak najazdy).
- **Dystans:** liczony w pasmach 500 km jak w radiu (wszystkie wartości z pasma, żeby czas i opłata nie zdradzały dokładnych położeń).
- **Czas:** `km / 600 km/h`, nie mniej niż 30 min i nie więcej niż 36 h.
- **Opłata przewozowa (ujście rudy):** za sztukę cena NPC × 4% × km/1000, maks. 60% ceny NPC. Przykład: miedź (NPC 140) na 4000 km to 23 rudy za sztukę.
- **Zasadzka Rdzeniowców:** szansa 1% + 1% na każde 1000 km, maks. 12%. Nieubezpieczona przesyłka traci 40% sztuk (zaokrąglone, więc 1 sztuka jest bezpieczna). Wynik losowany z ziarna zapisanego przy wyjeździe, więc deterministyczny i niepodważalny.
- **Ubezpieczenie:** 6% wartości towaru; zasadzka nie zabiera nic. To wygoda: przy 12% szansie oczekiwana strata (4,8%) jest niższa niż składka.
- **Limit:** 6 przesyłek w drodze na kupującego.
- Handlarz NPC (`/exchange/buy`) i sprzedaż botowi podłogi są natychmiastowe: za brak czekania płaci się pełną ceną.

## API
| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/market/listings` | oferty z dystansem, czasem dostawy, opłatą za sztukę, łącznym kosztem, szansą zasadzki; sortowane po łącznym koszcie |
| POST | `/market/listings/:id/buy` | `{qty, insure?}`; odpowiedź zawiera `shipmentId`, `arrivesAt`, opłaty |
| GET | `/market/shipments` | przesyłki w drodze i ostatnie dostarczone (z wynikiem zasadzki) |

Księga: nowe powody `caravan_fee` (opłata i ubezpieczenie) i `caravan_delivery` (przyjęcie towaru); ref `ship:<id>` chroni przed podwójną dostawą. Reset sezonu czyści przesyłki.

## Wyniki symulacji (180 dni, 50 graczy)
- 17,7 tys. szt. przewiezionych, średni dystans 4,3 tys. km (losowa para silosów to ok. 10 tys. km, więc handel jest wyraźnie lokalny).
- Opłaty przewozowe: 9,4 tys. rudy na gracza (2,9% dochodu) – nowe ujście rudy; prowizje 0,5%; zakupy u NPC 4,0% dochodu.
- Zasadzki: 73 przesyłki, utracono 342 szt. (ok. 2% przewiezionego towaru).
- Źródło rudy (sprzedaż botowi podłogi) 4,3% dochodu. Zjazdy, poziomy i sukcesy bez zmian.

## Czy da się żyć z samego handlu?
Diagnostyka w symulacji: `npm run sim:world -- 180 --traders=5` (gracze, którzy po poz. 5 i Radiostacji 5 przestają zjeżdżać i kupują tanie oferty, by sprzedać je drożej). **Na obecnych parametrach handel nie zarabia** (zysk ≈ 0 lub ujemny przy 3–8 handlarzach).
Przyczyny:
1. Popyt jest mały: cały świat kupuje na rynku ok. 100 szt. materiałów na dobę (materiały to tylko dodatek do wytwarzania, wzmocnień i kilku badań).
2. Rozrzut cen jest niewielki: oferty graczy to 55–90% ceny NPC, a po doliczeniu przewozu dostarczony koszt jest bliski 90% ceny NPC, więc marża po prowizji 5% jest rzędu kilku procent.
3. Dalekie transakcje się nie kleją, bo cena u kupującego (oferta + przewóz) przekracza cenę NPC.
Wniosek: karawany dają rynkowi geografię i ujście rudy, ale nie samodzielną ścieżkę zarobku. Żeby handel „zamiast wydobycia” był realną opcją, trzeba dodać popyt niezależny od zjazdów, np.:
- **Zlecenia karawanowe (NPC):** zamówienia „dostarcz N sztuk X do silosu/regionu Y” z nagrodą powyżej ceny NPC, limitowane dziennie (kontrolowane źródło rudy dla handlarzy).
- Droższe wzmocnienia i receptury zużywające więcej materiałów (większy popyt wszystkich).
Decyzję warto podjąć po becie z prawdziwymi graczami, gdy zobaczymy realny rozrzut cen.

## Do zrobienia później
- Powiadomienie push o dotarciu karawany; ekran „w drodze” w kliencie.
- Najazd na karawanę (PvP) i eskorta (Wartownia/badania) jako opcjonalne ryzyko.
- Przesyłki do znanych kontaktów (dar, wymiana bez rynku).
