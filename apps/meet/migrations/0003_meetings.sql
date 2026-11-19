CREATE TABLE meetings (
  id                 TEXT PRIMARY KEY,
  host_chapter_id    INTEGER NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  start_at           TEXT NOT NULL, -- UTC ISO 8601
  end_at             TEXT NOT NULL, -- UTC ISO 8601
  time_zone          TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  access_type        TEXT NOT NULL DEFAULT 'RESTRICTED'
                     CHECK (access_type IN ('RESTRICTED', 'TRUSTED', 'OPEN')),
  space_name         TEXT,
  meeting_uri        TEXT,
  meeting_code       TEXT,
  calendar_event_id  TEXT,
  calendar_html_link TEXT,
  status             TEXT NOT NULL CHECK (status IN ('creating', 'active', 'failed', 'canceled')),
  last_error         TEXT,
  created_by_user_id TEXT NOT NULL,
  created_by_email   TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  canceled_at        TEXT
);

CREATE INDEX meetings_space_name_idx ON meetings (space_name);
CREATE INDEX meetings_created_by_idx ON meetings (created_by_user_id);
CREATE INDEX meetings_status_start_idx ON meetings (status, start_at);

CREATE TABLE meeting_invite_sources (
  id         TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('host_chapter_organizers', 'chapter_organizers', 'chapter_all', 'email')),
  chapter_id INTEGER,
  email      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('cohost', 'participant')),
  created_at TEXT NOT NULL
);

CREATE INDEX meeting_invite_sources_meeting_idx ON meeting_invite_sources (meeting_id);

CREATE TABLE meeting_invitees (
  meeting_id       TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  email            TEXT NOT NULL,
  display_name     TEXT,
  user_id          TEXT,
  role             TEXT NOT NULL CHECK (role IN ('cohost', 'participant')),
  source_kinds     TEXT NOT NULL, -- JSON 配列: 例 ["creator", "host_chapter_organizers"]
  PRIMARY KEY (meeting_id, email_normalized)
);

CREATE INDEX meeting_invitees_email_idx ON meeting_invitees (email_normalized, meeting_id);
