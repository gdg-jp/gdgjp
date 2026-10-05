CREATE TABLE comments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id         INTEGER NOT NULL,
  author_user_id  TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX idx_comments_link ON comments(link_id, created_at);
