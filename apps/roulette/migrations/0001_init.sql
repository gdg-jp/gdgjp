-- Relying-party auth tables (gdg-lib) + projects, prizes and draws.

CREATE TABLE "user" (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  image        TEXT,
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

-- One lottery. `slug` is the public URL segment (roulette.gdgs.jp/:slug).
-- `chapter_id` scopes admin access: any member of that GDG chapter may edit it.
-- `revision` increments on every settings save so open editors can reload.
CREATE TABLE project (
  slug         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  chapter_id   INTEGER NOT NULL,
  chapter_slug TEXT NOT NULL,
  is_open      INTEGER NOT NULL DEFAULT 0,
  method       TEXT NOT NULL DEFAULT 'fixed' CHECK (method IN ('fixed', 'box', 'equal')),
  expected     INTEGER NOT NULL DEFAULT 100 CHECK (expected >= 0),
  draws        INTEGER NOT NULL DEFAULT 0,
  revision     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES "user" (id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX project_chapter_idx ON project (chapter_id);

-- Up to 15 prizes per project (enforced by the app). `position` orders them and
-- gives finite prizes their rank (1 等, 2 等, ...). `stock` NULL means unlimited,
-- which the app treats as the losing slot (ハズレ). The CHECK keeps a concurrent
-- draw from ever handing out more than the stock.
CREATE TABLE prize (
  id           TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL REFERENCES project (slug) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  name         TEXT NOT NULL,
  stock        INTEGER CHECK (stock IS NULL OR stock >= 0),
  won          INTEGER NOT NULL DEFAULT 0,
  percent      REAL NOT NULL DEFAULT 0,
  CHECK (stock IS NULL OR won <= stock)
);

CREATE INDEX prize_project_idx ON prize (project_slug, position);

-- One row per spin. The prize name/rank/tier are snapshots so the result still
-- shows after the prize is edited or deleted. The unique index is the
-- "one spin per device" rule; `device_id` is an anonymous cookie.
CREATE TABLE draw (
  id           TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL REFERENCES project (slug) ON DELETE CASCADE,
  prize_id     TEXT REFERENCES prize (id) ON DELETE SET NULL,
  prize_name   TEXT NOT NULL,
  rank         INTEGER,
  tier         TEXT NOT NULL CHECK (tier IN ('jackpot', 'win', 'lose')),
  number       INTEGER NOT NULL,
  device_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX draw_device_once ON draw (project_slug, device_id);
