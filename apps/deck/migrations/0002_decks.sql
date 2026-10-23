-- Decks: one controller layout per OBS, owned by a chapter. The layout is one
-- JSON document (pages, folders, keys) saved whole; `version` rejects a save
-- based on a stale copy. The dock token is the OBS custom dock's credential.

CREATE TABLE deck (
  id         TEXT PRIMARY KEY,
  chapter_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  dock_token TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX deck_chapter_idx ON deck (chapter_id, created_at);

-- Key images uploaded from the editor; the bytes are in R2 at decks/<deck_id>/<id>.
CREATE TABLE deck_image (
  id           TEXT NOT NULL,
  deck_id      TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (deck_id, id),
  FOREIGN KEY (deck_id) REFERENCES deck (id) ON DELETE CASCADE
);
