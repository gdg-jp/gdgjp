DELETE FROM oauth_transactions WHERE provider = 'google_photos';
DROP TABLE IF EXISTS google_picker_sessions;
DROP TABLE IF EXISTS google_photos_tokens;

CREATE TABLE IF NOT EXISTS google_photos_albums (
  id TEXT PRIMARY KEY,
  chapter_id INTEGER NOT NULL UNIQUE,
  album_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  poll_interval_minutes INTEGER NOT NULL DEFAULT 5,
  unchanged_poll_count INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS google_photos_albums_due
  ON google_photos_albums(enabled, next_poll_at);

CREATE TABLE IF NOT EXISTS google_photos_media (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES google_photos_albums(id) ON DELETE CASCADE,
  stable_photo_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  source_url TEXT,
  imported_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (album_id, stable_photo_id)
);
CREATE INDEX IF NOT EXISTS google_photos_media_album_imported
  ON google_photos_media(album_id, imported_at DESC);

CREATE TABLE IF NOT EXISTS google_photos_snapshot_items (
  album_id TEXT NOT NULL REFERENCES google_photos_albums(id) ON DELETE CASCADE,
  stable_photo_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (album_id, stable_photo_id)
);

CREATE TABLE IF NOT EXISTS google_photos_poll_runs (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES google_photos_albums(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('running', 'imported', 'unchanged', 'failed', 'structure_changed')),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS google_photos_poll_runs_album_started
  ON google_photos_poll_runs(album_id, started_at DESC);
