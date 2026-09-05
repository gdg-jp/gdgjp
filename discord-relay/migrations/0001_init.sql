-- Relying-party auth tables (gdg-lib) + chapter directory cache and audit log.

CREATE TABLE "user" (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  image        TEXT,
  is_admin     INTEGER NOT NULL DEFAULT 0,
  oidc_issuer  TEXT,
  oidc_subject TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX user_oidc_identity
  ON "user" (oidc_issuer, oidc_subject)
  WHERE oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL;

CREATE TABLE oidc_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  id_token TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX oidc_session_user_idx ON oidc_session (user_id);

-- Display cache only (INFO-001). SSoT is GDG Accounts.
CREATE TABLE chapters (
  chapter_id INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT,
  kind       TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Audit log for configuration changes and privileged actions (INFO-012).
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_role    TEXT NOT NULL,
  chapter_id    INTEGER,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  occurred_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX audit_log_chapter_idx ON audit_log (chapter_id);
CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at);
