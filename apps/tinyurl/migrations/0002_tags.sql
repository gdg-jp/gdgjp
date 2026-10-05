CREATE TABLE tags (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  color            TEXT,
  owner_user_id    TEXT,
  owner_chapter_id INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (owner_user_id IS NOT NULL AND owner_chapter_id IS NULL) OR
    (owner_user_id IS NULL AND owner_chapter_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_tags_user_name
  ON tags(owner_user_id, name) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_tags_chapter_name
  ON tags(owner_chapter_id, name) WHERE owner_chapter_id IS NOT NULL;

CREATE TABLE link_tags (
  link_id INTEGER NOT NULL,
  tag_id  INTEGER NOT NULL,
  PRIMARY KEY (link_id, tag_id),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);

CREATE INDEX idx_link_tags_tag ON link_tags(tag_id);
