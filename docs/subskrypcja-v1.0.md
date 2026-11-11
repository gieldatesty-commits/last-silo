# Subskrypcja „Wygoda” v1.0: specyfikacja

Cel: dochód z gry bez sprzedawania siły. Zasady z `CLAUDE.md`: ekonomia zamknięta, subskrypcja daje **wygodę, nie przewagę**.

## 0. Warunki wstępne (do rozstrzygnięcia przed kodem)
1. **Konto gościa to za mało dla płatności.** Dziś konto = `userId` + `guestSecret` w pamięci telefonu. Po odinstalowaniu albo zmianie telefonu gracz traci konto, a z nim opłaconą subskrypcję. Przed włączeniem płatności potrzebne jest powiązanie konta (Google Sign-In albo e-mail + link) i odzyskiwanie. **Rekomendacja: najpierw powiązanie konta, potem płatności.** Bez tego pierwsze negatywne opinie będą o „straciłem konto i pieniądze”.
2. **Konto dewelopera Google Play** (jednorazowa opłata rejestracyjna) i aplikacja w ścieżce testów wewnętrznych. Zakupy w Play Billing da się testować dopiero na zainstalowanej z Play wersji, z kontami testerów licencji. Aktualne wymagania i opłaty sprawdź w dokumentacji Play Console.
3. **Cena i okresy** (miesięczny, ewentualnie roczny) ustawiasz w Play Console. W specyfikacji są tylko identyfikatory produktów w configu.
4. Cyfrowe dobra w aplikacji z Google Play muszą iść przez Google Play Billing; nie robimy własnej bramki płatności w aplikacji.

## 1. Co daje subskrypcja (tylko wygoda)
| Korzyść | Stan | Uwaga |
|---|---|---|
| +1 slot kolejki zjazdów (2 → 3), **tylko dla tras ≤ 30 min** | config 1.5.0 (`dives.queue_slots.subscriber_extra_max_seconds: 1800`) | wariant 3 z §10.3, wynik w §10.4 |
| +1 slot kolejki budowy | propozycja | dziś `upgrades.queue_slots`; sprawdzić symulacją |
| Panel statystyk: wykresy dochodu, historia zjazdów, bilans rynku | propozycja | tylko odczyt danych z dziennika |
| Odznaka przy nicku w rankingu | propozycja | kosmetyka, zero wpływu |
| Szybkie „powtórz zjazd” jednym stuknięciem | opcjonalnie | tylko skrót UI, nie automat; automatyczne powtarzanie odrzucone (zmienia dochód) |

Nie wchodzi do subskrypcji: żadnych bonusów do rudy, szansy, siły, produkcji, czasu, ochrony przed najazdami, limitów rynku. **Powiadomienia push są darmowe dla wszystkich** (to retencja i uczciwość, nie luksus).

## 2. Model danych (migracja 014)
Tabela `subscriptions`:
- `id` bigserial, `user_id` uuid FK, `provider` text (`google_play`),
- `purchase_token` text **UNIQUE**, `product_id` text,
- `state` text (`active` | `grace` | `on_hold` | `canceled_active` | `expired` | `revoked`),
- `started_at`, `expires_at` timestamptz, `auto_renewing` bool,
- `linked_purchase_token` text null (zmiana planu/ponowna subskrypcja),
- `last_synced_at` timestamptz, `raw` jsonb (ostatnia odpowiedź Google, do audytu).

`players.subscription_until` zostaje jako **pochodny cache** = `max(expires_at)` aktywnych/„grace” wpisów gracza. Jedyne miejsce, które go zapisuje, to funkcja `recomputeSubscription(userId)`; reszta kodu (`queueSlots`) czyta tak jak dziś. Subskrypcja **przeżywa reset sezonu** (już tak jest w `season.ts`).

## 3. Serwer: API i przepływ
- `POST /subscription/verify` `{productId, purchaseToken}` + `Idempotency-Key`: pobiera stan zakupu z Google Play Developer API (dla subskrypcji: endpoint `purchases.subscriptionsv2.get`), sprawdza `productId` z configu, stan, czas wygaśnięcia i **powiązanie z kontem** (§4), zapisuje/odświeża wiersz, woła `recomputeSubscription`, zwraca `GET /subscription`. Potwierdzenie zakupu (`acknowledge`) po udanej weryfikacji, inaczej Google zwraca pieniądze po kilku dniach.
- `GET /subscription`: `{active, state, expiresAt, autoRenewing, perks[]}`.
- `POST /billing/rtdn`: odbiornik powiadomień Google (Pub/Sub push). Żądanie weryfikujemy tokenem OIDC Google (audience z configu). **Treści powiadomienia nie ufamy**: służy tylko jako sygnał, a prawdziwy stan zawsze pobieramy z API Google dla danego tokenu. Dzięki temu kolejność i duplikaty zdarzeń nie szkodzą.
- Zadanie pg-boss `subscription-sync` (co godzinę): odświeża subskrypcje wygasające w ciągu 24 h i `grace/on_hold`, jako siatka bezpieczeństwa, gdy RTDN zawiedzie.
- Stany: `active` i `grace` dają korzyści; `on_hold`, `expired`, `revoked` nie. Zwrot/cofnięcie zakupu (`revoked`) odbiera korzyści od razu, ale **nie cofa** rudy już zarobionej.
- Wszystko za konfigurowalnym interfejsem `PlayBillingClient` (prawdziwy klient Google + atrapa do testów), tak jak inne usługi zewnętrzne.

## 4. Bezpieczeństwo i nadużycia
- Przy zakupie klient podaje identyfikator konta (zaciemniony, np. HMAC z `userId`, **nie** surowy `userId`) jako `obfuscatedExternalAccountId`. Serwer przy weryfikacji sprawdza zgodność. Dzięki temu cudzy token nie zadziała na innym koncie.
- `purchase_token` jest UNIQUE: ten sam zakup nie zasili dwóch kont. Przeniesienie na nowe konto tylko przez jawny, zalogowany „restore” (po powiązaniu konta).
- Klucz serwisowy Google (JSON) tylko w zmiennej środowiskowej/sekrecie, nigdy w repo ani w kliencie.
- Żadnej logiki „subskrybent?” w kliencie poza wyświetlaniem; serwer sam liczy sloty.

## 5. Klient (Flutter)
- Pakiet `in_app_purchase` (oficjalny). Ekran „Wygoda” (zakładka w Więcej): lista korzyści, cena z Play (`ProductDetails.price`, nie wpisana na sztywno), przycisk kupna, stan („do 12.03, odnawia się”), link do zarządzania subskrypcją w Play, „Przywróć zakupy”.
- Przepływ: kupno → `purchaseStream` → `POST /subscription/verify` → dopiero po sukcesie `completePurchase`. Po restarcie aplikacji przetwórz zaległe zakupy ze strumienia.
- Teksty błędów w `strings.dart`; odznaka w rankingu z pola `badge` w odpowiedzi serwera.

## 6. Kryteria akceptacji (to jest „zrobione”)
1. **Uczciwość ekonomiczna**: `npm run -s sim:world -- 180 --sub=0` vs `--sub=1` (kilka ziaren): przewaga dochodu subskrybenta ≤ **10%** i zjazdy nadal główne źródło dochodu. Gdy większa, zmniejszamy korzyść (np. slot kolejki dostaje dłuższy czas odnowienia) albo ją wycinamy. Wynik w dokumencie.
2. Testy serwera z atrapą Google: weryfikacja udana; zły `productId`; cudze konto (zła obfuskacja); ponowne użycie tokenu przez innego gracza; ponowienie z tym samym `Idempotency-Key`; odnowienie (wydłużenie `expires_at`); anulowanie z dostępem do końca okresu; `grace` i `on_hold`; `revoked`; zdarzenia RTDN w złej kolejności i zduplikowane; wygaśnięcie (`queueSlots` wraca do 2); reset sezonu nie kasuje subskrypcji; `npm run audit` bez różnic.
3. Test ręczny na koncie testera licencji: kupno, odnowienie (przyspieszone odnowienia testowe w Play), anulowanie, przywrócenie po reinstalacji (po powiązaniu konta).

## 7. Kolejność prac
1. Powiązanie konta: **Google Sign-In** (decyzja 2026-11-11), specyfikacja `docs/konto-google-v1.0.md`.
2. Migracja 014, `PlayBillingClient` + atrapa, `recomputeSubscription`, `/subscription*`, testy, symulacja `--sub`.
3. RTDN + zadanie `subscription-sync`.
4. Klient: ekran „Wygoda”, kupno, restore.
5. Konfiguracja Play Console + testy z kontem testera licencji.
6. Dopiero potem publiczne włączenie płatności.

## 8. Czego nie wiem / do sprawdzenia w dokumentacji Google
Dokładne nazwy pól odpowiedzi `subscriptionsv2`, lista typów powiadomień RTDN, wymagania polityki Play dla subskrypcji (okres próbny, ujawnienie cen) oraz podatki/prowizje dla Twojej działalności. Claude Code ma to sprawdzić w aktualnej dokumentacji, zanim zacznie pisać klienta Google.

## 9. Stan wdrożenia serwera (2026-11-11, kroki 2 i 3 z §7)
Zrobione: migracja `014_subscriptions.sql`, `src/billing.ts` (`PlayBillingClient`, `GooglePlayBillingClient`, atrapa `FakePlayBilling`), `src/services/subscription.ts` (`recomputeSubscription`, weryfikacja, synchronizacja), trasy `GET /subscription`, `POST /subscription/verify`, `POST /billing/rtdn`, zadanie pg-boss `subscription-sync` (co godzinę, minuta 17), testy `test/subscription.test.ts` (22). Klient Flutter i Play Console: nie ruszane.

Konfiguracja: sekcja `subscription` w `config/game.yaml` (config 1.4.1: dodane identyfikatory produktów, **balans bez zmian**). Zmienne środowiskowe: `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT_JSON` (zawartość klucza), `RTDN_AUDIENCE`, `RTDN_SERVICE_ACCOUNT_EMAIL`, `BILLING_ACCOUNT_KEY` (HMAC dla `obfuscatedAccountId`). Bez kompletu płatności są wyłączone (`503 billing_disabled`), a część zmiennych bez reszty to błąd startu.

Ustalenia z dokumentacji Google (`purchases.subscriptionsv2`, RTDN, Pub/Sub push):
- Stan bierzemy z `subscriptionState`, termin z `lineItems[].expiryTime` (w grace Google go wydłuża, przy on hold ustawia w przeszłości), auto-odnowienie z `lineItems[].autoRenewingPlan.autoRenewEnabled`, konto z `externalAccountIdentifiers.obfuscatedExternalAccountId`. W v2 nie ma `subscriptionId`; zastępuje go `lineItems[].productId`.
- v2 nie ma własnego `acknowledge`: używamy `purchases.subscriptions.acknowledge` (v1).
- RTDN: `message.data` (base64) → `subscriptionNotification {notificationType, purchaseToken}` lub `voidedPurchaseNotification`. Uwierzytelnienie: JWT OIDC w `Authorization: Bearer`, sprawdzamy podpis, `aud`, `email`, `email_verified`.

Odstępstwa od §2–§3 (do akceptacji):
- Dodatkowy stan `pending` (Google: `SUBSCRIPTION_STATE_PENDING`, np. płatność odroczona); bez korzyści.
- `SUBSCRIPTION_STATE_PAUSED` mapowany na `on_hold` (bez korzyści); `CANCELED` na `canceled_active`, dopóki trwa opłacony okres.
- `revoked`: Google nie ma takiego stanu. Etykietę ustawiamy tylko, gdy powiadomienie (typ 12 albo `voidedPurchaseNotification`) **i** odpowiedź API zgodnie mówią o braku dostępu; sama treść powiadomienia niczego nie odbiera.
- Kolumna `acknowledged`: subscription-sync ponawia potwierdzenie, gdy pierwsze się nie udało (inaczej zwrot po 3 dniach).
- `/subscription/*` i `/billing/*` działają też w przerwie między sezonami.
- Token, którego klient jeszcze nie zgłosił przez `verify`, jest w RTDN ignorowany (nie wiemy, czyje to konto).

Zależności od powiązania konta (§0.1, §7.1), **niezrobione**: przywracanie zakupu po reinstalacji lub na nowym telefonie i jawne przeniesienie tokenu na inne konto. Dziś token jest na stałe przypięty do konta gościa, które go zweryfikowało (`token_in_use` dla innego konta).

## 10. Symulacja `--sub` (2026-11-11, config 1.4.1, 180 dni, 50 graczy, ziarna 1–5)
**Kryterium §6.1 (≤ 10%) nie jest spełnione dla graczy regularnych.** Balansu nie zmieniałem; decyzja w §10.3.

### 10.1 Cały świat: `--sub=0` vs `--sub=1`
| ziarno | dochód śr. sub=0 | dochód śr. sub=1 | różnica | udział zjazdów (hardcore / regularny / okazjonalny), sub=0 → sub=1 |
|---|---|---|---|---|
| 1 | 314 427 | 323 069 | +2,7% | 68/72/50% → 65/77/58% |
| 2 | 314 732 | 321 808 | +2,2% | 69/72/49% → 65/77/60% |
| 3 | 315 555 | 323 888 | +2,6% | 68/72/50% → 64/77/58% |
| 4 | 314 491 | 323 662 | +2,9% | 68/72/49% → 65/77/56% |
| 5 | 315 057 | 323 525 | +2,7% | 68/72/50% → 65/77/58% |

Ta miara zaniża przewagę: gdy wszyscy mają 3 sloty, wspólne pule stref szybciej się wyczerpują i ograniczają każdego. Zjazdy pozostają głównym źródłem dochodu.

### 10.2 Ten sam świat (`--sub=0.5`), subskrybent vs gracz bez subskrypcji w tym samym stylu
| ziarno | hardcore | regularny | okazjonalny |
|---|---|---|---|
| 1 | +2,2% | **+18,7%** | +5,1% |
| 2 | +3,5% | **+19,0%** | +9,0% |
| 3 | +2,3% | **+16,3%** | +3,4% |
| 4 | +3,8% | **+17,9%** | +9,8% |
| 5 | +2,8% | **+19,3%** | +7,3% |

To jest realny scenariusz (część graczy płaci). Regularni grają w odstępach, w których 2 sloty pustoszeją, a trzeci wypełnia przerwę; hardcore są online tak często, że 2 sloty im wystarczają, okazjonalni wybierają długie trasy. Udział zjazdów u subskrybentów rośnie (np. regularni 79% vs 69%), więc ekonomia się nie wywraca, ale przewaga dochodu jest zbyt duża jak na „wygodę”.

### 10.3 Propozycje (do decyzji Damiana)
1. **Usunąć +1 slot zjazdów z subskrypcji** (`queue_slots.subscriber = free`); zostają statystyki, odznaka, „powtórz zjazd”. Przewaga 0%, najprostsze i najuczciwsze.
2. **Dać 3 sloty wszystkim** (`free: 3`), a subskrypcja bez wpływu na dochód. Zmienia balans dla każdego: wymaga nowej symulacji (pule, tempo poziomów).
3. **Trzeci slot tylko na krótkie trasy** (np. ≤ 15 min) albo z czasem odnowienia. Zostaje wygoda dla aktywnych, ale ograniczona; wymaga kodu i symulacji z celem ≤ 10% dla regularnych.

Polecam 1, bo jest zgodna z zasadą „wygoda, nie siła” i nie wymaga strojenia.

### 10.4 Decyzja: wariant 3, trzeci slot tylko na krótkie trasy (2026-11-11, config 1.5.0)
Reguła (`queueCheck` w `src/game/dive.ts`, wspólna dla serwera i symulatora): subskrybent ma 3 miejsca w kolejce, ale najwyżej `queue_slots.free` (2) z nich mogą zajmować trasy dłuższe niż `subscriber_extra_max_seconds`. Trzeci długi zjazd dostaje `409 short_route_only`. Gracze bez subskrypcji: bez zmian (wyniki `--sub=0` identyczne jak w 1.4.1). `/silo` zwraca `queueExtraMaxSeconds`.

Strojenie limitu, `--sub=0.5`, przewaga subskrybenta w tym samym stylu (hardcore / regularny / okazjonalny), ziarna 1–5, 50 graczy:
| limit | zakres przewag | uwagi |
|---|---|---|
| brak (1.4.1) | +2–4% / **+16–19%** / +3–10% | regularni ponad kryterium |
| 180 s (tylko Płytki) | **+9–13%** / +0–4% / −4–+6% | hardcore traci trasy jądra, ale w trzecim slocie korzysta z mniej wyeksploatowanej puli górnej |
| 900 s | **+11–13%** / +2–6% / +1–5% | jw. |
| 1200 s | +3–5% / +2–5% / −5–+7% | w normie |
| **1800 s (wybrane)** | +3–5% / +2–6% / −2–+5% | w normie, wygodniejsze |

Kontrola na 200 graczach (ziarna 1–3): 1800 s → +3,3–4,6% / +2,6–4,1% / +0,5–3,0%; 1200 s → +5,8–6,4% / +1,7–3,2% / +0,5–1,8%. Wybrane 1800 s: mniejsza przewaga hardcore i więcej wygody (Płytki, Średni, Szczeliny, Sztolnia mieszczą się w limicie).

Świat przy configu 1.5.0 (180 dni, 50 graczy):
| ziarno | dochód sub=0 | sub=0,5 | sub=1 | udział zjazdów h/r/o (sub=1) | ruda w magazynie (sub=1) | przewaga h/r/o (sub=0,5) |
|---|---|---|---|---|---|---|
| 1 | 314 427 | 317 470 | 318 441 | 70/72/50% | 28 652 | +3,4 / +3,9 / −1,1% |
| 2 | 314 732 | 318 094 | 319 185 | 70/72/50% | 29 541 | +3,4 / +6,4 / +3,4% |
| 3 | 315 555 | 317 851 | 319 921 | 70/72/50% | 28 668 | +2,6 / +1,7 / +4,7% |
| 4 | 314 491 | 316 595 | 319 114 | 70/72/49% | 30 297 | +5,3 / +4,9 / −1,6% |
| 5 | 315 057 | 317 010 | 318 965 | 70/72/50% | 29 291 | +3,3 / +5,9 / −1,3% |

**Kryterium §6.1 spełnione**: przewaga ≤ 6,4% we wszystkich stylach i ziarnach, zjazdy nadal główne źródło dochodu, ruda nie zalega (ok. 30 tys. na gracza). Szum przy grupach 5–15 graczy to ok. ±3 p.p.

Do zrobienia w kliencie (nieruszany): komunikat PL dla `short_route_only` w `strings.dart` i blokada przycisku „Zjedź” dla długich tras, gdy wolny jest już tylko slot subskrypcji (pole `queueExtraMaxSeconds`).
