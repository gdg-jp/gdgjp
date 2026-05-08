-- Allow a user to belong to multiple chapters by widening the PK to (user_id, chapter_id).
-- SQLite cannot drop a PK in place, so recreate the table while preserving rows.

ALTER TABLE memberships RENAME TO memberships_old;

CREATE TABLE memberships (
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('organizer', 'member')),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  approved_at INTEGER,
  PRIMARY KEY (user_id, chapter_id)
);

INSERT INTO memberships (user_id, chapter_id, role, status, created_at, approved_at)
SELECT user_id, chapter_id, role, status, created_at, approved_at FROM memberships_old;

DROP TABLE memberships_old;

CREATE INDEX idx_memberships_chapter ON memberships(chapter_id, status);
CREATE INDEX idx_memberships_user    ON memberships(user_id, status);
