CREATE TABLE conference_records (
  name       TEXT PRIMARY KEY,          -- conferenceRecords/<id>
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  start_time TEXT,
  end_time   TEXT
);
CREATE INDEX conference_records_meeting_idx ON conference_records (meeting_id);

CREATE TABLE artifacts (
  id                TEXT PRIMARY KEY,
  meeting_id        TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('recording', 'notes', 'chat_log')),
  drive_file_id     TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  web_view_link     TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  shared_at         TEXT,
  attached_at       TEXT,
  last_error        TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX artifacts_meeting_idx ON artifacts (meeting_id, created_at);
CREATE INDEX artifacts_pending_idx ON artifacts (shared_at, attached_at);

CREATE TABLE processed_events (
  dedupe_key  TEXT PRIMARY KEY,         -- "<ce-type>|<resourceName>"
  received_at TEXT NOT NULL
);

CREATE TABLE google_subscription (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  name        TEXT NOT NULL,
  state       TEXT NOT NULL,
  expire_time TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  last_error  TEXT
);
