# Strona WWW do usuwania konta i polityka prywatności — projekt

Data: 2026-11-18. Zatwierdzone przez Damiana (wariant C, `CONTACT_EMAIL` jako placeholder).

## Po co
Google Play wymaga, żeby gracz mógł poprosić o usunięcie konta i danych **przez stronę WWW, bez instalowania gry** (link w Play Console, `docs/konto-google-v1.0.md` §1). Sklep i ekran zgody OAuth wymagają też polityki prywatności. Usuwanie w aplikacji już jest (`DELETE /account`).

## Cele
- `/usun-konto`: konto połączone z Google usuwa się od razu po zalogowaniu Google na stronie; gość wysyła prośbę z pseudonimem i kodem konta, obsługiwaną ręcznie skryptem.
- `/prywatnosc`: krótka polityka prywatności po polsku.
- Kod konta widoczny w aplikacji (Więcej → Konto).

## Poza zakresem (v1)
Wysyłanie e-maili, panel administratora, inne funkcje gry przez WWW, logowanie gościa na stronie, wersja angielska.

## Anty-cele
- Strona nie może zdradzać, czy dany pseudonim/kod istnieje (zawsze ta sama odpowiedź na prośbę).
- Nikt nie usunie cudzego konta samym pseudonimem.
- Żadnych danych osobowych ponad to, co gracz sam wpisze (brak e-maila w formularzu).

## Podejścia (rozważone)
- **A. Tylko formularz z kodem konta**: najmniej kodu, ale gracz bez telefonu nie poda kodu.
- **B. Tylko logowanie Google na stronie**: pewna tożsamość, natychmiast, ale nie obejmuje gości.
- **C. B + formularz A dla gości (wybrane)**: przypadek „zgubiłem telefon” mają tylko konta Google (gość bez telefonu i tak nie ma jak wrócić do postaci), a goście z telefonem znają kod.

## Projekt
### Serwer
- `GET /usun-konto` i `GET /prywatnosc`: statyczne HTML z `server/public/` (w obrazie Dockera), z podstawieniem przy starcie: `GOOGLE_WEB_CLIENT_ID` (bez niego sekcja Google jest ukryta) i `CONTACT_EMAIL` (placeholder `kontakt@example.com`, dopóki Damian nie poda adresu). Paleta i czcionki jak w grze (`docs/warstwa-wizualna-v1.0.md`), mobilny układ, bez frameworka. Jedyny zewnętrzny skrypt: Google Identity Services (`https://accounts.google.com/gsi/client`).
- `POST /account/delete-by-google` `{idToken, confirm: "USUN"}`: weryfikacja tokenu jak w `/auth/google` (ten sam `verifiedSub`), konto po `google_sub`, `deleteAccount`. Bez tworzenia urządzenia, bez JWT. Odpowiedź `{deleted, hadActiveSubscription}`; `404 no_linked_account`, `503 google_disabled`, `429 too_many_requests` (limit na IP). Ścieżka pod `/account` omija bramkę sezonu.
- `POST /account/deletion-requests` `{nickname, code, message?}`: walidacja długości (zod), zapis do `deletion_requests`; `user_id` uzupełniony tylko, gdy pseudonim i kod pasują do tego samego konta. Odpowiedź zawsze `202 {received: true}` (bez wyroczni). Limit na IP.
- Migracja `020_deletion_requests.sql`: `id`, `user_id` (NULL, FK `ON DELETE SET NULL`), `nickname`, `code`, `message`, `created_at`, `handled_at`.
- Kod konta: pierwsze 8 znaków `userId` (UUID, hex) wielkimi literami, wyświetlane jako `1A2B-3C4D`; dopasowanie bez myślnika i bez względu na wielkość liter. `GET /account` zwraca gotowe pole `code`.
- Skrypt `npm run deletion-requests`: lista nieobsłużonych próśb (dopasowane i nie); `-- --delete <id>` usuwa dopasowane konto (`deleteAccount`) i ustawia `handled_at`; `-- --reject <id>` tylko oznacza jako obsłużone.

### Klient
- Więcej → Konto: linijka „Kod konta: 1A2B-3C4D” z wyjaśnieniem „Podaj go na stronie usuwania konta, jeśli nie możesz usunąć konta w grze.” Najpierw dopisek w makiecie Konto.

### Strona `/usun-konto` (makieta przed kodem)
1. Nagłówek, co zostanie usunięte i co zostaje (ranking jako „Usunięty gracz”), uwaga o subskrypcji w Google Play (link do zarządzania).
2. „Masz grę na telefonie? Najszybciej: Więcej → Konto → Usuń konto.”
3. Sekcja Google: przycisk GIS → potwierdzenie słowem USUŃ → wynik (usunięto; ostrzeżenie o subskrypcji, jeśli była) albo „To konto Google nie jest połączone z żadną postacią”.
4. Sekcja gościa: pseudonim, kod konta, wiadomość (opcjonalna) → „Przyjęliśmy prośbę. Usuniemy konto w ciągu 30 dni, jeśli dane się zgadzają.”
5. Stopka: polityka prywatności, kontakt (`CONTACT_EMAIL`).

### Polityka `/prywatnosc`
Administrator i kontakt (placeholder), jakie dane: identyfikator konta, sekret urządzenia (skrót), identyfikator Google (`sub`, bez e-maila w bazie), pseudonim i dane gry, dane subskrypcji z Google Play, logi serwera; cel; brak sprzedaży i reklam; okres przechowywania; usuwanie (link do `/usun-konto`); data aktualizacji.

### Konfiguracja (Damian)
Klient OAuth Web: „Autoryzowane źródła JavaScriptu” = domena produkcyjna i `http://localhost:3000` (test lokalny). Data safety w Play Console później.

## Testy
Serwer (vitest, atrapa weryfikatora): usunięcie przez Google (i drugi raz → 404), zły token, brak potwierdzenia, prośba dopasowana / niedopasowana z identyczną odpowiedzią, limit, strony HTML zwracają 200 z podstawionymi wartościami i bez sekcji Google bez `GOOGLE_WEB_CLIENT_ID`, skrypt na bazie testowej. Klient: kod konta na ekranie Konto. Ręcznie: strona w przeglądarce lokalnie z logowaniem Google.

## Zostawione budującemu
Dokładne teksty strony i polityki (po polsku, zwięźle), styl HTML w granicach palety, nazwy plików w `server/public/`.
