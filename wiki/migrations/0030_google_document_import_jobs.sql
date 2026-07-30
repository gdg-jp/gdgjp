-- Queue state is separate from google_document_imports because a job exists
-- before the first (root) Wiki page can be created. This is a separate
-- migration so environments that already applied 0029 receive the table.
CREATE TABLE "google_document_import_jobs" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "document_id"      TEXT NOT NULL UNIQUE,
  "requested_by"     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status"           TEXT NOT NULL DEFAULT 'queued'
                     CHECK ("status" IN ('queued', 'running', 'completed', 'failed')),
  "total_nodes"      INTEGER NOT NULL DEFAULT 0,
  "completed_nodes"  INTEGER NOT NULL DEFAULT 0,
  "total_images"     INTEGER NOT NULL DEFAULT 0,
  "completed_images" INTEGER NOT NULL DEFAULT 0,
  "warning_count"    INTEGER NOT NULL DEFAULT 0,
  "error_message"    TEXT,
  "created_at"       INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"       INTEGER NOT NULL DEFAULT (unixepoch())
);
