-- Stage registry. A stage is a long-lived room (one per venue track) whose
-- OBS URLs stay the same all day. Live state is in the StageRoom Durable
-- Object; this table only lists stages and holds their access tokens.
CREATE TABLE stage (
  -- Three lowercase English words, e.g. "apple-banana-orange".
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Number of output slots (A..D), 1-4.
  slot_count INTEGER NOT NULL DEFAULT 2,
  -- Shared speaker invite link token (/join/<invite_token>).
  invite_token TEXT NOT NULL UNIQUE,
  -- OBS Browser Source token (/out/...?t=<output_token>).
  output_token TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
