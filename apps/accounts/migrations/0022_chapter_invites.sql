-- Organizer-issued invite links that add the opener to one or more chapters
-- as an active member without the join-request approval step.
--
-- chapter_invites: one row per link. `token` is the URL segment and is kept in
-- plain text so organizers can copy an existing link again; links always
-- expire (`expires_at`) and can be revoked early (`revoked_at`).
-- chapter_invite_chapters: the chapters a link joins. The issuer must be an
-- active organizer of every chapter at creation time (enforced in the app).
CREATE TABLE chapter_invites (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE TABLE chapter_invite_chapters (
  invite_id   TEXT NOT NULL REFERENCES chapter_invites(id) ON DELETE CASCADE,
  chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, chapter_id)
);
CREATE INDEX idx_chapter_invite_chapters_chapter ON chapter_invite_chapters(chapter_id);
