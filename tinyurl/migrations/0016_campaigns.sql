CREATE TABLE campaigns (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  code               TEXT NOT NULL COLLATE NOCASE,
  default_destination_url TEXT,
  owner_user_id      TEXT NOT NULL,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  archived_at        INTEGER,
  UNIQUE(owner_user_id, code)
);

CREATE INDEX idx_campaigns_owner
  ON campaigns(owner_user_id, archived_at, created_at DESC);

CREATE TABLE campaign_chapters (
  campaign_id INTEGER NOT NULL,
  chapter_id  INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, chapter_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_chapters_chapter
  ON campaign_chapters(chapter_id, campaign_id);

CREATE TABLE campaign_channels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL COLLATE NOCASE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  UNIQUE(campaign_id, code),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_channels_campaign
  ON campaign_channels(campaign_id, archived_at, sort_order, id);

CREATE TABLE campaign_channel_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL COLLATE NOCASE,
  archived_at INTEGER,
  UNIQUE(channel_id, code),
  FOREIGN KEY (channel_id) REFERENCES campaign_channels(id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_channel_sources_channel
  ON campaign_channel_sources(channel_id, archived_at, name, id);

ALTER TABLE links ADD COLUMN campaign_channel_id INTEGER
  REFERENCES campaign_channels(id) ON DELETE SET NULL;

CREATE INDEX idx_links_campaign_channel
  ON links(campaign_channel_id, deleted_at, created_at DESC);
