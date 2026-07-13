CREATE TABLE campaigns (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  code               TEXT NOT NULL COLLATE NOCASE,
  owner_chapter_id   INTEGER NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at        INTEGER,
  UNIQUE(owner_chapter_id, code)
);

CREATE INDEX idx_campaigns_chapter
  ON campaigns(owner_chapter_id, archived_at, created_at DESC);

CREATE TABLE campaign_media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL COLLATE NOCASE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  UNIQUE(campaign_id, code),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_media_campaign
  ON campaign_media(campaign_id, archived_at, sort_order, id);

CREATE TABLE campaign_media_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL COLLATE NOCASE,
  archived_at INTEGER,
  UNIQUE(media_id, code),
  FOREIGN KEY (media_id) REFERENCES campaign_media(id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_media_sources_media
  ON campaign_media_sources(media_id, archived_at, name, id);

ALTER TABLE links ADD COLUMN campaign_media_id INTEGER
  REFERENCES campaign_media(id) ON DELETE SET NULL;
ALTER TABLE links ADD COLUMN creative_name TEXT;

CREATE INDEX idx_links_campaign_media
  ON links(campaign_media_id, deleted_at, created_at DESC);
