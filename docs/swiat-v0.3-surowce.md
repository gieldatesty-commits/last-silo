# Last Silo – surowce, geologia, handel (v0.3)

Zasada nadrzędna (decyzja 19.10): **do Radiostacji poz. 5 różnorodność surowców mocno nie wpływa na grę.** Do tego momentu liczy się wyłącznie ruda (plus żetony i próbki jak dotąd).

## 1. Materiały
Trzy wymienialne materiały: **Miedź, Kryształy, Siarka** (konfig: `resources`, `geology`). Są zwykłymi pozycjami w księdze i portfelu.

- **Skąd:** z udanych i nieudanych (30%) zjazdów na trasach od poziomu 3. Ilość = godziny trasy × `mat_per_hour` (0,5) × mnożnik nagrody trasy × bogactwo regionu. Losowanie ułamka z ziarna zjazdu.
- **Na co:** wyłącznie zawartość „drugiego poziomu” z `radio: 5` – 6 receptur (Wiertło udarowe, Kombinezon pancerny, Lampa rezonansowa, Skaner sejsmiczny, Wiertło rdzeniowe, Kombinezon izolowany) i 7 badań (m.in. Geologia III, Hydraulika II, Język wibracji II/III, Izolacja przed rdzeniem). Sześć receptur i większość badań nadal nie wymaga materiałów.
- Dzięki temu materiały są też **nowym ujściem rudy i pracy** (rozwiązanie problemu z symulacji: zalegająca ruda po ok. 40. dniu).

## 2. Geologia regionów
- Profil silosu wynika z jego **położenia na kuli** (gładkie pola trzech materiałów, stałe dla świata z `field_seed`) – sąsiednie silosy mają podobny profil, więc powstają **regiony**.
- W każdym miejscu: jeden materiał **obfity** (×1,0), jeden **średni** (×0,4), jeden **ślady** (×0,1), z lokalnym szumem ±20% z ziarna silosu.
- Gracz widzi tylko opis jakościowy (`GET /geology`: obfity / średni / ślady), nigdy liczb.
- Konsekwencja: każdy ma nadwyżkę jednego materiału i niedobór pozostałych → naturalny powód do handlu, a dystans i zasięg radia decydują o tym, z kim.

## 3. Handel (stan i plan)
- **Teraz:** Handlarz Przekaźnikowy (NPC), od radia 5, `POST /exchange/buy` – kupno materiału za rudę po stałej cenie (miedź 140, kryształy 160, siarka 150). Ruda ginie. Wyznacza **sufit cen** przyszłego rynku i gwarantuje, że lokalny niedobór nie blokuje gry.
- **M4 (rynek graczy):** wystawienia materiałów w korytarzu cen (dół: boty „podłogi cen”, góra: cena NPC), opłaty jak w specu.
- **Handlarz jako ścieżka:** możliwa od radia 5 – kto nadaje i ma zasięg, kupuje nadwyżki regionu i odsprzedaje tam, gdzie brakuje (marża z regionalnych różnic cen i czasu dojazdu; w przyszłości karawany). Nie wymaga to nowych mechanik zasobów, tylko rynku i karawan; nie tworzy zasobów z niczego.

## 4. Energia geotermalna (plan, nie wdrożone)
- **Przepływ, nie towar:** budynek Geoelektrownia zależy od ukrytego „ciepła” lokalizacji (trzecie gładkie pole, analogiczne do materiałów). Zasila budynki (Laboratorium, Warsztat, Radiostacja) lub zwiększa regenerację pary.
- Brak giełdy energii; handlować można **akumulatorami** (przedmioty z Warsztatu). Sieć przesyłowa dopiero z koleją.
- Ciepło wysokie = blisko Rdzeniowców (więcej „hałasu”) – ryzyko za bogactwo, spójne z lore.

## 5. Wyniki symulacji (50 graczy)
- Radiostację 5 gracze osiągają średnio w dniu ~9 (boty rozbudowują równomiernie; prawdziwi gracze wolniej).
- Z materiałami i bez nich poziom i tempo badań są takie same do dnia 56 (23,1 poz.; 14,1 z 18 badań).
- Pierwszy przedmiot wymagający materiałów: średnio ok. dnia 21.
- Wymiana z NPC: ok. 8% dochodu w dniu 56 (7% w dniu 90); zapasy po 56 dniach: 100–160 sztuk każdego materiału (nadwyżka głównego, braki pozostałych).
- Regiony 50 graczy: obfity kryształ 23, miedź 13, siarka 14.
