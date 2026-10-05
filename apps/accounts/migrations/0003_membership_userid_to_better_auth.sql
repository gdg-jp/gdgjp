DROP TABLE IF EXISTS memberships;

CREATE TABLE memberships (
  user_id     TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('organizer', 'member')),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  approved_at INTEGER
);

CREATE INDEX idx_memberships_chapter ON memberships(chapter_id, status);
