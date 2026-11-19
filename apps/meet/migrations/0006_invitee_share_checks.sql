CREATE TABLE drive_share_checks (
  email_normalized TEXT PRIMARY KEY,
  status           TEXT NOT NULL CHECK (status IN ('ok', 'unshareable')),
  http_status      INTEGER,
  api_status       TEXT,
  source           TEXT NOT NULL CHECK (source IN ('probe', 'share')),
  checked_at       TEXT NOT NULL
);

CREATE TABLE drive_probe_file (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  file_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE artifact_share_failures (
  artifact_id      TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  http_status      INTEGER NOT NULL,
  api_status       TEXT,
  failed_at        TEXT NOT NULL,
  PRIMARY KEY (artifact_id, email_normalized)
);
