ALTER TABLE google_photos_media ADD COLUMN taken_at TEXT;

CREATE INDEX IF NOT EXISTS google_photos_media_album_taken
  ON google_photos_media(album_id, taken_at DESC, imported_at DESC);
