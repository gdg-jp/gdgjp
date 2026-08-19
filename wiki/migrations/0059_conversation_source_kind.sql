-- Add the non-fetchable inline conversation source kind and owner-scoped idempotency.
-- SQLite requires a table rebuild to change the kind CHECK constraint.
PRAGMA foreign_keys = OFF;

CREATE TABLE "sources_replacement" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "kind"             TEXT NOT NULL
                     CHECK ("kind" IN (
                       'google-doc',
                       'google-sheet',
                       'google-slides',
                       'google-chat-space',
                       'discord-channel',
                       'website',
                       'upload',
                       'text',
                       'conversation'
                     )),
  "external_id"      TEXT,
  "url"              TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "chapter_id"       TEXT,
  "added_by"         TEXT NOT NULL REFERENCES "user"("id"),
  "status"           TEXT NOT NULL DEFAULT 'pending'
                     CHECK ("status" IN ('pending', 'fetching', 'ready', 'error', 'archived')),
  "refresh_policy"   TEXT NOT NULL DEFAULT 'manual'
                     CHECK ("refresh_policy" IN ('manual', 'daily', 'weekly')),
  "last_fetched_at"  INTEGER,
  "error_message"    TEXT,
  "created_at"       INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"       INTEGER NOT NULL DEFAULT (unixepoch()),
  "fetch_attempt_id" TEXT,
  "visibility"       TEXT NOT NULL DEFAULT 'member'
                     CHECK ("visibility" IN (
                       'private',
                       'member',
                       'organizer',
                       'chapter-member',
                       'chapter-organizer'
                     )),
  CHECK (
    ("visibility" IN ('chapter-member', 'chapter-organizer')) = ("chapter_id" IS NOT NULL)
  )
);

INSERT INTO "sources_replacement" (
  "id", "kind", "external_id", "url", "title", "chapter_id", "added_by", "status",
  "refresh_policy", "last_fetched_at", "error_message", "created_at", "updated_at",
  "fetch_attempt_id", "visibility"
)
SELECT
  "id", "kind", "external_id", "url", "title", "chapter_id", "added_by", "status",
  "refresh_policy", "last_fetched_at", "error_message", "created_at", "updated_at",
  "fetch_attempt_id", "visibility"
FROM "sources";

DROP TABLE "sources";
ALTER TABLE "sources_replacement" RENAME TO "sources";

CREATE INDEX "idx_sources_status" ON "sources" ("status");
CREATE INDEX "idx_sources_chapter_id" ON "sources" ("chapter_id");
CREATE INDEX "idx_sources_added_by" ON "sources" ("added_by");
CREATE INDEX "idx_sources_refresh_policy" ON "sources" ("refresh_policy", "status");
CREATE INDEX "idx_sources_visibility" ON "sources" ("visibility", "chapter_id");

-- This CREATE UNIQUE INDEX deliberately fails the migration if existing data has
-- duplicate owner/kind/external-id tuples; those must be resolved before retrying.
CREATE UNIQUE INDEX "idx_sources_owner_kind_external_id"
  ON "sources" ("added_by", "kind", "external_id") WHERE "external_id" IS NOT NULL;

PRAGMA foreign_keys = ON;
