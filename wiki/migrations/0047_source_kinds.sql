-- SQLite cannot extend a CHECK constraint in place. Rebuild sources while preserving
-- all lifecycle columns added by later source migrations.
PRAGMA foreign_keys = OFF;

CREATE TABLE "sources_replacement" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "kind"             TEXT NOT NULL
                     CHECK ("kind" IN (
                       'google-doc',
                       'google-sheet',
                       'google-slides',
                       'google-chat-space',
                       'website',
                       'upload',
                       'text'
                     )),
  "external_id"      TEXT,
  "url"              TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "chapter_id"       TEXT REFERENCES "chapters"("id") ON DELETE SET NULL,
  "added_by"         TEXT NOT NULL REFERENCES "user"("id"),
  "status"           TEXT NOT NULL DEFAULT 'pending'
                     CHECK ("status" IN ('pending', 'fetching', 'ready', 'error', 'archived')),
  "refresh_policy"   TEXT NOT NULL DEFAULT 'manual'
                     CHECK ("refresh_policy" IN ('manual', 'daily', 'weekly')),
  "last_fetched_at"  INTEGER,
  "error_message"    TEXT,
  "created_at"       INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"       INTEGER NOT NULL DEFAULT (unixepoch()),
  "fetch_attempt_id" TEXT
);

INSERT INTO "sources_replacement" (
  "id", "kind", "external_id", "url", "title", "chapter_id", "added_by", "status",
  "refresh_policy", "last_fetched_at", "error_message", "created_at", "updated_at",
  "fetch_attempt_id"
)
SELECT
  "id", "kind", "external_id", "url", "title", "chapter_id", "added_by", "status",
  "refresh_policy", "last_fetched_at", "error_message", "created_at", "updated_at",
  "fetch_attempt_id"
FROM "sources";

DROP TABLE "sources";
ALTER TABLE "sources_replacement" RENAME TO "sources";

CREATE INDEX "idx_sources_status" ON "sources" ("status");
CREATE INDEX "idx_sources_chapter_id" ON "sources" ("chapter_id");
CREATE INDEX "idx_sources_added_by" ON "sources" ("added_by");
CREATE INDEX "idx_sources_refresh_policy" ON "sources" ("refresh_policy", "status");

UPDATE "sources"
SET "kind" = 'google-sheet'
WHERE "kind" = 'google-doc' AND instr("url", '/spreadsheets/d/') > 0;

UPDATE "sources"
SET "kind" = 'google-slides'
WHERE "kind" = 'google-doc' AND instr("url", '/presentation/d/') > 0;

UPDATE "sources"
SET "status" = 'pending', "fetch_attempt_id" = NULL
WHERE "title" LIKE 'Google Doc %' AND "status" <> 'archived';

PRAGMA foreign_keys = ON;
