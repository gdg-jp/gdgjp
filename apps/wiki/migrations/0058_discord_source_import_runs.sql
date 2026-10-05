-- Discord channel imports write source_import_runs.kind = 'discord-channel'.
-- Migration 0057 only widened sources.kind; the run table CHECK still rejected
-- Discord claims, so queue delivery released back to pending forever.
PRAGMA foreign_keys = OFF;

CREATE TABLE "source_import_runs_replacement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_id" TEXT NOT NULL UNIQUE REFERENCES "sources"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK (
    "kind" IN ('google-chat-space', 'google-drive', 'website', 'discord-channel')
  ),
  "fetch_attempt_id" TEXT NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'start',
  "since_cursor" TEXT,
  "progress" TEXT NOT NULL DEFAULT '{}',
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO "source_import_runs_replacement" (
  "id",
  "source_id",
  "kind",
  "fetch_attempt_id",
  "phase",
  "since_cursor",
  "progress",
  "consecutive_failures",
  "error_message",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "source_id",
  "kind",
  "fetch_attempt_id",
  "phase",
  "since_cursor",
  "progress",
  "consecutive_failures",
  "error_message",
  "created_at",
  "updated_at"
FROM "source_import_runs";

DROP TABLE "source_import_runs";
ALTER TABLE "source_import_runs_replacement" RENAME TO "source_import_runs";

PRAGMA foreign_keys = ON;
