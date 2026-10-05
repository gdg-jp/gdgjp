DROP INDEX IF EXISTS idx_link_permissions_chapter;
DROP INDEX IF EXISTS idx_link_permissions_user;
DROP INDEX IF EXISTS idx_link_permissions_link;
DROP INDEX IF EXISTS idx_comments_link;
DROP INDEX IF EXISTS idx_link_tags_tag;
DROP INDEX IF EXISTS idx_links_chapter;
DROP INDEX IF EXISTS idx_links_owner;

DROP TABLE link_permissions;
DROP TABLE comments;
DROP TABLE link_tags;
DROP TABLE links;

CREATE TABLE links (
  id              TEXT PRIMARY KEY,
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

CREATE TABLE link_tags (
  link_id TEXT NOT NULL,
  tag_id  INTEGER NOT NULL,
  PRIMARY KEY (link_id, tag_id),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);

CREATE TABLE comments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id         TEXT NOT NULL,
  author_user_id  TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE TABLE link_permissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id        TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'chapter')),
  principal_id   TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(link_id, principal_type, principal_id),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX idx_links_owner            ON links(owner_user_id, deleted_at);
CREATE INDEX idx_links_chapter          ON links(owner_chapter_id, deleted_at);
CREATE INDEX idx_link_tags_tag          ON link_tags(tag_id);
CREATE INDEX idx_comments_link          ON comments(link_id, created_at);
CREATE INDEX idx_link_permissions_link  ON link_permissions(link_id);
CREATE INDEX idx_link_permissions_user
  ON link_permissions(principal_type, principal_id) WHERE principal_type = 'user';
CREATE INDEX idx_link_permissions_chapter
  ON link_permissions(principal_type, principal_id) WHERE principal_type = 'chapter';
