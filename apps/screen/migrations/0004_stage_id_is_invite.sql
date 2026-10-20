-- The stage id doubles as the speaker invite link (screen.gdgs.jp/<id>/), so
-- the separate invite_token goes. Existing stages keep their id (the Durable
-- Object name and OBS URLs); links shared with the old invite words stop working.
-- SQLite cannot drop a UNIQUE column in place, so the table is rebuilt.
CREATE TABLE stage_new (
  -- Lowercase letters, digits and hyphens, up to 32 characters
  -- (e.g. "apple-banana-orange" or "main-stage"). Also the invite link.
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Number of output slots (A..D), 1-4.
  slot_count INTEGER NOT NULL DEFAULT 2,
  -- OBS Browser Source token (/out/...?t=<output_token>).
  output_token TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO stage_new (id, name, slot_count, output_token, created_by, created_at, updated_at)
  SELECT id, name, slot_count, output_token, created_by, created_at, updated_at FROM stage;

DROP TABLE stage;
ALTER TABLE stage_new RENAME TO stage;
