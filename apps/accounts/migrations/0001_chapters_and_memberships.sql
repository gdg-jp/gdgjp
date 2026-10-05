CREATE TABLE chapters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('gdg', 'gdgoc')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- user_id is the sole PK: one membership per user across all chapters (single-chapter model)
CREATE TABLE memberships (
  user_id     TEXT PRIMARY KEY,
  chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('organizer', 'member')),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  approved_at INTEGER
);

CREATE INDEX idx_memberships_chapter ON memberships(chapter_id, status);
