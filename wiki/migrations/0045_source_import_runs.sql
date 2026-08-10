-- A source import run is shared by every source driver.  The phase intentionally
-- has no CHECK constraint: drivers may grow their own resumable phase ladders
-- without a D1 migration.  Driver tests cover every phase in each ladder.
DROP TABLE IF EXISTS "google_chat_import_runs";

CREATE TABLE "source_import_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_id" TEXT NOT NULL UNIQUE REFERENCES "sources"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('google-chat-space', 'google-drive', 'website')),
  "fetch_attempt_id" TEXT NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'start',
  "since_cursor" TEXT,
  "progress" TEXT NOT NULL DEFAULT '{}',
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);

-- A deployment may interrupt an alarm after the old run table disappears.  The
-- refresh sweep in fetch-source.ts re-enqueues these stale pending sources.
UPDATE "sources"
SET "status" = 'pending', "fetch_attempt_id" = NULL
WHERE "status" = 'fetching';
