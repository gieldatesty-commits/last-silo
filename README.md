# Last Silo

Mobilna gra w świecie Głębi (podziemna kolonia). Spec: `docs/glebia-mvp-spec.md`.

## Uruchomienie lokalnie (serwer)
```bash
cd server && npm ci
export DATABASE_URL=postgres://lastsilo:lastsilo@localhost:5432/lastsilo
export JWT_SECRET=dev-secret-1234567890
npm run dev          # migracje odpalają się przy starcie
npm test             # wymaga bazy lastsilo_test (TEST_DATABASE_URL)
```

## Wdrożenie na VPS
```bash
cp .env.example .env   # uzupełnij hasła i DOMAIN
docker compose up -d --build
```

## Status M0
- [x] Serwer: `/health`, `POST /auth/guest`, `GET /me`, migracje, walidacja configu (zod), testy
- [x] Docker Compose (Postgres + API + Caddy/TLS), CI (GitHub Actions)
- [ ] Google Sign-In, pg-boss (timery), Idempotency-Key — M1
- [ ] Klient Flutter: szkielet w `client/` (nie zbudowany — brak Fluttera w środowisku autora)
