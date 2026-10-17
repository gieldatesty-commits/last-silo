# Research: Blood Wars → brief dla mobilnej gry „inspirowanej"

> Stan na 17.10.2026. Dokument zbiera: (1) fakty o oryginale, (2) analizę mechanik, (3) co mówią gracze, (4) rekomendacje, co zachować / zmienić / dodać, (5) uwagi o prawach autorskich, (6) pytania otwarte.
> Wszystko poniżej jest **parafrazą i analizą**, nie kopią tekstów z gry/wiki/forum. Liczby z oryginału służą wyłącznie do zrozumienia skali – w nowej grze trzeba ustalić **własne** wartości.
> Odnośniki [S#] → lista źródeł na końcu.

---

## 0. Najważniejsze wnioski (TL;DR)

1. **Gra jest wciąż aktywna** (copyright 2006–2026, nowe serwery sezonowe R20/R21) i działa pod **bloodwars.pl / bloodwars.interia.pl** – to Interia, nie Onet. Twórca: BW Team, wydawca/portal: Interia [S1, S2, S19].
2. **BW Team ma już oficjalną aplikację na Androida** (premiera ok. maj 2020, Google Play). Gracze opisują ją głównie jako „layout przeglądarkowy w aplikacji"; brak push-notyfikacji, brak iOS, niewygodne listy [S15, S18]. To **luka rynkowa**, ale też konkurencja, o której trzeba wiedzieć.
3. **Największe bolączki gry wg graczy:** brak nowego contentu, „betonowanie" serwerów i stref przez top-klan, przepaść w sile między nowymi a starymi graczami, martwy handel w late game, wolne tempo i paywall „na czas" (premium = szybsze odnawianie akcji), słaba komunikacja zespołu [S16, S17].
4. **Najlepszy kierunek dla wersji mobilnej:** async, krótkie sesje, **sezony z resetem**, uczciwa progresja dla nowych, natywne powiadomienia, dane-sterowany content (żeby dowozić nowe rzeczy szybko).
5. **Prawnie:** mechaniki i gatunek są zwykle swobodne; **nazwy, lore, grafiki, teksty, układ UI 1:1, nazwy przedmiotów i dokładne tabele balansu** – nie kopiować. Szczegóły w sekcji 6. (To nie jest porada prawna – przed premierą konsultacja z prawnikiem IP.)

---

## 1. Fakty o oryginale

| Pole | Wartość |
|---|---|
| Nazwa | Blood Wars – Wojny Krwi |
| Twórca | BW Team (mały zespół; CM wspomina o brakach kadrowych programistów) [S16] |
| Start | 8 stycznia 2006 [S1] |
| Technologia | PHP, przeglądarka [S1] |
| Model | free-to-play + konto premium (wygoda/tempo) [S12] |
| Języki / domeny | PL (bloodwars.pl), EN (.net), FR, RU, TR [S2] |
| Serwery („krainy") | R1 … R21; typy: Necropolia (handel/aukcje), Moria (aukcje, tatuaże, ulepszanie), Hardcore, sezonowe (S15) [S2, S3] |
| Skala (dane ~2009) | 16 światów, 200 tys.+ kont [S1] – dziś na pewno mniej |
| Sezony | od maja 2020: serwery sezonowe, 6 miesięcy, reset, bonusy startowe wg miejsca w rankingu, przyspieszona rozgrywka [S18] |
| Aplikacja mobilna | Android (Google Play, BWTeam Studio), iOS – brak potwierdzenia [S15, S18] |
| Wiek | 18+ wg PortalMMO [S19] |

Historia aplikacji (z forum): zewnętrzny wykonawca się nie wywiązał, sprawa trafiła do prawnika, zespół zrobił własny responsywny layout i aplikację; zapowiadano ją przez ~4 lata [S15, S16, S18].

---

## 2. Analiza mechanik oryginału

### 2.1 Pętla rozgrywki (core loop)
```
zasoby (krew / pieniądze / ludzie)  →  budynki (pasywny przychód + bonusy bojowe)
        ↑                                      ↓
 wyprawy solo (drop przedmiotów, XP)  ←  ekwipunek + atrybuty + moce
        ↓
 ataki PvP (łupy, XP)  →  klan (oblężenia, ekspedycje na bossów)  →  ranking / strefy
```

### 2.2 Zasoby i regeneracja [S11, S13]
- 3 „surowce" rosnące w czasie rzeczywistym (też offline): **krew, pieniądze, ludzie**. Przychód zależy głównie od budynków.
- Dodatkowa waluta „złom": kupowana w sklepie, nie zajmuje miejsca w ekwipunku, bezpiecznie przechowuje pieniądze (nie da się go zrabować), handlowalna.
- **Dwie osobne „paski"**: punkty życia (leczone krwią 1:1) i punkty krwi (paliwo mocy specjalnych, droższe w regeneracji). Leczenie HP ma priorytet.
- Pełne HP przywracane na początku zasadzki, o ile masz odpowiednie budynki.

### 2.3 Rasy i moce [S9]
- 4 rasy startowe + 1 odblokowywana po 2. akcie fabuły; każda ma „szkołę" mocy i inne premie statystyk, które różnią się między typami serwerów.
- Zmiana rasy ograniczona czasowo (gracz skarżył się na 180 dni blokady) [S18].

### 2.4 Wyprawy (PvE solo) [S4]
- Limit akcji jak „energia": 12 / 24 (premium) na dobę, odnawiane pojedynczo co 2 h / 1 h.
- 3 poziomy trudności; kolejny odblokowuje się po ukończeniu wszystkich questów niższego.
- Questy testują 9 atrybutów (zwinność, wygląd, odporność, charyzma, wpływy, spostrzegawczość, siła, wiedza, inteligencja); szansa sukcesu = poziom + wartość atrybutu + szczęście, z twardym sufitem (ok. 65–90 %).
- Droższe wyprawy w wyższych strefach; lepsza jakość dropu na trudniejszym poziomie.
- Płatna „karawana": wiele wypraw naraz, drożej o ok. 75 % za każdą kolejną.
- Wyniki rozstrzygane „leniwie" – z opóźnieniem do ok. 3 min po akcji gracza.

### 2.5 Ataki PvP (zasadzki) [S5]
- Dwa etapy: test zasadzki (czy zaskoczysz przeciwnika) → walka do 10 rund.
- Ograniczenia: różnica poziomów (≤3 lub min. 70 % poziomu silniejszego), **okno ochronne celu zależne od strefy** (30–120 min), max 2 ataki na tego samego gracza dziennie – wszystko wymuszone w kodzie.
- Łup: ok. 30 % pieniędzy i ludzi, 10 % krwi; przegrany atakujący płaci okup.
- Obrona wygrana daje 1/4 nagrody atakującego.
- Walka: inicjatywa, uniki, trafienie, krytyki, bonusy z budynków.

### 2.6 Miasto, strefy, budynki [S6, S10]
- 5 koncentrycznych stref (od „przedmieść" do „władcy"); wyższa strefa = lepsze budynki, zadania, dropy; limity graczy z jednego klanu w wyższych strefach.
- Każdy gracz ma jeden „kwadrat"; można go przejąć w oblężeniu (z zamianą miejsc).
- Budynki: ekonomia (ludzie, pieniądze, krew), obrona/atak (policja, agencja), szpiegostwo, handel, magazyn na ekwipunek, szybkość podróży. Wyższe strefy budują się dopiero po skompletowaniu niższych.

### 2.7 Klany, oblężenia, ekspedycje [S7, S8, S14]
- Założenie klanu wymaga **konta premium** i min. poziomu; wielkość zależy od poziomu założyciela (do 50).
- **Oblężenie:** faza przygotowań (12–18 h) + faza walki (10 min – kilka h), uczestnicy blokowani w akcjach; limit częstotliwości (48 h / 24 h premium); łup dzielony, lider dostaje podwójnie.
- **Ekspedycje na bossów (PvE kooperacyjne):** 2 mapy po 17 lokacji, medale otwierają kolejne lokacje, runy/talizmany, wspólny „rytuał" odradzania mobów finansowany reputacją i ludźmi, solo = bonus dla bossa.
- Dużo rzeczy zależy od typu serwera (np. przedmioty klanowe w ekspedycjach działają tylko na Necropolii).

### 2.8 Monetyzacja [S12]
Premium w oryginale to głównie **tempo + wygoda + funkcje społeczne**:
szybszy zwrot wypraw i ataków (x2), większy limit akcji, możliwość założenia klanu, lista przyjaciół, podgląd szans sukcesu questów, krótsze odstępy między oblężeniami, większa skrzynka wiadomości.
Ceny w pakietach od ok. 21 do 270 dni. Dodatkowo płatna „karawana".

### 2.9 Systemy poboczne (z listy tutoriala) [S3]
Tatuaże (Moria), ewolucje (drzewka), „studnia dusz" (ulepszanie przedmiotów), umagicznienia, runy/talizmany, areny 1v1/3v3 i klanowe, Król Wzgórza, polowania, podróże, skarby, bonusy czasowe, nagrody za logowanie, urlop, reputacja, szczęście, system anty-najemniczy.
Wniosek: **gra urosła przez nawarstwianie systemów** – dla mobile lepiej zacząć od małego rdzenia.

---

## 3. Co mówią gracze (forum) – problemy i pomysły

### 3.1 Dlaczego gra traci graczy [S16]
- **Brak nowego contentu** po 10+ latach tej samej pętli; nowe rzeczy wchodzą rzadko.
- **Nieprzemyślane zmiany/patche**, które wymagają kolejnych poprawek; presja graczy broniących własnych postaci.
- **Opóźnienia i słaba komunikacja** (obietnice bez dat, brak odpowiedzi).
- **Przepaść postępu:** po roku gry nowy gracz nie nadgoni punktów ewolucji i run; szybkie serwery pomagają tylko w poziomach, nie w topce [S16].
- **Martwy late-game handel** (na części serwerów handluje się głównie „złomem") [S18].
- Wymieniane „starożytne" tempo: czekanie minut na wynik wyprawy, szybkość płatna premium [S16].

### 3.2 Strefy i „betonowanie" [S17]
- Po uformowaniu top-klanu strefy 1–3 są zajęte na stałe; nowi gracze tracą motywację.
- Pomysły graczy:
  - budynki z wyższych stref budowalne wcześniej wg **poziomu postaci**, niezależnie od strefy;
  - **kwadrat przypisany do postaci**, nie do pozycji;
  - zostawić tylko najwyższą strefę jako nagrodę z **bonusem dla całego klanu** (np. luck na wyprawach) zamiast osobistego;
  - mechanizmy premiujące mniejsze klany (korzyści dzielone na liczbę członków, stanowiska z realnymi bonusami);
  - zdjęcie bonusów budynków z aren 1v1, by liczył się trening i ekwipunek, a nie „klocek".
- Kontrargument: strefy dają sens rywalizacji o terytorium; spłaszczenie zabija „wojny" i prestiż.

### 3.3 Sezony i speed-serwery [S18]
- Prośby o serwery sezonowe z resetem i mnożnikami (exp, zasoby, budowa) → później zrealizowane przez BW Team.
- Część graczy nie chce zaczynać od zera co pół roku; inni uważają sezony za dobre wejście dla nowych.

### 3.4 Opinie o aplikacji mobilnej / nowym layoucie [S15, S18, S21]
Rzeczy, których brakowało lub które irytowały:
- brak **push-powiadomień** (koniec ataku, koniec oblężenia),
- brak ręcznego odświeżania (ważne np. na aukcji), brak zegara aukcji,
- brak **logowania na kilka serwerów jednocześnie**,
- długie listy (ekspedycje, ranking) → dużo przewijania, trudno zobaczyć, gdzie już dołączyłem,
- po zamknięciu raportu aplikacja wraca na ekran wiadomości zamiast zostać na wyprawach,
- sortowanie listy ataków nie jest zapamiętywane; za mała ikona ataku,
- przełącznik grafika/tekst dla ekwipunku i ras się resetuje,
- zasoby powinny być zawsze widoczne (nie po kliknięciu) + pasek % do kolejnego poziomu,
- rozmiary czcionek/„responsywność" jako suwak,
- zbyt szerokie uprawnienia aplikacji (dostęp do pamięci) – gracze to komentowali,
- brak iOS i niejasna komunikacja co do niego; pytanie o wybór języka w aplikacji [S21],
- część graczy: „to samo co w przeglądarce, tylko wolniej".

### 3.5 Pomysły na content z forum
- więcej prefiksów/sufiksów, setów i typów przedmiotów (buty, rękawice, pasy) → więcej kombinacji [S20],
- prosta warstwa wizualna do wypraw (mapa/mini-labirynt zamiast samych opisów tekstowych) [S20],
- **unikalne budynki** definiujące styl gry [S20],
- Akt IV / nowe poziomy progresji, „epickie 2.0" [S16],
- szybsze drzewka ewolucji i runy dla nowych [S16],
- krótsze czasy wypraw (rzędu kilku minut) i powrót karawany [S18].

---

## 4. Rekomendacje dla projektu mobilnego

### 4.1 ZACHOWAĆ (wzorce gatunku, nie chronione jako takie)
| Wzorzec | Dlaczego |
|---|---|
| Async tekstowo-statystyczny PvP z oknem ochronnym | Idealne na telefon, brak potrzeby „bycia online" |
| Zasoby przyrastające offline | Dobre dla krótkich sesji |
| Wyprawy/misje na timerach z szansą sukcesu | Naturalne dla push-powiadomień |
| Klany + współdzielone PvE bossy | Główny motor retencji społecznej |
| Budynki jako pasywna ekonomia + bonusy bojowe | Daje poczucie rozwoju |
| Sezony z resetem i bonusem za miejsce | Rozwiązuje „betonowanie" i przepaść |

### 4.2 ZMIENIĆ (żeby nie być klonem – mechanika i tożsamość)
| Element oryginału | Proponowana zmiana |
|---|---|
| Wampiry w postnuklearnym mieście z 5 koncentrycznymi strefami | **Inny świat i inna struktura mapy** (np. graf dzielnic/węzłów zamiast kół; inny motyw: miasto-ul, stacja kosmiczna, podziemne królestwo…) |
| Nazwy: kwadrat, strefa, klan, arkana, rasa, Necropolia/Moria, złom, pielgrzymka itd. | Własna terminologia i własne lore |
| 3 zasoby: krew/PLN/ludzie | Własny zestaw (np. 2 zasoby + 1 sezonowy), inna logika magazynowania |
| 9 atrybutów (te same nazwy) | Własny, mniejszy zestaw (np. 5–6) z innymi rolami |
| Leniwe rozstrzyganie akcji z opóźnieniem | **Serwerowy scheduler** – wynik dokładnie na czas |
| Premium = szybsze odnawianie akcji | Zamiast „płacisz za czas" → kosmetyka, wygoda (kolejka akcji), battle pass sezonowy, bez przewagi PvP |
| Zakładanie klanu tylko dla premium | Klan dla każdego; premium daje wygodę zarządzania |
| Rasy ze sztywnymi bonusami | Klasy/„archetypy" z wymiennymi talentami i respec w sezonie |
| Kwadrat jako przedmiot walki (zamiana terenu) | Terytorium **klanowe/sezonowe**, nagroda = bonus dla całego klanu, nie osobista fortuna |
| Statyczne, wiecznie rosnące serwery | **Sezony 8–12 tyg.** + rotacja reguł + ligi poziomowe |

### 4.3 DODAĆ (odpowiedź na bolączki graczy)
**Onboarding i fair play**
- Tutorial w grze (oryginał dodał go dopiero w 2020 [S18]).
- **Matchmaking po sile / ligi**, nie tylko po poziomie – nowy gracz nie spotyka „betonu".
- Mechanizmy catch-up (bonusy dla niżej w rankingu, skrócone drzewka w pierwszych tygodniach).
- Zasady anty-snowball w klanach (korzyści skalują się z liczby aktywnych członków, bonus dla mniejszych klanów).

**Mobile-native UX (z listy skarg w pkt 3.4)**
- push-powiadomienia o końcu wypraw / ataków / oblężeń (konfigurowalne),
- stały pasek zasobów i XP,
- **kolejka akcji** (np. 3 wyprawy z rzędu) bez płacenia,
- szybki panel „co robić teraz" (1 tap → następna akcja),
- zapamiętane sortowanie/filtry, duże cele dotykowe, tryb tekstowy/ikonowy jako trwałe ustawienie,
- po zamknięciu raportu zostajesz w tym samym kontekście,
- wiele postaci/serwerów na jednym koncie, przełączanie bez wylogowania,
- minimalne uprawnienia aplikacji, tryb oszczędzania danych,
- wersja językowa wybierana w aplikacji (PL/EN od startu), **iOS i Android jednocześnie**.

**Content velocity**
- Cały balans i content jako **dane (JSON/YAML + edytor)**: nowa wyprawa/przedmiot bez wydania kodu – to bezpośrednio adresuje „brak contentu" [S16].
- Eventy tygodniowe, sezonowe tematy, rotujące „mutatory" reguł.
- Mała warstwa wizualna wypraw (ilustracje/animacje lokacji), jak sugerowali gracze [S20].

**Ekonomia**
- Aukcje/handel dostępne od początku, z opłatami wymuszającymi „sink" zasobów.
- Limity i anty-pushing (przekazywanie majątku między kontami) w regułach.

### 4.4 Proponowany MVP (vertical slice)
1. Konto + postać (archetyp, 5–6 atrybutów).
2. Budynki: 3–4 sztuki (2 ekonomia, 1 obrona, 1 atak).
3. Wyprawy z timerem + powiadomienie push + drop ekwipunku.
4. Lista celów PvP + walka async (do N rund) + raport w jednym ekranie.
5. Ranking sezonowy + reset.
6. Dopiero potem: klany, bossy kooperacyjne, oblężenia/wojny terytorialne, handel.

### 4.5 Sugestie techniczne (do dyskusji)
- **Backend autorytatywny**, zdarzenia na schedulerze (np. kolejka zadań z czasem wykonania), idempotentne akcje, logowanie dla anty-cheat.
- Klient: Flutter / Unity / Godot (wybór zależy od tego, ile ma być grafiki; przy UI-heavy tekstowym RPG często wystarczy Flutter/React Native).
- Konfiguracja gry w repozytorium danych + panel admina dla balansu.
- Telemetria od dnia 1 (retencja D1/D7/D30, lejek onboardingu, czas do pierwszego ataku/wyprawy).

---

## 5. Różnicowanie od oryginału – checklista

- [ ] Nowa nazwa gry (bez „Blood Wars"/„Wojny Krwi"/„BW").
- [ ] Nowy świat, nowe frakcje, nowe teksty (zero kopiowania z gry, wiki, forum).
- [ ] Własna grafika, ikony, logo, muzyka; żadnych zrzutów/asetów z oryginału.
- [ ] Własna terminologia mechanik i nazw przedmiotów/prefiksów/setów.
- [ ] Własne tabele balansu (inne liczby, inne wzory, inny układ progresji).
- [ ] Inny układ ekranów i nawigacji (mobile-first, nie port layoutu z przeglądarki).
- [ ] Zmieniona struktura świata (nie 5 kół/stref 1:1) i inna logika „wojen".
- [ ] Własna ekonomia i monetyzacja.
- [ ] Brak automatyzacji/scrapowania oryginalnych serwerów w procesie developmentu (regulamin).

---

## 6. Uwagi o prawach autorskich i znaku towarowym (informacyjnie, nie porada prawna)

- **Zasada ogólna (prawo autorskie w UE/PL):** chroni **wyrażenie** (kod, teksty, grafiki, muzykę, oryginalną kompozycję), a nie same **pomysły, zasady i mechaniki** gry. Dlatego gatunek („async RPG z klanami i timerami") i ogólne mechaniki są zwykle swobodne.
- **Ryzykowne obszary:** nazwy i logo (znak towarowy), unikalne postacie/lore, teksty opisów, grafiki, **układ i „look & feel" UI kopiowany 1:1**, baza danych przedmiotów/wartości skopiowana wprost, kod, dźwięki. Złożone, rozpoznawalne połączenie wielu takich elementów może być uznane za naruszenie.
- **Kolizje nazw:** „Blood Wars" to też nazwa karcianki TSR (1995) i książki z cyklu Necroscope („Bloodwars") – kolejny powód, by **nie używać tej nazwy** (patrz Wikipedia: strona ujednoznaczniająca „Blood Wars": https://en.wikipedia.org/wiki/Blood_Wars oraz https://en.wikipedia.org/wiki/Blood_Wars_(card_game)).
- **Źródła wiedzy:** BWpedia i forum to treści społecznościowe z własnymi „Informacjami prawnymi" i polityką – **tej strony nie czytałem**; nie kopiować tekstów ani tabel, tylko pisać własną specyfikację (clean-room).
- **Praktyka:** jedna osoba analizuje oryginał i pisze spec w innych słowach/liczbach, a druga implementuje wyłącznie ze speca; zachować historię decyzji projektowych.
- Przed premierą: krótka konsultacja z prawnikiem od IP (nazwa, znak towarowy, ocena podobieństwa).

---

## 7. Pytania otwarte do Ciebie (Damian)

1. **Kto jest odbiorcą?** Gracze BW chcący „lepszego mobile", czy nowi gracze mobilni, którzy nigdy nie grali?
2. **Motyw:** zostajesz przy mrocznym klimacie (np. inna istota/świat) czy robisz zupełnie inny setting?
3. **Platformy:** Android+iOS od razu? Silnik (Flutter/Unity/Godot)?
4. **Zespół i budżet:** solo + AI/outsourcing grafiki? Harmonogram MVP?
5. **Monetyzacja:** kosmetyka + battle pass vs. subskrypcja wygody? (odradzam „płacisz za czas" jako rdzeń).
6. **Skala serwerów/sezonów:** jeden globalny sezon z ligami czy wiele małych światów?
7. **Backend:** self-hosted vs. chmura; gdzie trzymać konfigurację contentu?
8. **Poziom ryzyka prawnego:** chcesz zostać blisko oryginału w mechanikach (szybciej, ale z większym ryzykiem), czy od początku iść w wyraźnie inną tożsamość?

---

## 7a. Decyzje projektowe (ustalone 17.10.2026)

| Obszar | Decyzja Damiana | Uwagi / rekomendacja |
|---|---|---|
| Odbiorca | Gracze BW chcący lepszego mobile **oraz** nowi gracze mobilni | Onboarding dla nowych musi być pełnoprawnym celem (tutorial, ligi, catch-up), a „weterani" dostają głębię (klany, rynek, wojny sezonowe) |
| Motyw / setting | **„Głębia" – podziemna kolonia** (wybrane 17.10.2026; pomysł motywu z istniejącego anime odrzucony ze względu na IP) | Mini-biblia w sekcji 7d; ton i lokalizacja – założenia robocze do potwierdzenia |
| Ekonomia startowa | **Zamknięta** (bez wypłat na realne pieniądze) | Decyzja z 17.10.2026 |
| Platforma | **Android** (iOS później) | Silnik: rekomendacja Flutter lub Godot; Unity tylko jeśli ma być dużo grafiki/animacji. Architektura od początku niezależna od platformy (cienki klient, logika na serwerze) |
| Zespół | Solo + AI | Zakres MVP bardzo mały; grafika AI + zakup paczek assetów z jasną licencją; sprawdzać licencje komercyjne generatorów |
| Monetyzacja | **Subskrypcja za wygodę** (kolejkowanie, zarządzanie klanem itp.) | Nie sprzedawać przewagi w PvP; wygoda = kolejki, automatyzacje, panele klanowe, statystyki |
| Skala | **Sezony** | Rekomendacja: 8–12 tygodni, ligi, reset z bonusem startowym za miejsce |
| Backend | Najtańszy start, możliwość skalowania i migracji | Patrz sekcja 7c |
| Ryzyko prawne | **Własna tożsamość** | Zgodne z checklistą w sekcji 5 |
| Ekonomia | **Wzorowana na ekonomii ze świata książek „Droga Szamana"** (Barliona) | Patrz sekcja 7b i uwagi o ryzyku w 7b.4 |

---

## 7b. Ekonomia inspirowana LitRPG („Droga Szamana")

### 7b.1 Co potwierdziło wyszukiwanie
Źródła (opisy wydawców książki) potwierdzają tylko **ogólną ideę świata**: w grze Barliona **państwo gwarantuje walutę w grze i pozwala jej swobodnie krążyć**, przez co ludzie masowo wchodzą do gry „za łatwym zarobkiem"; twórcy gry wykorzystują też pracę skazanych w wirtualnych kopalniach; bohater ma klasę oraz **profesję (np. jubiler)**, a klany walczą o **bazę/zamek** [S22–S24].
Szczegółów mechaniki (kursy, podatki, aukcje, dokładne profesje) wyszukiwanie **nie potwierdziło** – jeśli chcesz wiernie odwzorować konkretne rozwiązania z książek, trzeba je spisać z samych książek (i nadal robić własne, zmienione wersje).

### 7b.2 Filary ekonomii do zaprojektowania (własne, ogólne wzorce gatunku)
1. **Rynek sterowany przez graczy.** NPC sprzedają tylko podstawy; wartościowe rzeczy tworzą i sprzedają gracze.
2. **Profesje i współzależność.** Każdy gracz ma 1–2 profesje (zbieracz → rzemieślnik → handlowiec). Nikt nie robi wszystkiego; stąd handel i klany.
3. **Produkcja async.** „Warsztaty", kontrakty pracy i zlecenia na timerach – naturalne dla telefonu (czas offline = praca).
4. **Faucets i sinks (źródła i ujścia).** Zasoby wchodzą do gry z wypraw i produkcji; muszą z niej **wychodzić**:
   - opłaty rynkowe (wystawienie + prowizja od sprzedaży),
   - zużycie/trwałość ekwipunku i naprawy,
   - ryzyko przy ulepszaniu (część rzeczy ulega zniszczeniu),
   - utrzymanie budynków i bazy klanowej,
   - opłata wejściowa/pula sezonowa.
5. **Skarbiec klanowy i baza klanu.** Klan zbiera środki, utrzymuje bazę, finansuje wojny/ekspedycje; opcjonalne podatki od członków ustalane przez klan.
6. **Narzędzia rynku na mobile.** Zlecenia kupna/sprzedaży (order book), historia cen, alerty cenowe, hurtowe wystawianie, powiadomienia o transakcji.
7. **Stabilizacja cen.** Zlecenia kupna od NPC jako „podłoga cen", okresowe zdarzenia zmieniające popyt, sezonowy reset ekonomii z bonusem startowym.
8. **Anty-nadużycia.** Limity handlu dla nowych kont, wykrywanie przelewania majątku między kontami (push), limity cen odbiegających od rynku, logi transakcji.

### 7b.3 Co to rozwiązuje względem Blood Wars
- „Martwy handel w late game" [S18] → rynek z realnym popytem (zużycie, naprawy, rzemiosło).
- Przepaść dla nowych [S16] → profesje daje nisze dochodowe niezależne od top-PvP.
- „Betonowanie" [S17] → bogactwo klanu zużywane na utrzymanie i wojny, nie tylko kumulowane.

### 7b.4 UWAGA: waluta wymienialna na prawdziwe pieniądze
W świecie książki waluta jest gwarantowana i swobodnie wymienialna. W realnej grze **wypłata/wymiana waluty na prawdziwe pieniądze to bardzo ryzykowny obszar**:
- polityki sklepów (Google Play / Apple) dot. gier z realnymi nagrodami pieniężnymi i wirtualnych walut,
- regulacje: hazard/loterie (jeśli losowość + realna wartość), płatności i pieniądz elektroniczny, AML/KYC,
- podatki (PIT/VAT) po stronie graczy i firmy, ochrona małoletnich,
- oszustwa i RMT (handel kontami/walutą), przewaga „pay-to-win".

**Rekomendacja:** zacząć od **zamkniętej ekonomii** (bez wypłaty na realne pieniądze); realne pieniądze wchodzą tylko jednokierunkowo (subskrypcja, kosmetyka). **DECYZJA (17.10.2026): na start zostajemy przy ekonomii zamkniętej** – bez wypłat i wymiany na prawdziwe pieniądze. Ewentualną „wymienialność" rozważyć dopiero po konsultacji z prawnikiem i sprawdzeniu aktualnych zasad sklepów.

### 7b.5 Propozycje settingu – opis szczegółowy
Wszystkie nazwy poniżej to **robocze placeholdery** (do sprawdzenia pod kątem znaków towarowych i dostępności) – nie odnoszą się do żadnych istniejących gier.

#### Opcja 1: „Głębia" – podziemna kolonia (REKOMENDOWANA)
- **Pitch:** Powierzchnia stała się niezamieszkana (np. wieczny pył i zima po katastrofie klimatycznej). Ludzie żyją w pionowym systemie szybów, hal i sztolni. Im głębiej, tym bogatsze złoża i większe ryzyko.
- **Frakcje (zamiast klanów):** rody/cechy górnicze walczące o szyby i hale produkcyjne. Baza rodu = „siedziba w sztolni", rozbudowywana wspólnie.
- **Struktura świata:** **graf połączonych szybów i poziomów** (nie koncentryczne strefy). Węzły (hale, skrzyżowania, złoża) można zajmować, rozbudowywać i przechwytywać; trasy mają długość = czas podróży.
- **Zasoby:** ruda, paliwo geotermalne, woda, części/komponenty; jedna waluta miękka (np. „żetony koncesyjne") w zamkniętej ekonomii.
- **Profesje:** wydobywca → hutnik/rafiner → rzemieślnik (jubiler, mechanik, kowal) → handlowiec/logistyk; osobno medyk i zwiadowca. Każdy gracz 1–2 profesje.
- **PvE:** wyprawy do niezbadanych szybów (timer + szansa), ekspedycje rodowe na „kolosy" (wielkie stwory/maszyny z głębi), zdarzenia sezonowe (zawalenia, powodzie, wykryte złoża).
- **PvP:** najazdy na składy i warsztaty, spory o szyby, wojny rodów o węzły; okna ochronne i limity jak w sensownej wersji async.
- **Ton/estetyka:** ciemny, ciepłe światło lamp i żył rudy, industrialne rzemiosło. **Bardzo przyjazne dla grafiki AI i UI-heavy gier** (przekroje pionowe, ikony narzędzi/kruszców, proste ilustracje).
- **UI mobilny:** nawigacja „w dół/w górę" (pionowy przekrój kolonii), listy poziomów, mapa węzłów z liniami szybów.
- **Dlaczego pasuje do ekonomii:** wydobycie → przerób → rzemiosło → handel to naturalny łańcuch dla profesji i rynku graczy; utrzymanie szybów i bazy rodu to naturalny „sink".
- **Dystans od Blood Wars:** wysoki (inny świat, inna mapa, inne frakcje, inny ton).
- **Ryzyka:** gatunek „kopalnia/survival" jest popularny, więc potrzebny wyróżnik (np. pionowy graf, sezonowe katastrofy zmieniające mapę).

#### Opcja 2: „Dryf" – rozbita stacja kosmiczna
- **Pitch:** Uszkodzona stacja kosmiczna dryfuje przy pasie asteroid. Sektory zasiedlają korporacje i frakcje najemnicze, walczące o energię, tlen i metal.
- **Frakcje:** korporacje/konsorcja; baza = moduł stacji (doki, reaktory, fabryki).
- **Struktura:** sektory połączone korytarzami i śluzami; wyższe sektory = lepsze systemy, ale większe ryzyko. Możliwe wyprawy „na zewnątrz" (wraki, asteroidy).
- **Zasoby:** energia, tlen, metal, komponenty elektroniczne; waluta miękka (kredyty stacji).
- **Profesje:** górnik asteroid, inżynier, hacker, pilot/transport, handlowiec.
- **PvE:** wyprawy na wraki, ekspedycje konsorcjum na „anomalie", zdarzenia (awarie, pożary).
- **PvP:** abordaże, sabotaż modułów, wojny o kontrolę nad sektorami/dokami.
- **Ton/estetyka:** technologiczny, neonowo-industrialny; łatwe w ilustracjach AI (modułowość).
- **Dystans od BW:** wysoki.
- **Ryzyka:** bardzo zatłoczony gatunek; wymaga rozpoznawalnego stylu; może oddalić część graczy lubiących klimat „mrocznego fantasy".

#### Opcja 3: Mroczne fantasy z inną istotą niż wampiry – „Konstrukty / Iskra"
- **Pitch:** Wygasłe miasto, w którym żyją konstrukty ożywione „iskrą" (golemy, mechaniczne istoty). Iskra się wyczerpuje, więc trzeba ją pozyskiwać, wymieniać i chronić. Miasto jest podzielone między kasty/zakony.
- **Frakcje:** zakony/kasty; baza = twierdza/kuźnia zakonu.
- **Struktura:** dzielnice miasta (graf), każda z innym surowcem i ryzykiem.
- **Zasoby:** iskra, metal, kamienie rzemieślnicze, części; waluta miękka (np. „fragmenty").
- **Profesje:** kowal, alchemik, wydobywca iskry, zbieracz, handlarz, medyk-naprawiacz.
- **PvE:** wyprawy do ruin, ekspedycje zakonu na strażników/kolosy.
- **PvP:** najazdy na kuźnie, spory o dzielnice, wojny zakonów.
- **Ton/estetyka:** mroczne fantasy, steampunk/gotyk; dużo dopracowanych ilustracji (więcej pracy grafika AI).
- **Dystans od BW:** średni – bliższy klimatem, więc **wymaga szczególnej dbałości o własne nazwy, lore i mechanikę**.
- **Ryzyka:** łatwo „zjechać" w klon BW; trudniej utrzymać spójny styl grafiki.

#### Porównanie
| Kryterium | Głębia (1) | Dryf (2) | Konstrukty (3) |
|---|---|---|---|
| Pasuje do ekonomii zawodowej | ★★★ | ★★★ | ★★ |
| Odległość od BW (prawnie/tożsamościowo) | ★★★ | ★★★ | ★★ |
| Łatwość grafiki AI | ★★★ | ★★★ | ★★ |
| Atrakcyjność dla weteranów BW | ★★ | ★ | ★★★ |
| Atrakcyjność dla nowych graczy mobile | ★★★ | ★★★ | ★★ |
| Wyróżnialność na rynku | ★★ | ★ | ★★ |
| Spójność z UI pionowym (mobile) | ★★★ | ★★ | ★★ |

**Rekomendacja:** Opcja 1 jako główna; opcja 3 jeśli chcesz mocniej zatrzymać weteranów BW; opcja 2 jako najbardziej „czyste" odejście od klimatu BW.

---

## 7c. Backend: tanio na start i skalowalnie

**Założenie:** logika gry na serwerze (autorytatywna), klient cienki. Dzięki temu migracja hostingu nie dotyka klienta.

| Etap | Propozycja |
|---|---|
| Start (prototyp/MVP) | Jedna maszyna VPS (np. u europejskiego dostawcy), Docker Compose: API + PostgreSQL + Redis + reverse proxy; backup bazy codziennie na zewnętrzny storage |
| Wzrost | Zarządzana baza (Postgres) + osobny serwer aplikacji; kolejka zadań do timerów (osobny worker) |
| Skalowanie | Konteneryzacja → chmura (k8s lub zarządzane kontenery); stateless API za load balancerem; Redis do cache/limitów |
| Powiadomienia | FCM (Android) przez dedykowany worker; kolejka powiadomień |
| Content | JSON/YAML w repozytorium Git + import do bazy; wersjonowanie balansu; panel admina później |
| Unikać na początku | Uzależnienia od jednego dostawcy (np. czysty BaaS) w warstwie ekonomii, bo trudniej zmigrować i pilnować spójności transakcji |

Koszty na starcie to zwykle **rząd kilkudziesięciu zł/EUR miesięcznie** przy małej liczbie graczy (do zweryfikowania u wybranego dostawcy). Najważniejsze są **backupy i transakcyjność** (ekonomia = poprawność księgowania).

---

## 7d. Mini-biblia świata „Głębia" (wersja robocza 0.1)

> Wszystkie nazwy i pomysły są **własne i robocze**. Przed użyciem sprawdzić znaki towarowe (UPRP/EUIPO) i dostępność nazw w sklepach. Założenia do potwierdzenia: **ton** = poważny, industrialny, z odrobiną suchego humoru; **lokalizacja** = fikcyjna, nienazwana kolonia z lekkim środkowoeuropejskim klimatem (bez realnych nazw miejsc).

### 1. Idea w jednym zdaniu
Po latach pyłowej zimy ostatni ludzie żyją w systemie szybów i hal pod martwą powierzchnią. Każdy gracz jest robotnikiem-rzemieślnikiem, który z własnej sztolni wspina się w górę hierarchii cechów, handlu i walki o węzły kolonii.

### 2. Świat
- **Przyczyna katastrofy:** wulkaniczny **Pył** zasłonił niebo i zabił powierzchnię (inna przyczyna niż w BW; bez motywu wojny jądrowej).
- **Kolonia:** pionowy system szybów, hal, skrzyżowań i bocznic, zbudowany przed katastrofą i rozbudowywany przez przetrwałych.
- **Zagrożenie z głębi:** **Wielka Maszyna** – starożytny, nadal działający system wydobywczy, który budzi się coraz głębiej i zaczyna „odtwarzać się" w postaci **Kolosów** (wielkich maszyn-stworów). To jest oś fabularna sezonów.
- **Ton narracji:** praca, ryzyko, rzemiosło, solidarność cechów i brutalna konkurencja o węzły.

### 3. Struktura mapy (bez koncentrycznych stref)
- **Poziomy pionowe** (4 + wydarzeniowy):
  1. **Przedproże** – start, bezpieczne, podstawowe zasoby,
  2. **Chodniki** – średnie ryzyko, rzemiosło,
  3. **Hale** – wysokie zyski, wojny cechów,
  4. **Żyły** – rzadkie złoża i Kolosy,
  5. **Otchłań** (tylko w finale sezonu) – wydarzenie specjalne.
- **Graf węzłów** na każdym poziomie. Typy węzłów: **Szyb** (wydobycie), **Hala** (produkcja), **Skrzyżowanie** (ruch/kontrola), **Złoże** (rzadkie zasoby), **Bocznica** (magazyny), **Targ** (rynek), **Brama** (przejście między poziomami).
- **Kontrola węzłów:** cech może zająć węzeł, ma z niego pasywny przychód i musi go utrzymać (zasoby utrzymania). Przejście z poziomu na poziom wymaga poziomu postaci i/lub „przepustki" cechu.

### 4. Słowniczek własnych terminów (zamiast BW)
| W BW | W Głębi (robocze) |
|---|---|
| klan | **cech** |
| lider klanu | **mistrz cechu** |
| kwadrat | **sztolnia** (osobista baza gracza) |
| strefa | **poziom** (pionowy) |
| arkana | **techniki warsztatowe / znaki** |
| rasa | **archetyp** |
| wyprawy | **zjazdy** |
| ataki | **najazdy** |
| oblężenie | **szturm na węzeł** |
| ekspedycja na boss | **zejście na Kolosa** |
| krew | **para** (energia/paliwo) |
| pieniądze | **żetony** |
| ludzie | **załoga** |
| złom | **zapas** |
| konto premium | **abonament Majstra** (nazwa robocza) |

### 5. Archetypy (4 na start, własne role)
| Archetyp | Rola | Charakter |
|---|---|---|
| **Górnik** | wytrzymały, bije mocno, dobry w wydobyciu | frontowy, tank/dps |
| **Inżynier** | technika, naprawy, urządzenia | wsparcie, kontrola pola |
| **Zwiadowca** | percepcja, szczęście, unikanie, mapowanie | szybki, unikający |
| **Alchemik** | odczynniki, leczenie, wzmocnienia | wsparcie, buffy |
Specjalizacje (talenty) wybiera się na poziomach, z możliwością zmiany raz na sezon (rozwiązuje skargę z BW na blokadę zmiany rasy).

### 6. Profesje (do 2 na gracza)
1. **Wydobywca** – ruda, kamienie
2. **Płuczek/separator** – wzbogacanie surowców
3. **Hutnik** – wytop metali
4. **Kowal** – broń i narzędzia
5. **Jubiler** – wyroby szlachetne, wysoka marża
6. **Mechanik** – maszyny, naprawy, usprawnienia
7. **Energetyk** – para, generatory, zasilanie bazy
8. **Alchemik** – odczynniki i wzmacniacze
9. **Szwacz** – pancerze i wyposażenie
10. **Faktor (handlowiec)** – lepsze warunki rynkowe, narzędzia cenowe
11. **Kurier/logistyk** – szybsza podróż i transport zasobów
12. **Mapowacz** – odkrywanie złóż, mniejsze ryzyko zjazdów

### 7. Zasoby i ekonomia (zamknięta)
- **Zasoby bazowe:** ruda żelaza, ruda miedzi, ruda szlachetna, węgiel/paliwo, woda, kamienie.
- **Zasoby przetworzone:** stopy, odczynniki, komponenty, tkaniny/skóry.
- **Waluta:** **żetony** (miękka, zamknięta). Brak wypłaty na realne pieniądze (decyzja z 17.10.2026).
- **Para:** zasób energii do akcji i bazy.
- **Ujścia (sinks):** utrzymanie sztolni i węzłów, naprawy, opłaty rynkowe, ryzyko przy ulepszaniu, koszty zejść na Kolosy, składka cechowa.

### 8. Sztolnia gracza – budynki (własne, różne od BW)
| Budynek | Funkcja |
|---|---|
| **Szyb główny** | przychód z wydobycia |
| **Magazyn** | pojemność zasobów |
| **Warsztat** | rzemiosło, zlecenia |
| **Kuźnia/Piec** | przeróbka metali |
| **Laboratorium** | odczynniki, ulepszenia |
| **Kantyna** | regeneracja załogi/energii |
| **Wartownia** | obrona przed najazdami |
| **Biuro faktora** | limity rynku, alerty cen |
| **Winda** | szybkość przemieszczania |

### 9. Pętle rozgrywki (mobilne)
- **Krótka (1–3 min):** odbiór produkcji, zlecenie zjazdu, zlecenie rzemiosła, odpowiedź na wydarzenie.
- **Średnia (dzień):** kolejka zjazdów/crafting, handel, najazdy w oknie ochronnym.
- **Długa (tydzień/sezon):** rozwój sztolni, profesji, cechu, walka o węzły, zejścia na Kolosy.
- **Sezon:** **„Zmiana" 8–12 tygodni**, katastrofa sezonowa zmieniająca mapę (zawalenie, zalanie, nowa żyła), reset z bonusem startowym za miejsce.

### 10. PvE i PvP (własne zasady)
- **Zjazdy (PvE solo):** wybór trasy/ryzyka, timer, szansa zależna od profesji, wyposażenia i mapy; kolejka akcji w abonamencie, ale **limity i szanse takie same** (bez przewagi mocy).
- **Zejścia na Kolosy (PvE cech):** wspólny boss, udział zależny od wkładu, nagrody dzielone według zasad cechu.
- **Najazdy (PvP async):** liga wg siły (nie tylko poziomu), okna ochronne, limity na cel, raport w jednym ekranie.
- **Szturm na węzeł (PvP cechów):** deklaracja → przygotowanie → rozstrzygnięcie, z ograniczeniami częstotliwości.

### 11. Onboarding nowych graczy (pierwsze 7 dni)
- Dzień 1: tutorial w grze, pierwsza sztolnia, pierwszy zjazd i pierwszy najazd na bota.
- Dni 2–3: wybór profesji, pierwszy craft, pierwszy rynek.
- Dni 4–5: dołączenie do cechu (rekomendacje dla mniejszych cechów).
- Dni 6–7: pierwszy szturm lub zejście na mini-Kolosa.
- Mechanizmy catch-up przez cały sezon: bonusy dla niżej w rankingu, wolniej rosnące koszty.

### 12. Abonament (wygoda, nie moc)
- kolejka akcji (np. do 5 zjazdów/zleceń rzemiosła),
- panel cechu (statystyki wkładów, masowe wiadomości, planer szturmów),
- alerty cenowe i historia cen na rynku,
- wiele postaci/kont w jednym kliencie,
- kosmetyka sztolni i awatara.
**Zasada:** abonament zmniejsza liczbę kliknięć, nie zwiększa siły postaci.

### 13. Elementy wyróżniające (USP)
1. **Pionowy przekrój kolonii** jako główny ekran (UI mobilny).
2. **Graf węzłów** zamiast prostych stref i kwadratów.
3. **Sezonowe katastrofy** zmieniające mapę i ekonomię.
4. **Profesje i współzależność** zamiast „każdy robi wszystko".
5. **Liga siły** i mechanizmy anty-betonowe.

### 14. Następne kroki
1. Potwierdzić ton i lokalizację (sekcja 7d, nagłówek).
2. Zdecydować o nazwie roboczej gry i sprawdzić ją w UPRP/EUIPO oraz w sklepach.
3. Spec MVP: sztolnia (3–4 budynki), zjazdy z timerami, najazdy async, rynek (podstawowy), push-powiadomienia.
4. Prototyp klienta + serwer (Postgres, scheduler) w trybie jednego VPS.

---

## 8. Źródła

- [S1] Wikipedia – Blood Wars (video game): https://en.wikipedia.org/wiki/Blood_Wars_(video_game)
- [S2] Strona główna gry (serwery, języki): https://bloodwars.pl/?a=intro
- [S3] BWpedia – spis tutoriala: https://wiki.bloodwars.pl/index.php?title=BloodWars_Tutorial
- [S4] BWpedia – Wyprawy: https://wiki.bloodwars.pl/index.php?title=Wyprawy
- [S5] BWpedia – Napadanie: https://wiki.bloodwars.pl/index.php?title=Napadanie
- [S6] BWpedia – Struktura miasta: https://wiki.bloodwars.pl/index.php?title=Struktura_miasta
- [S7] BWpedia – Klan: https://wiki.bloodwars.pl/index.php?title=Klan
- [S8] BWpedia – Ekspedycja: https://wiki.bloodwars.pl/index.php?title=Ekspedycja
- [S9] BWpedia – Rasa: https://wiki.bloodwars.pl/index.php?title=Rasa
- [S10] BWpedia – Budynki: https://wiki.bloodwars.pl/index.php?title=Budynki
- [S11] BWpedia – Surowce: https://wiki.bloodwars.pl/index.php?title=Surowce
- [S12] BWpedia – Konto premium: https://wiki.bloodwars.pl/index.php?title=Konto_premium
- [S13] BWpedia – Regeneracja: https://wiki.bloodwars.pl/index.php?title=Regeneracja
- [S14] BWpedia – Oblężenie: https://wiki.bloodwars.pl/index.php?title=Obl%C4%99%C5%BCenie
- [S15] Forum: Nowy layout i aplikacja mobilna (grudzień 2019): https://forum.bloodwars.pl/thread.php?threadid=1343342
- [S16] Forum: „BW umiera i co z tym zrobimy?" (2018): https://forum.bloodwars.pl/thread.php?postid=8980249
- [S17] Forum: Zmiana podejścia do stref (2017): https://forum.bloodwars.pl/thread.php?postid=8952188
- [S18] Forum: Premiera aplikacji, nowe serwery (2020): https://forum.bloodwars.pl/thread.php?threadid=1344010
- [S19] PortalMMO – karta gry (wydawca Interia, 18+): https://portalmmo.pl/gra/blood-wars,354.html
- [S20] Forum: sugestie dot. przedmiotów, grafiki i budynków: https://forum.bloodwars.pl/thread.php?postid=6033854
- [S21] Forum: dyskusja o iOS/języku aplikacji: https://forum.bloodwars.pl/thread.php?postid=9001368

- [S22] Opis „The Kartoss Gambit" (Way of the Shaman #2), Tantor: https://tantor.com/the-kartoss-gambit-vasily-mahanenko.html
- [S23] Opis „The Secret of the Dark Forest" (#3), Tantor: https://tantor.com/the-secret-of-the-dark-forest-vasily-mahanenko.html
- [S24] Opis „The Phantom Castle" (#4), Tantor: https://tantor.com/the-phantom-castle-vasily-mahanenko.html

> Uwaga o aktualności: strony wiki mają różne daty ostatniej edycji (od 2010 do 2026), więc część liczb mogła się zmienić na nowszych serwerach. Opinie z forum pochodzą głównie z lat 2017–2020 (+ pojedyncze wpisy do 2024).
