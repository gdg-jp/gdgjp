-- @gdgjp/gdg-lib stores the RP identity and refreshable Accounts tokens in the
-- relying application's D1 database. Keep these names/columns aligned with
-- gdg-lib/src/auth/rp.ts.
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  image TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  oidc_issuer TEXT,
  oidc_subject TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS user_oidc_identity_idx
  ON "user" (oidc_issuer, oidc_subject);

CREATE TABLE IF NOT EXISTS oidc_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  id_token TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS oidc_session_user_idx ON oidc_session (user_id);
