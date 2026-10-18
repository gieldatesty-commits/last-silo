# Szyb 7 – korekta świata v0.2 („Silosy i Rdzeniowcy")

> Zastępuje wątek „kolonia pod martwą powierzchnią + Wielka Maszyna/Kolosy" z `bloodwars-research-mobile-brief.md` (sekcja 7d). Reszta 7d (profesje, zasoby, archetypy, ekonomia zamknięta) zostaje.
> Zmiana wg pomysłu autora z 18.10.2026: (1) każdy gracz ma własny silos, (2) silosy są losowo rozrzucone po całej planecie, (3) wrogiem jest nieznany, inteligentny, ale prymitywny gatunek żyjący od zawsze w okolicach jądra Ziemi.
> Nazwy robocze. Rzeczy oznaczone **[propozycja]** to moje domyślne założenia do zatwierdzenia lub zmiany.

## 1. Idea w jednym zdaniu
Jesteś operatorem własnego, odizolowanego silosu wierconego w głąb planety. Im głębiej zjeżdżasz, tym bliżej terytorium istot, które były tam przed ludźmi – i tym więcej zasobów, ale też ryzyka.

## 2. Co się zmienia względem wersji 0.1
| Element | Było (0.1) | Jest (0.2) |
|---|---|---|
| Baza gracza | sztolnia na wspólnej mapie-grafie | **silos** (własny, pionowy, wierci się w głąb) |
| Mapa | poziomy kolonii + węzły do zajmowania | **planeta**: silosy w losowych miejscach, dystans zamiast stref |
| Postęp w głąb | wspólne poziomy (Przedproże…Otchłań) | **głębokość silosu** (rośnie z poziomem Szybu głównego) |
| Wróg PvE | Wielka Maszyna, Kolosy | **plemiona Rdzeniowców** i ich Starsi (bossowie) |
| Oś sezonu | budzenie się Maszyny | **wyścig do Jądra** (patrz 5) |
| Walka o teren | cechy zajmują węzły | brak terenu do „betonowania"; cechy jako sieć silosów (po MVP) |

Zaleta ukryta w zmianie: losowe rozmieszczenie rozwiązuje skargę z BW, że najlepsze klany „zabetonowały" strefy – nie ma stref do przejęcia.

## 3. Świat **[propozycja]**
- **Silos:** głęboki szyb wiertniczy z modułami na powierzchni i pod nią. Kto go zbudował i po co (konsorcja, państwa, ocaleni) zostaje celowo niedopowiedziane – to materiał na wątki sezonów. Gracz jest operatorem jednego silosu.
- **Planeta:** fikcyjna siatka na kuli (Ziemia-podobna). Gra **nie używa** prawdziwej lokalizacji GPS gracza ani prawdziwych nazw miejsc – pozycja silosu jest wylosowana przez serwer.
- **Ton:** poważny sci-fi/industrialny z elementem tajemnicy i pierwszego kontaktu (jak w 0.1, z lekkim dreszczem zamiast postapokalipsy).

## 4. Rdzeniowcy (nazwa robocza) **[propozycja]**
- Inteligentni, ale prymitywni technologicznie: plemiona, rytuały, totemy, narzędzia z tego, co daje głębia. Brak metalurgii i maszyn – ich siłą jest liczebność, znajomość terenu i odporność na żar.
- Komunikują się **drganiami skały**. Wiercenie jest dla nich hałasem i naruszeniem domu – to naturalny powód konfliktu, a później pole do dyplomacji.
- Plemiona różnią się cechami (np. zwiadowcze, kamieniarskie, ogniowe), co daje 3 typy wrogów w MVP bez grafik maszyn.
- **Tajemnica jako haczyk retencji:** gracze stopniowo odkrywają **kodeks** (wpisy odblokowywane przez zjazdy): kim są, czego bronią, co znajduje się w Jądrze. Na starcie gracz „nie wie", z kim walczy.
- Bossowie = **Starsi** plemion (zastępują Kolosy w backlogu).
- Moralna szarość (opcjonalnie, po MVP): wymiana z plemionami (handel „żarem" i kryształami rdzeniowymi) zamiast samej walki.

## 5. Głębokość i cel sezonu **[propozycja]**
- Strefy głębokości (nazwy robocze): **Skorupa → Płaszcz górny → Płaszcz dolny → Rdzeń zewnętrzny → Jądro (finał sezonu)**.
- Każdy silos ma własną głębokość; głębsze zjazdy dają lepsze łupy i trudniejszych wrogów.
- **Wyścig do Jądra:** łączny postęp wszystkich silosów otwiera etapy sezonu (zdarzenia globalne, reakcja plemion). Po osiągnięciu progu sezon się domyka, a nagrody zależą od wkładu. To zastępuje „zejście na Kolosa" jako wspólny cel.

## 6. Rozmieszczenie silosów i uczciwość
- Pozycja losowana przy tworzeniu postaci: próbkowanie z minimalnym dystansem między silosami (Poisson-disk), z przewagą wolnych obszarów.
- Dystans wpływa na **czas dojazdu najazdu** i na kolejność listy celów (najbliżsi z tej samej ligi pierwsi). Ligi nadal liczone mocą, nie odległością.
- Zabezpieczenia dla nowych graczy: okno ochronne, brak najazdów od silnie wyższych ligi, boty-cele szkoleniowe (jak w specu).
- Przy małej bazie graczy (beta 30–50) planeta będzie rzadko zaludniona: w MVP dystans ma być **lekki** (czas dojazdu 2–20 min), żeby nie zabić PvP.

## 7. Wpływ na spec MVP (do wdrożenia w M1–M3)
1. `players`: dodać `silo_lat`, `silo_lon` (losowane po stronie serwera, zapisane na stałe w sezonie) oraz `depth`.
2. Zjazdy: 3 trasy = 3 strefy startowe; wrogowie to plemiona (3 typy), nazwy tras i raportów zmienione z maszyn na Rdzeniowców.
3. Najazdy: czas dojazdu `t = clamp(dystans_km / v, 2, 20)` min; lista celów sortowana dystansem w obrębie ligi.
4. Ekran „Mapa": w MVP lista najbliższych silosów z kierunkiem i dystansem; globus 3D/2D jako późniejsza ozdoba.
5. Słownik: sztolnia → **silos**, Kolosy → **Starsi**, Wielka Maszyna → **Rdzeniowcy / Jądro**. Grupowa zmiana nazw w specu po zatwierdzeniu tej wersji.
6. Telemetria: dodać zdarzenie `codex_entry_unlocked` (metryka zaangażowania w fabułę).

## 8. Zasoby skończone i ukryte (decyzja 18.10)
Zasoby w świecie mają **z góry ustaloną, ukrytą ilość** – gracze nie wiedzą, ile jej jest. Dzięki temu rywalizacja o „ograniczone zasoby" (powód PvP) wynika z samego świata, a nie z gadania. Proponowana konstrukcja:
- **Złoże lokalne** pod każdym silosem: ukryta wielkość losowana przy tworzeniu (±40% wokół wartości bazowej), wyczerpuje się wydobyciem z Szybu głównego.
- **Pule głębokie** dla każdej strefy głębokości i surowca: wspólne dla wszystkich, wielkość ustawiona w configu na podstawie przewidywanej liczby graczy (ukryta przed klientem).
- **Wydajność maleje płynnie:** mnożnik `clamp(pozostało / całość, 0.15, 1)` – nikt nie trafia na twardą zero (na starcie brak „martwych kont"), ale po wyczerpaniu opłaca się schodzić głębiej, handlować lub napadać.
- **Informacja jakościowa zamiast liczb:** klient widzi tylko opis („bogate", „średnie", „na wyczerpaniu") po zwiadzie Mapowacza/Zwiadowcy; serwer nigdy nie wysyła sum.
- **Koniec sezonu:** wyczerpanie puli głębokiej lub osiągnięcie Jądra. Po sezonie publikujemy **raport z faktycznymi sumami** (przejrzystość, uczciwość).
- **Zabezpieczenia:** dzienny limit wydobycia na gracza (przeciw botom drenującym pule), minimalna podłoga wydajności, brak sprzedaży surowców za abonament.
- **Konsekwencja dla ekonomii:** ledger zapisuje, z której puli pochodzi każdy przychód (`ref = pool_id`); symulator musi testować scenariusz „pula się kończy".

## 9. Łączność i odkrywanie innych silosów (decyzja 18.10)
Gracze **nie wiedzą o innych silosach** na starcie. Muszą rozwinąć łączność i zacząć nadawać własny sygnał. To jest bramka do PvP, handlu i cechów.

Budynek **Radiostacja** (6. budynek MVP), poziomy:
| Poz. | Nazwa | Co daje |
|---|---|---|
| 0 | Izolacja | brak wiedzy o innych; nikt Cię nie widzi; tylko zjazdy (PvE) |
| 1 | Odbiornik | nasłuch: wykrywasz **sygnały** nadających silosów (kierunek + przybliżony dystans); słyszysz też „werble" Rdzeniowców |
| 2 | Nadajnik | zaczynasz nadawać: inni mogą Cię wykryć; odblokowuje rynek, wiadomości, ranking, **bycie celem najazdu** |
| 3 | Szyfr / zagłuszanie | zmniejszasz szansę wykrycia przez innych (koszt: mniej kontaktów) |
| 4 | Przekaźniki | większy zasięg; wstępnie: łącza cechowe (po MVP) |

Zasady:
- **Najazd wymaga kontaktu:** atakujący musi mieć Odbiornik, a cel musi nadawać (lub zostać wykryty skanem za parę).
- **Izolacja jest bezpieczna, ale samotna:** kto nie nadaje, nie może być napadnięty – ale nie handluje, nie jest w rankingu i nie ma dostępu do rzadkich surowców z wymiany. To naturalny kompromis zamiast wymuszonego PvP (skarga z BW).
- **Zasięg:** `r = r0 * 1.6^(L-1)`. Wartość `r0` w configu liczona z gęstości (świat skalowany do liczby graczy: np. `r0 ≈ 2 × średni dystans do najbliższego sąsiada`), żeby w becie 30–50 osób każdy po Odbiorniku poz. 1 słyszał kilka silosów.
- **Rdzeniowcy też słuchają [propozycja]:** nadawanie podnosi „hałas" i może przyciągać fale plemion – ryzyko za widoczność.

Wpływ na onboarding (zastępuje dni 1–7 ze specu): dni 1–2 sam w silosie (budowa, zjazdy) → dzień 3 Odbiornik i pierwsze „sygnały z oddali" → dni 4–5 Nadajnik, pierwszy kontakt, rynek → dni 6–7 pierwszy najazd lub pierwszy handel.

## 10. Rozstrzygnięte i otwarte
**Rozstrzygnięte:**
1. Dlaczego gracze walczą: ograniczone, ukryte zasoby świata (sekcja 8).
2. Planeta: stylizowana, bez nazw.
3. Cechy (po MVP): sieć łączy między silosami (rozwinięcie Przekaźników) – *przyjęte przy założeniu, że „ok" oznaczało pierwszą opcję; popraw, jeśli chodziło o luźny sojusz*.
4. Odkrywanie: przez łączność (sekcja 9). Wrogość gatunku: nadal do ustalenia (propozycja: z początku wroga, po sezonie 1 możliwa wymiana).

**Otwarte:**
- **Nazwa gry:** kandydat „Last Silo" (liczba pojedyncza brzmi naturalniej niż „Last Silos"). Uwaga na skojarzenia z serią „Silo" (książki i serial); to nie musi blokować, ale wymaga sprawdzenia w UPRP/EUIPO i Google Play. Wyszukiwanie z 18.10 nie znalazło gry o tej nazwie, ale to nie jest formalne badanie.
- Czy nadawanie ma przyciągać plemiona (ryzyko)?
- Wielkość ukrytych pul (do ustalenia w symulatorze ekonomii, M1).
