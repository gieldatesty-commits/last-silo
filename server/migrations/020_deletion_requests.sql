-- Prośby o usunięcie konta ze strony WWW (docs/superpowers/specs/2026-11-18-usuwanie-konta-www-design.md).
-- user_id wypełnione tylko, gdy pseudonim i kod konta pasują; obsługa ręczna skryptem deletion-requests.
CREATE TABLE deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  nickname text NOT NULL,
  code text NOT NULL,
  message text NULL,
  created_at timestamptz NOT NULL,
  handled_at timestamptz NULL
);
CREATE INDEX deletion_requests_open ON deletion_requests (created_at) WHERE handled_at IS NULL;
