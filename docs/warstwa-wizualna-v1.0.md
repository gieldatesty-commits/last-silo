# Last Silo: warstwa wizualna v1.0 (spec dla Flutter + prompt dla CC)

Makiety (artifact "Last Silo: warstwa wizualna"): Laboratorium jako konstelacje, przekrój Silosu, arkusz grafik budynków. Liczby w makietach są przykładowe. Wartości gry zostają w `config/game.yaml`, klient niczego nie wymyśla.

## 1. Zakres
1. Laboratorium: drzewko badań jako konstelacja (zamiast listy).
2. Silos: przekrój (powierzchnia + pomieszczenia podziemne) z grafikami budynków.
3. Grafiki budynków w 3 wariantach wyglądu (progi poziomu).

Poza zakresem: dźwięk, animacje zjazdów, ekrany z menu „Więcej”.

## 2. Konstelacja badań (`lab_screen.dart`)

### Model układu
Nowy plik `client/lib/lab_layout.dart` (czysta prezentacja, bez liczb gry):
```dart
const labMapSize = Size(390, 480);       // przestrzeń projektowa
const labCenter = Offset(195, 200);      // węzeł Laboratorium
const Map<String, Offset> techPos = { ... };  // id badania -> pozycja
const Map<String, Color> branchColor = {'geologia': amber, 'inzynieria': teal, 'rdzeniowcy': violet};
```
- Pozycje z makiety (Main.dc.html, tablica `T`): geologia_1 (113,152), geologia_2 (95,89), geologia_3 (61,51), sejsmika (47,174); hydraulika_1 (259,123), hydraulika_2 (298,77), ekonomika_prac_1 (282,150), ekonomika_prac_2 (334,120), metalurgia (293,183), precyzja (353,172); obserwacja_rdzeniowcow (195,290), rezonans_skal (255,350), anatomia_rdzeniowcow (175,365), jezyk_wibracji_1 (100,355), jezyk_wibracji_2 (178,440), jezyk_wibracji_3 (100,450), wiertla_rdzeniowe (350,300), izolacja_rdzenia (320,425).
- Pozycje są ręczne (układ radialny dawał krawędzie przechodzące przez węzły). Badanie bez wpisu w `techPos` (nowe z configu): fallback na pierścieniu wokół gałęzi, bez wyjątku i bez crasha; test to pilnuje.
- Krawędzie wynikają z `requires` z odpowiedzi API. Badania bez `requires` łączą się z `labCenter`. Krawędź między gałęziami: linia przerywana.
- Stan węzła liczy się z odpowiedzi serwera (ukończone / w toku / dostępne / zablokowane), nie z kopii reguł w kliencie. Jeśli API nie podaje wprost „dostępne”, wylicz z `requires`, poziomu Lab i Radiostacji, tak jak w `lab_screen.dart` dziś.

### Rysowanie
- `InteractiveViewer` (min 0.8, max 2.5, `constrained: false`, brzegi ograniczone do mapy), w środku `SizedBox(labMapSize)` ze `Stack`:
  - warstwa 1: `CustomPaint` (`ConstellationPainter`): tło (gwiazdy z ziarna stałego, pierścienie, poświata gałęzi) i krawędzie;
  - warstwa 2: węzły jako osobne widgety `Positioned` (przycisk 44x44 dp, `Semantics`, fokus), nie hit-test na canvasie. Dzięki temu dostępność i fokus działają bez dodatkowej pracy.
- `ConstellationPainter` dostaje jeden niezmienny `ConstellationScene` (pozycje, stany krawędzi), `shouldRepaint` = porównanie wartości. Animacja pulsu aktywnego węzła przez osobny `AnimationController` jako `repaint`, nie przez `setState`. Zero alokacji w `paint()` poza koniecznymi (Paint trzymaj w polach).
- Krawędź: ukończona obie strony = pełna, gruba; zaczęta = średnia; reszta = blada. Kolor wg gałęzi.

### Stany węzła (nie tylko kolorem)
| Stan | Wygląd | Dodatkowy sygnał |
|---|---|---|
| ukończone | wypełniony kolorem gałęzi | ✓ w środku |
| w toku | podwójny pierścień, puls | „…” + licznik w pasku nad mapą |
| dostępne | pierścień + poświata | numer wymaganego poziomu Lab |
| zablokowane | pierścień przerywany, przygaszony | numer wymaganego poziomu Lab |

- `MediaQuery.disableAnimationsOf(context)` = brak pulsu (stan nadal czytelny z podwójnego pierścienia).
- Etykiety gałęzi (GÓRNICTWO / INŻYNIERIA / RDZENIOWCY) w mapie. Podpis zaznaczonego węzła nad nim.
- Kontrast tekstu 4.5:1, ikony/pierścienie 3:1 na tle `#0A0C12`.
- `Semantics` węzła: „{nazwa}, {stan}”, `button: true`, `selected` dla zaznaczonego.

### Panel szczegółów (dolny, stały)
Nazwa, gałąź, znacznik stanu (tekst + symbol), opis efektu (`effectText` z `strings.dart`), „Odblokowuje: …”, wymagania z ✓/○, chipy kosztów (ruda, żetony, próbki, materiały, czas, poziom Lab/Radio; brakujące wymagania z obramowaniem i tekstem „Wymaga”), przycisk zależny od stanu: „Rozpocznij badanie” / „W toku, jeszcze h:mm:ss” (nieaktywny) / „Laboratorium zajęte” / „Ukończone” / „Najpierw spełnij wymagania”. Akcja startu idzie przez istniejące `act()` i `Idempotency-Key`. Błędy z serwera jak dotąd przez `errorText`.

## 3. Silos: przekrój (`silo_screen.dart`)
- Układ (390 dp szerokości): pasek zasobów u góry; pas powierzchni (Szyb główny większy w środku, Wartownia i Radiostacja po bokach w skali 0.75); linia gruntu; pod ziemią 4 pomieszczenia (Generator, Magazyn, Warsztat, Laboratorium) jako karty z grafiką po lewej, po prawej nazwa, „poz. n z max”, przycisk „Ulepsz · koszt” albo (gdy trwa ulepszanie) „Ulepszanie do poz. n · odliczanie” i pasek postępu; szyb windy po lewej jako dekoracja.
- Całość w `CustomScrollView`/`ListView`, nie na sztywnych wysokościach (małe ekrany, duża czcionka systemowa muszą się przewijać, nie ucinać). Karta pomieszczenia: min. wysokość, a nie stała.
- Dane: dokładnie te z `/silo`, które ekran już czyta. Koszt, czas i limity z API, bez kopii w kliencie.
- Dotknięcie karty = jak dziś (szczegóły/ulepszenie); nic nowego w logice.
- Dolna nawigacja zostaje `NavigationBar` z `shell.dart` (makieta ją tylko ilustruje).

**Zmiana 2026-11-11 (decyzja Damiana):** zamiast przekroju z budynkami na powierzchni i pomieszczeniami pod ziemią wszystkie 7 budynków to jednakowe karty w siatce 2 kolumn (grafika u góry, nazwa, poziom, przycisk/postęp). Przekrój zostaje tłem: niebo z horyzontem, linia gruntu, podziemie. Kabina windy w szybie po lewej jedzie razem z przewijaniem (wskaźnik pozycji na ekranie).

## 4. Grafiki budynków
- Siedem budynków x trzy warianty (`BuildingArt(type, level)`; wariant z progów: poz. 1–3 = 1, 4–7 = 2, 8+ = 3). Progi jako stała w `building_art.dart`, bo to prezentacja, a nie balans.
- Implementacja: **`CustomPainter` z wektorów** (bez plików obrazów), jedna klasa `BuildingPainter` z `switch (type)` po `sealed`/enum i warstwami `tier >= 2`, `tier >= 3`. Współrzędne przepisz 1:1 z `Building.dc.html` (viewBox 160x120, skalowanie `canvas.scale`). To tanie w APK i skalowalne; alternatywa `flutter_svg` + 21 plików SVG jest dopuszczalna, jeśli painter okaże się zbyt żmudny.
- Paleta w `theme` (jedno miejsce): tło `#0A0C12`, skała `#1A1F2B`, stal `#3A4558`/`#55637A`, miedź `#C8794A`/`#8E4F2E`, bursztyn `#F0B45A`, turkus `#62C9C0`, fiolet `#B79CFF`, tekst `#E8E3D6`.
- Grafika jest dekoracją: `ExcludeSemantics`; informację (nazwa, poziom) niesie tekst obok.
- Bez animacji w v1.0 (opcjonalnie później: dym generatora, światło wartowni, z poszanowaniem `disableAnimations`).

## 5. Motyw i czcionki
- Space Grotesk (nagłówki) i Inter (treść) dołącz jako **zasoby w paczce** (`assets/fonts`, licencja OFL), bez `google_fonts` w runtime.
- Ciemny motyw jako domyślny dla tych ekranów; reszta ekranów może zostać na obecnym Material 3, ujednolicenie w osobnym kroku.

## 6. Testy
- `lab_layout_test.dart`: każde badanie z fikstury configu ma pozycję lub dostaje poprawny fallback; żadna krawędź nie przechodzi przez środek obcego węzła (odległość punkt-odcinek > promień węzła + 4 dp) dla pozycji z `techPos`.
- Widget: stan węzła → `Semantics` (label zawiera stan), przycisk panelu w każdym z 4 stanów, `disableAnimations` wyłącza puls.
- Golden (opcjonalnie): Lab i Silos w 390x844 oraz 320x640 i skali tekstu 1.5; goldeny weryfikowane, nie aktualizowane w CI.
- `flutter analyze` bez nowych ostrzeżeń; ręczny przegląd na emulatorze i przynajmniej jednym tanim telefonie (płynność przybliżania mapy).

## 7. Kolejność prac
1. `building_art.dart` + ekran próbny z siatką 7x3 (porównaj z arkuszem Budynki).
2. Przekrój Silosu na tych grafikach.
3. `lab_layout.dart` + `ConstellationPainter` + węzły + panel.
4. Testy, przegląd na urządzeniu, poprawki.
Commity krótkie, po polsku, jeden na krok.

---

# Prompt dla Claude Code

Przeczytaj `CLAUDE.md` i `docs/warstwa-wizualna-v1.0.md` (skopiuj tam ten plik). Zaimplementuj warstwę wizualną klienta wg sekcji 2–7, w kolejności z sekcji 7. Zasady:
- Tylko `client/`. Serwera i `config/game.yaml` nie ruszaj; żadnych nowych liczb gry w kodzie (układ i progi wyglądu to prezentacja, trzymaj w `lab_layout.dart` i `building_art.dart`).
- Logika ekranów (API, `act()`, `Idempotency-Key`, `errorText`) bez zmian; zmieniasz tylko widok.
- Porównaj `techPos` z faktycznymi id badań z `GET /research` (lub odpowiednika w `api.dart`) i zgłoś rozbieżności zamiast zgadywać.
- Stany węzłów muszą mieć sygnał inny niż kolor; uszanuj `disableAnimations`.
- Po każdym kroku: `flutter analyze` i `flutter test`; krótki commit po polsku.
- Na końcu podaj mi listę: co działa, co sprawdziłeś na emulatorze, czego nie dało się sprawdzić.

## 8. Rozszerzenie (2026-11-11): Zjazdy, Warsztat i ekrany z „Więcej”
- Zjazdy i Warsztat według makiet `Zjazdy.dc.html` i `Warsztat.dc.html` (zaakceptowane przez Damiana).
- „Więcej” (decyzja: od razu kod, bez makiet): menu jako kafelki 2 kolumny z żywym szczegółem (poziom i wolne punkty, stan Radia, dzień sezonu, złoże); Postać, Radio (radar sygnałów: kierunek z sektora, odległość względem zasięgu, namierzone = pełny punkt, nieznane = pusty krąg), Najazdy (siła przeciwnika znakiem ▼ ≈ ▲ i słowem), Ranking, Rynek (4 zakładki), Zlecenia, Sezon, Geologia (miernik 3/2/1 + słowo).
- Wspólne klocki w `client/lib/ui.dart` (`LsCard`, `LsChip`, `LsButton`, `LsHeader`, `LsMeter`, `LsStat`, `LsActionRow`); `SectionTitle`, `InfoBanner`, `EmptyNote`, `SubScreen` w nowym stylu, więc każdy podekran ma ciemny motyw.
- Zasada układu: wysokości minimalne, nie stałe; wiersz „opis + przycisk” (`LsActionRow`) przy szerokości < 300 dp albo skali tekstu > 1,3 przenosi przycisk pod opis.
- Testy: każdy ekran przy 411x860 i 320x640 ze skalą tekstu 1,5 (brak przepełnień i uciętych przycisków, przewinięcie do końca), akcje idą tymi samymi trasami API.
