-- Resumable Google Chat imports.  A Queue delivery must never need to fetch a
-- complete space: page and message work is persisted and resumed independently.
CREATE TABLE "google_chat_import_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_id" TEXT NOT NULL UNIQUE REFERENCES "sources"("id") ON DELETE CASCADE,
  "fetch_attempt_id" TEXT NOT NULL,
  "next_page_token" TEXT,
  "phase" TEXT NOT NULL DEFAULT 'listing'
    CHECK ("phase" IN ('listing', 'finalizing', 'complete', 'error')),
  "pages_fetched" INTEGER NOT NULL DEFAULT 0,
  "messages_fetched" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "google_chat_import_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL REFERENCES "google_chat_import_runs"("id") ON DELETE CASCADE,
  "message_name" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "month_path" TEXT,
  "message_r2_key" TEXT NOT NULL,
  "message_json" TEXT NOT NULL,
  "sender_name" TEXT,
  "attachment_index" INTEGER NOT NULL DEFAULT 0,
  "assets_json" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'processing', 'ready', 'error')),
  UNIQUE ("run_id", "message_name")
);

CREATE INDEX "idx_google_chat_import_messages_run_status"
  ON "google_chat_import_messages" ("run_id", "status", "sequence");
