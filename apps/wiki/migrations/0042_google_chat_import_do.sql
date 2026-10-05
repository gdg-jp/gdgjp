-- Replace queue-sharded Google Chat import with Durable Object alarm phases.
-- In-flight runs are discarded; stuck fetching sources are returned to pending.
DROP TABLE IF EXISTS "google_chat_import_messages";
DROP TABLE IF EXISTS "google_chat_import_runs";

CREATE TABLE "google_chat_import_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_id" TEXT NOT NULL UNIQUE REFERENCES "sources"("id") ON DELETE CASCADE,
  "fetch_attempt_id" TEXT NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'listing'
    CHECK ("phase" IN (
      'listing',
      'senders',
      'attachments',
      'grouping',
      'finalizing',
      'complete',
      'error'
    )),
  "next_page_token" TEXT,
  "since_cursor" TEXT,
  "pages_fetched" INTEGER NOT NULL DEFAULT 0,
  "messages_fetched" INTEGER NOT NULL DEFAULT 0,
  "attachments_done" INTEGER NOT NULL DEFAULT 0,
  "months_total" INTEGER NOT NULL DEFAULT 0,
  "months_done" INTEGER NOT NULL DEFAULT 0,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);

UPDATE "sources"
SET "status" = 'pending', "fetch_attempt_id" = NULL
WHERE "kind" = 'google-chat-space' AND "status" = 'fetching';
