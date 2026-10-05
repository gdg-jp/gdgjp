-- Add abbreviation to chapters
ALTER TABLE chapters ADD COLUMN abbreviation TEXT NOT NULL DEFAULT '';

-- Invitations table
CREATE TABLE IF NOT EXISTS invitations (
  id          TEXT NOT NULL PRIMARY KEY,
  email       TEXT NOT NULL,
  chapter_id  TEXT REFERENCES chapters(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',
  invited_by  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  accepted_at INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_invitations_email ON invitations(email);
