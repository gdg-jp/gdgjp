CREATE TABLE images (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL,
  chapter_id    INTEGER NOT NULL,
  cf_image_id   TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  filename      TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_images_user ON images(user_id, created_at DESC);
CREATE INDEX idx_images_chapter ON images(chapter_id, created_at DESC);
