CREATE TABLE links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  title           TEXT,
  description     TEXT,
  og_image_url    TEXT,
  owner_user_id   TEXT NOT NULL,
  owner_chapter_id INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at      INTEGER
);

CREATE INDEX idx_links_owner ON links(owner_user_id, deleted_at);
CREATE INDEX idx_links_chapter ON links(owner_chapter_id, deleted_at);
