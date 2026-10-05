ALTER TABLE "user" ADD COLUMN oidc_issuer TEXT;
ALTER TABLE "user" ADD COLUMN oidc_subject TEXT;

CREATE UNIQUE INDEX user_oidc_identity_idx ON "user" (oidc_issuer, oidc_subject);

CREATE TABLE oidc_session (
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
CREATE INDEX oidc_session_user_idx ON oidc_session (user_id);
