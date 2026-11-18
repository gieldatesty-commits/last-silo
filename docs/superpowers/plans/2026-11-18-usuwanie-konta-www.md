# Strona WWW do usuwania konta — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/usun-konto` (Google: usunięcie od razu; gość: prośba z pseudonimem i kodem konta), `/prywatnosc`, kod konta w aplikacji, skrypt obsługi próśb.

**Architecture:** Statyczne strony HTML w `server/public/` serwowane przez Fastify z podstawieniem `{{GOOGLE_WEB_CLIENT_ID}}`/`{{CONTACT_EMAIL}}` przy starcie; dwie nowe trasy pod `/account` (omijają bramkę sezonu) w `src/services/account.ts`; tabela `deletion_requests`; skrypt tsx do ręcznej obsługi.

**Tech Stack:** Fastify 5, Kysely, PostgreSQL 16, zod 4, vitest; Google Identity Services w przeglądarce; Flutter (ekran Konto).

**Spec:** `docs/superpowers/specs/2026-11-18-usuwanie-konta-www-design.md`

## Global Constraints
- Odpowiedzi i teksty po polsku; kody błędów w polu `error`.
- Nowa tabela = migracja `server/migrations/020_deletion_requests.sql`.
- Kod konta = pierwsze 8 znaków `userId` wielkimi literami, wyświetlany `XXXX-XXXX`; dopasowanie bez myślnika, bez względu na wielkość liter.
- Prośba gościa zawsze `202 {received: true}`, niezależnie od dopasowania.
- `CONTACT_EMAIL` domyślnie `kontakt@example.com`.
- Znaczniki czasu z `ctx.now()`.
- Klient: `dart format` 160, `flutter analyze --fatal-infos`, cel dotyku ≥ 44 dp.

## Review Focus
1. Pseudonim z innym kodem (albo kod innego gracza) → prośba zapisana z `user_id = NULL`, ta sama odpowiedź 202 — test w Task 2.
2. Drugie `delete-by-google` po usunięciu → `404 no_linked_account`, nie 500 — test w Task 2.
3. Bez `GOOGLE_WEB_CLIENT_ID` strona nie zawiera skryptu GIS ani sekcji Google, a `delete-by-google` → 503 — test w Task 3.
4. Pseudonim/wiadomość z HTML (`<script>`) nie trafia do strony (strona nie renderuje danych użytkownika; skrypt wypisuje tekst) — test w Task 4 (wyjście skryptu = surowy tekst, strona statyczna).
5. Pole `message` > 1000 znaków albo puste `nickname` → `400 bad_request` — test w Task 2.

---

### Task 1: Makieta strony i linijki „Kod konta”

**Files:**
- Create (artefakt Design, https://claude.ai/artifact/4uLiaBVPYtTnnFZRjrturM): `UsunKontoWWW.dc.html` (390×844, stan: sekcja Google + formularz gościa + wynik), dopisek w `Konto.dc.html` (linijka kodu konta).

- [ ] **Step 1:** Przeczytać artefakt (`Artifact read`), dodać plansze w rzędzie z `Konto`/`KontoStart`, opublikować.
- [ ] **Step 2:** Pokazać Damianowi; dalej dopiero po akceptacji.

### Task 2: Serwer — migracja, kod konta, trasy

**Files:**
- Create: `server/migrations/020_deletion_requests.sql`
- Modify: `server/src/db.ts` (typ tabeli `deletion_requests`), `server/src/services/account.ts`, `server/src/app.ts`
- Test: `server/test/account-web.test.ts`

**Interfaces:**
- Produces: `accountCode(userId: string): string` (np. `'1A2B-3C4D'`); `deleteByGoogle(ctx: Ctx, google: GoogleAuth, idToken: string): Promise<{ deleted: true; hadActiveSubscription: boolean }>`; `requestDeletion(ctx: Ctx, input: { nickname: string; code: string; message: string | null }): Promise<void>`; `GET /account` zwraca dodatkowo `code`.
- Tabela: `id uuid PK default gen_random_uuid()`, `user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL`, `nickname text NOT NULL`, `code text NOT NULL`, `message text NULL`, `created_at timestamptz NOT NULL`, `handled_at timestamptz NULL`.

- [ ] **Step 1: Testy (RED)** w `account-web.test.ts` (wzorzec setupu jak `account.test.ts`, `FakeGoogleIdVerifier`, `authRateLimitPerMinute: 1000` i osobna instancja z limitem 2):
  - `accountCode('1a2b3c4d-...')` → `'1A2B-3C4D'`; `GET /account` zawiera `code`.
  - `delete-by-google`: konto połączone → 200 `{deleted: true, hadActiveSubscription: false}`, wiersz `users` znika; drugi raz → 404 `no_linked_account`; bez `confirm: 'USUN'` → 400; zły token → 401 `bad_google_token`; limit 2/min → trzecie 429.
  - `deletion-requests`: pseudonim + kod (z myślnikiem, małymi literami) pasują → 202, wiersz z `user_id`; pseudonim z kodem innego gracza → 202, `user_id` NULL; odpowiedzi identyczne (`toEqual`); `nickname: ''` → 400; `message` 1001 znaków → 400; limit → 429.
- [ ] **Step 2:** `npx vitest run test/account-web.test.ts` → FAIL.
- [ ] **Step 3:** Migracja + typ w `db.ts`; funkcje w `account.ts` (`deleteByGoogle` = `verifiedSub` w transakcji, użytkownik po `google_sub`, potem `deleteAccount`; `requestDeletion` dopasowuje `players.nickname` i `left(users.id::text, 8) = lower(code bez myślnika)`); trasy w `app.ts`: `POST /account/delete-by-google` (503 bez `google`, limiter `del:${ip}`), `POST /account/deletion-requests` (zod: `nickname` 1–40, `code` 8–9 znaków, `message` ≤ 1000 opcjonalne; limiter `req:${ip}`; `reply.code(202)`).
- [ ] **Step 4:** `npm run typecheck && npx vitest run` → wszystko PASS; `npm run audit` (baza dev) → 0 różnic.
- [ ] **Step 5:** Commit „Konto: usuwanie przez Google ze strony WWW, prośby o usunięcie, kod konta”.

### Task 3: Strony HTML

**Files:**
- Create: `server/public/usun-konto.html`, `server/public/prywatnosc.html`
- Modify: `server/src/app.ts` (deps `googleWebClientId?: string`, `contactEmail?: string`), `server/src/env.ts` (`CONTACT_EMAIL` opcjonalne), `server/src/index.ts`, `server/Dockerfile` (`COPY server/public ./public`), `.env.example`
- Test: `server/test/account-web.test.ts`

**Interfaces:**
- Consumes: trasy z Task 2.
- Produces: `GET /usun-konto`, `GET /prywatnosc` → `text/html; charset=utf-8`.

- [ ] **Step 1: Testy (RED):** `/usun-konto` 200, `content-type` html, zawiera client ID z deps i `kontakt@example.com` (bez `contactEmail`); instancja `google: null` bez `googleWebClientId` → brak `accounts.google.com/gsi/client` i brak sekcji Google, `delete-by-google` 503; `/prywatnosc` 200 i link do `/usun-konto`.
- [ ] **Step 2:** uruchomić → FAIL.
- [ ] **Step 3:** HTML według makiety z Task 1 (paleta `Ls`, czcionki systemowe zamiast pobierania Inter/Space Grotesk z Google Fonts, żeby nie wysyłać IP gracza do Google poza logowaniem). Sekcja Google w `<!--GOOGLE-->…<!--/GOOGLE-->`, wycinana, gdy brak client ID. JS: GIS `google.accounts.id.initialize({client_id, callback})` + `renderButton`; po tokenie pole USUŃ i `fetch('/account/delete-by-google')`; formularz `fetch('/account/deletion-requests')`; komunikaty po polsku dla `no_linked_account`, `too_many_requests`, `bad_google_token`, `network`. Pliki czytane raz przy `buildApp` (`import.meta.dirname/../public`).
- [ ] **Step 4:** testy PASS, `npm run build` przechodzi; ręcznie: `npm run dev` z `GOOGLE_WEB_CLIENT_ID`, http://localhost:3000/usun-konto w przeglądarce (po dodaniu `http://localhost:3000` jako źródła JS przez Damiana).
- [ ] **Step 5:** Commit „Strona WWW: /usun-konto i /prywatnosc”.

### Task 4: Skrypt obsługi próśb

**Files:**
- Create: `server/src/deletion-requests.ts`
- Modify: `server/package.json` (`"deletion-requests": "tsx src/deletion-requests.ts"`)
- Test: `server/test/account-web.test.ts`

**Interfaces:**
- Produces: `listRequests(ctx): Promise<Row[]>` (nieobsłużone, najstarsze pierwsze), `handleRequest(ctx, id: string, action: 'delete' | 'reject'): Promise<'deleted' | 'rejected' | 'no_match'>`.

- [ ] **Step 1: Testy (RED):** `handleRequest(..., 'delete')` dla dopasowanej → `'deleted'`, konto znika, `handled_at` ustawione; dla `user_id` NULL → `'no_match'` i nic nie znika; `'reject'` → `handled_at` bez usuwania; obsłużone nie wracają w `listRequests`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Funkcje + CLI (`--delete <id>`, `--reject <id>`, bez argumentów lista: id, data, pseudonim, kod, dopasowanie, wiadomość jako zwykły tekst).
- [ ] **Step 4:** PASS; `npm run -s deletion-requests` na bazie dev wypisuje listę.
- [ ] **Step 5:** Commit „Skrypt: obsługa próśb o usunięcie konta”.

### Task 5: Klient — kod konta na ekranie Konto

**Files:**
- Modify: `client/lib/screens/account_screen.dart`
- Test: `client/test/account_test.dart` (atrapa `/account` z `code: '1A2B-3C4D'`)

- [ ] **Step 1: Test (RED):** tekst `Kod konta: 1A2B-3C4D` i wyjaśnienie zawierające „stronie usuwania konta”; bez pola `code` linijki nie ma; 320×640 ×1,5 bez ucinania.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Linijka w karcie „Usuń konto” według makiety, `SelectableText` dla kodu.
- [ ] **Step 4:** `dart format -l 160 .`, `flutter analyze --fatal-infos`, `flutter test` → PASS.
- [ ] **Step 5:** Commit „Klient: kod konta na ekranie Konto”.

### Task 6: Dokumentacja

- [ ] `docs/konto-google-v1.0.md` §6.1 (źródło JS klienta Web), §11 stan; `README.md` (nowe trasy); `CLAUDE.md` (migracje do 020, skrypt `deletion-requests`). Commit.
