-- Relying-party auth tables (gdg-lib) + the OST event registry.
-- Topic / vote / group / desk data does NOT live here — it stays in each
-- event's Durable Object (workers/ost-board.ts).

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

-- One row per OST event. `slug` is the public URL segment (ost.gdgs.jp/:slug).
-- `chapter_id` scopes admin access: any member of that GDG chapter may view and
-- edit the event.
CREATE TABLE events (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  chapter_id   INTEGER NOT NULL,
  chapter_slug TEXT NOT NULL,
  created_by   TEXT REFERENCES "user" (id),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at   INTEGER
);

CREATE INDEX events_chapter_idx ON events (chapter_id) WHERE deleted_at IS NULL;
