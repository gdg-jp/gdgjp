PRAGMA foreign_keys = OFF;

CREATE TABLE domains (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname              TEXT NOT NULL COLLATE NOCASE UNIQUE,
  kind                  TEXT NOT NULL CHECK (kind IN ('system', 'custom')),
  mode                  TEXT NOT NULL CHECK (mode IN ('short-only', 'origin-first')),
  upstream_origin       TEXT,
  owner_chapter_id      INTEGER,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'verifying', 'active', 'error', 'deleted')),
  provider_domain_id    TEXT,
  verification_records TEXT NOT NULL DEFAULT '[]',
  provider_error        TEXT,
  created_by_user_id    TEXT,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  checked_at            INTEGER,
  deleted_at            INTEGER,
  CHECK (
    (mode = 'short-only' AND upstream_origin IS NULL) OR
    (mode = 'origin-first' AND upstream_origin IS NOT NULL)
  )
);

CREATE INDEX idx_domains_chapter_status
  ON domains(owner_chapter_id, status, hostname);

INSERT INTO domains (id, hostname, kind, mode, status)
VALUES
  (1, 'gdgs.jp', 'system', 'short-only', 'active'),
  (2, 'go.gdgs.jp', 'system', 'short-only', 'active');

CREATE TABLE links_new (
  id                  TEXT PRIMARY KEY,
  domain_id           INTEGER NOT NULL,
  slug                TEXT NOT NULL,
  destination_url     TEXT NOT NULL,
  title               TEXT,
  description         TEXT,
  og_image_url        TEXT,
  owner_user_id       TEXT NOT NULL,
  owner_chapter_id    INTEGER,
  campaign_channel_id INTEGER,
  visibility          TEXT NOT NULL DEFAULT 'private'
                        CHECK (visibility IN ('private', 'public')),
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at         INTEGER,
  deleted_at          INTEGER,
  UNIQUE(domain_id, slug),
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE RESTRICT,
  FOREIGN KEY (campaign_channel_id) REFERENCES campaign_channels(id) ON DELETE SET NULL
);

INSERT INTO links_new (
  id, domain_id, slug, destination_url, title, description, og_image_url,
  owner_user_id, owner_chapter_id, campaign_channel_id, visibility,
  created_at, updated_at, archived_at, deleted_at
)
SELECT
  id, 1, slug, destination_url, title, description, og_image_url,
  owner_user_id, owner_chapter_id, campaign_channel_id, visibility,
  created_at, updated_at, archived_at, deleted_at
FROM links;

DROP TABLE links;
ALTER TABLE links_new RENAME TO links;

CREATE INDEX idx_links_owner
  ON links(owner_user_id, deleted_at);
CREATE INDEX idx_links_chapter
  ON links(owner_chapter_id, deleted_at);
CREATE INDEX idx_links_campaign_channel
  ON links(campaign_channel_id, deleted_at, created_at DESC);
CREATE INDEX idx_links_archive
  ON links(archived_at, deleted_at, created_at DESC);
CREATE INDEX idx_links_domain_slug
  ON links(domain_id, slug, deleted_at);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
