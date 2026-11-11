# Konto Google v1.0: powiązanie konta gościa z Google Sign-In

Cel: gracz nie traci konta (ani opłaconej subskrypcji) po odinstalowaniu aplikacji lub zmianie telefonu. Warunek wstępny płatności z `subskrypcja-v1.0.md` §0.1 i §7.1. Decyzja Damiana: **Google Sign-In** (2026-11-11).

Zasady bez zmian: gra działa bez logowania (gość), Google jest opcjonalny. Serwer jest autorytatywny. Nie przechowujemy e-maila ani imienia, tylko stały identyfikator Google (`sub`).

## 0. Ustalenia z dokumentacji (sprawdzone 2026-11-11)
- **Android:** Sign in with Google idzie przez Credential Manager (`GetGoogleIdOption`, `GetSignInWithGoogleOption`). Wynikiem jest token ID Google (JWT), który wysyłamy na serwer. Potrzebny jest identyfikator klienta OAuth typu **Web** jako `serverClientId`. Opcjonalnie można podać `nonce`, który serwer potem porównuje.
- **Flutter:** `google_sign_in` 7.x (7.2.0) działa na Credential Manager. API v7: `GoogleSignIn.instance.initialize(serverClientId: ...)`, `authenticate()`, `attemptLightweightAuthentication()`, `authenticationEvents`. Na Androidzie `serverClientId` jest wymagany, chyba że `google-services.json` zawiera klienta Web. **Do sprawdzenia przed kodem klienta:** czy v7 przyjmuje `nonce` i skąd dokładnie bierze się token ID (`account.authentication.idToken`). Jeśli `nonce` nie da się podać, patrz §3.3.
- **Weryfikacja na serwerze:** podpis kluczami Google, `aud` równe naszemu klientowi Web, `iss` równe `accounts.google.com` albo `https://accounts.google.com`, `exp` w przyszłości. **Identyfikatorem jest wyłącznie `sub`**, unikalny i nigdy nie używany ponownie. E-mail nie może służyć za identyfikator, bo konto Google może zmieniać adresy.
- **Polityka Google Play:** jeśli aplikacja pozwala założyć konto, musi dać **usunięcie konta w aplikacji oraz przez stronę WWW** (link podany w Play Console). Dotyczy to również sytuacji, gdy część funkcji działa bez konta. Usuwamy też powiązane dane; wyjątki (bezpieczeństwo, oszustwa, prawo) trzeba opisać w polityce prywatności. W formularzu Data safety trzeba odpowiedzieć na pytania o usuwanie danych. **Wniosek:** usuwanie konta jest częścią tego zadania, a nie dodatkiem (patrz §2.5).

## 1. Model danych (migracja 015)
- `users.google_sub` już istnieje (`text UNIQUE`, dziś zawsze `NULL`). Dodajemy `users.google_linked_at timestamptz`.
- Nowa tabela `user_devices`: `id bigserial`, `user_id uuid FK ON DELETE CASCADE`, `secret_hash text NOT NULL`, `created_at`, `last_seen_at`. Jedno konto może mieć kilka urządzeń, każde z własnym sekretem gościa.
  - Powód: dziś konto ma jeden `users.guest_secret_hash`. Logowanie Google na nowym telefonie musiałoby go podmienić, a stary telefon dostałby `invalid_credentials`. Klient (od `c0ab602`) w takiej sytuacji zakłada **nowe** konto gościa, więc stary telefon po cichu straciłby postęp.
  - Migracja przenosi każdy istniejący `guest_secret_hash` do `user_devices`. Kolumna w `users` zostaje (wymóg „nie edytuj starych migracji”), ale nowy kod czyta tylko `user_devices`.
- Nie zapisujemy e-maila, imienia ani zdjęcia z tokenu.

## 2. Przepływy i API
### 2.1 Powiązanie (zalogowany gość → Google)
`POST /account/google/link` `{idToken, nonce?}` + `Idempotency-Key`, z JWT gościa.
- Serwer weryfikuje token (§3) i zapisuje `google_sub`.
- `409 account_already_linked`: to konto ma już inne konto Google.
- `409 google_in_use`: ten Google jest już na innym koncie. Klient proponuje „Przełącz się na tamto konto” (§2.3).
- Ponowienie z tym samym `sub` na tym samym koncie: sukces bez zmian.

### 2.2 Logowanie na nowym urządzeniu / po reinstalacji
`POST /auth/google` `{idToken, nonce?}`, bez JWT.
- Gdy `sub` jest powiązany, zwraca `{userId, token, deviceSecret}`. `deviceSecret` to nowy wiersz w `user_devices`; od tej chwili to urządzenie loguje się jak gość (`/auth/guest`) bez ponownego pytania Google. Pozostałe urządzenia działają dalej.
- Gdy `sub` nie jest powiązany, zwraca `404 no_linked_account`. Klient gra dalej jako gość i może zaproponować §2.1.
- Ta trasa **nie zakłada** nowego konta z samego Google. Konto powstaje zawsze jako gość, a Google jest tylko dowiązywany, więc ścieżka tworzenia konta jest jedna.

### 2.3 Przełączenie, gdy urządzenie ma już własnego gościa
Np. ktoś zainstalował grę, pograł chwilę, a potem loguje się na swoje stare konto.
- Klient pokazuje ostrzeżenie: postęp obecnego gościa zostanie na tym urządzeniu nieosiągalny.
- Po zgodzie wykonuje §2.2 i zapisuje nowe dane logowania.
- **Bez łączenia kont**: ekonomia jest zamknięta, a scalanie portfeli to furtka do przelewów między kontami.
- Porzucony gość zostaje w bazie; czyszczenie nieaktywnych kont to osobny temat (§9).

### 2.4 Odłączenie Google
Nie w v1. Bez odłączania nie da się „przerzucać” jednego konta Google między kontami gry, a z nim tokenów subskrypcji.

### 2.5 Usuwanie konta (wymóg Google Play)
`DELETE /account` z JWT i ciałem `{confirm: "USUN"}`. Usuwa wiersz `users`; większość tabel ma `ON DELETE CASCADE` (sprawdzone na bazie dev).
- Do decyzji / poprawki przed wdrożeniem:
  - `market_trades.buyer_id` ma `ON DELETE SET NULL`, a serwer traktuje `buyer_id = NULL` jako „bot”. Po usunięciu kupującego jego zakupy sprzedawcy zobaczą jako sprzedaż botom. Propozycja: osobna kolumna `buyer_kind` albo zachowanie anonimowego znacznika „usunięty gracz”.
  - `season_results` kasuje się kaskadowo, więc ranking zamkniętych sezonów traci wiersz. Propozycja: przed usunięciem zanonimizować (`nickname` = „Usunięty gracz”, `user_id` = NULL), co wymaga zmiany FK na `SET NULL`.
  - Dziennik (`ledger_entries`) kasuje się razem z portfelem, więc `npm run audit` nadal daje 0 różnic. `ledger_archive` z poprzednich sezonów nie ma FK: trzeba go czyścić jawnie albo opisać zatrzymanie w polityce prywatności.
- Usunięcie konta **nie anuluje subskrypcji w Google Play**. Klient musi to powiedzieć przed potwierdzeniem i dać link do zarządzania subskrypcjami w Play.
- Strona WWW do usuwania konta (wymóg Play): prosta strona na domenie z Caddyfile z instrukcją i formularzem prośby. Bez logowania przez WWW w v1; prośbę obsługujemy ręcznie po weryfikacji. **Do zrobienia osobno.**

## 3. Weryfikacja tokenu na serwerze
### 3.1 Biblioteka
`google-auth-library` (już w zależnościach od subskrypcji): `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_WEB_CLIENT_ID })`. Sprawdza podpis, `aud` i `exp`. Dodatkowo sprawdzamy `iss` oraz, gdy klient go podał, `nonce`. Za interfejsem `GoogleIdVerifier` z atrapą do testów, tak jak `PlayBillingClient`.

### 3.2 Nonce
`GET /auth/google/nonce` zwraca losowy nonce, zapisany w tabeli `auth_nonces (nonce PK, created_at)` z TTL 10 min. Jest jednorazowy: przy weryfikacji usuwamy wiersz, a nieistniejący oznacza `401 bad_nonce`. Chroni przed podsłuchanym i odtworzonym tokenem.

### 3.3 Gdy klient nie poda nonce
Gdyby `google_sign_in` v7 nie pozwalał przekazać nonce: zostaje `aud` + `exp` (token żyje około 1 h). Ryzyko: ktoś, kto przechwyci token ID gracza, może się nim zalogować do końca jego ważności. Opcje: (a) akceptujemy w v1, (b) własny kanał platformowy do Credential Manager z nonce. **Decyzja po sprawdzeniu API v7.**

### 3.4 Inne
- Tokenu ID nie logujemy (`events_log` zapisuje tylko „account_linked” bez `sub`).
- Limit prób: np. 10 na minutę na IP dla `/auth/google`. Dziś serwer nie ma limitów; to byłby pierwszy.
- Nowe zmienne środowiskowe: `GOOGLE_WEB_CLIENT_ID`. Bez niej trasy Google zwracają `503 google_disabled`, a gra jako gość działa jak dziś.

## 4. Klient (Flutter), osobny krok
- `google_sign_in` ^7.2; `serverClientId` przez `--dart-define=GOOGLE_WEB_CLIENT_ID=...`.
- Więcej → **Konto**: stan („Gość” / „Połączone z Google”), „Połącz z Google”, „Usuń konto” (§2.5).
- Start aplikacji / onboarding: „Mam już konto” → §2.2 / §2.3.
- Zmiana w `api.dart`: dziś przy `invalid_credentials` klient zakłada nowego gościa. Dla konta kiedyś połączonego z Google najpierw `attemptLightweightAuthentication()` → `/auth/google`, a dopiero gdy to nie zadziała, nowy gość z ostrzeżeniem.
- Teksty błędów (`account_already_linked`, `google_in_use`, `no_linked_account`, `bad_nonce`, `google_disabled`) w `strings.dart`.

## 5. Związek z subskrypcją
- Przywrócenie po reinstalacji: §2.2 daje to samo `userId`, więc `obfuscatedAccountId` się zgadza. Zakupy z Play (`queryPurchases` / `restorePurchases` w `in_app_purchase`) przechodzą `/subscription/verify`, bo właściciel tokenu się zgadza. Serwer subskrypcji nie wymaga zmian.
- Przeniesienie subskrypcji na **inne** konto gry: nie w v1 (`token_in_use`). Przy jednym koncie Google na jedno konto gry nie jest potrzebne.

## 6. Konfiguracja Google Cloud (poza kodem)
- Ekran zgody OAuth (nazwa aplikacji, polityka prywatności, zakres tylko `openid`; bez e-maila i profilu, jeśli Credential Manager na to pozwala, do sprawdzenia).
- Klient OAuth **Android**: nazwa pakietu `pl.lastsilo.lastsilo` + SHA-1. Osobno dla klucza debug i dla klucza podpisywania Play App Signing.
- Klient OAuth **Web**: jego identyfikator to `serverClientId` i `GOOGLE_WEB_CLIENT_ID`.

## 7. Kryteria akceptacji
Testy serwera z atrapą weryfikatora:
1. Powiązanie: udane; ponowienie z tym samym kluczem; `account_already_linked`; `google_in_use`.
2. Token: zły `aud`, zły `iss`, wygasły, zły podpis (atrapa odrzuca); nonce zły, użyty drugi raz, przeterminowany.
3. Logowanie na nowym urządzeniu: to samo `userId`, nowy `deviceSecret`; **stare urządzenie nadal loguje się jako gość**; `no_linked_account` dla nieznanego `sub`.
4. Migracja 015: istniejące konta logują się po migracji starym sekretem.
5. Subskrypcja po §2.2: `/subscription/verify` z tokenem zakupu z poprzedniego urządzenia przechodzi; `queueSlots` = 3.
6. Usuwanie konta: znika postać, portfel, subskrypcja i urządzenia; `npm run audit` bez różnic; historia rynku i ranking sezonów zgodnie z decyzją z §2.5.
7. Reset sezonu nie rusza powiązania (`users` nie jest czyszczone).

Test ręczny: logowanie na emulatorze z kontem Google, reinstalacja, przywrócenie postaci.

## 8. Kolejność prac
1. Decyzje Damiana: §2.5 (historia rynku, ranking, archiwum dziennika) i §3.3 (jeśli nonce nie jest dostępny).
2. Serwer: migracja 015, `GoogleIdVerifier` + atrapa, trasy §2.1, §2.2, §2.5, nonce, testy z §7.
3. Konfiguracja Google Cloud (§6).
4. Klient: ekran Konto, „Mam już konto”, zmiana `api.dart`, usuwanie konta.
5. Strona WWW do usuwania konta i wpis w Play Console (Data safety).
6. Dopiero potem klient subskrypcji (`subskrypcja-v1.0.md` §7.4).

## 9. Poza zakresem v1
Odłączanie Google, logowanie e-mailem, scalanie kont, czyszczenie porzuconych gości, logowanie przez WWW.

## 10. Stan wdrożenia serwera (2026-11-11)
Zrobione (krok 2 z §8): migracja `015_google_account.sql`, `src/google-id.ts` (`GoogleIdVerifier`, `GoogleOAuthIdVerifier`, atrapa `FakeGoogleIdVerifier`), `src/services/account.ts`, trasy `GET /auth/google/nonce`, `POST /auth/google`, `GET /account`, `POST /account/google/link`, `DELETE /account`, testy `test/account.test.ts` (16, w tym migracja konta sprzed 015). Klient i Google Cloud: nie ruszane.

Decyzje z §2.5 (2026-11-11): (1) historia rynku: kolumna `market_trades.bot_trade`, transakcje usuniętego kupującego zostają „gracz” i nie liczą się do limitu skupu botów; (2) ranking sezonów: wiersz zostaje, `nickname` = „Usunięty gracz”, `user_id` = NULL (klucz główny `season_results` zmieniony na `(season_id, rank)`); (3) `ledger_archive` czyszczone przy usuwaniu konta.

§3.3 (nonce): serwer obsługuje oba tryby. Domyślnie token bez nonce jest przyjmowany, a token z nonce musi mieć nasz świeży i nieużyty nonce. `GOOGLE_REQUIRE_NONCE=1` wymusza nonce, gdy klient będzie go wysyłał.

Odpowiedź `POST /auth/google`: `{userId, guestSecret, token}`. Pole `guestSecret` to sekret nowego urządzenia; klient zapisuje go jak przy `/auth/guest` i dalej loguje się bez Google.

Zmienne środowiskowe: `GOOGLE_WEB_CLIENT_ID` (bez niej trasy Google zwracają `503 google_disabled`), `GOOGLE_REQUIRE_NONCE` (`0`/`1`). Limit prób: 10 na minutę na IP (`/auth/google`, nonce) albo na konto (powiązanie), w pamięci procesu.

Znane ograniczenia (świadomie poza v1):
- Usunięcie **sprzedawcy** kasuje jego transakcje (`market_trades.seller_id` ma `ON DELETE CASCADE`), więc kupujący traci ten wpis z „Ostatnich transakcji”. Kupione towary i karawany zostają (`shipments.seller_id` → NULL).
- Najazdy z udziałem usuniętego gracza znikają z historii drugiej strony (kaskada `raids`).
- Strona WWW do usuwania konta, ekran Konto w kliencie i konfiguracja Google Cloud: kroki 3–5 z §8.
