-- `google-drive-folder`: one source for a whole Google Drive folder (every Docs / Sheets /
-- Slides file beneath it, imported under the folder's own paths).
--
-- `sources.kind` is CHECK-constrained, so `sources` is rebuilt.
-- D1 ignores `PRAGMA foreign_keys = OFF` inside migrations: dropping `sources` runs the
-- ON DELETE CASCADE / SET NULL actions of every table that references it. The whole
-- foreign-key closure is therefore copied aside first and, after the rename, cleared and
-- restored parent-first, with checks deferred to COMMIT (same procedure as 0063).
-- tests/migrations/0069_drive_folder_source_kind.test.ts runs it with foreign keys ON, as D1 does.
PRAGMA defer_foreign_keys = true;

-- Restoring page_sources must not bump pages.sync_revision (CLI clones would go stale).
DROP TRIGGER IF EXISTS page_sources_sync_revision_insert;
DROP TRIGGER IF EXISTS page_sources_sync_revision_update;
DROP TRIGGER IF EXISTS page_sources_sync_revision_delete;

CREATE TABLE "_bk_source_import_runs" AS SELECT * FROM "source_import_runs";
CREATE TABLE "_bk_page_sources" AS SELECT * FROM "page_sources";
CREATE TABLE "_bk_source_documents" AS SELECT * FROM "source_documents";
CREATE TABLE "_bk_source_assets" AS SELECT * FROM "source_assets";
CREATE TABLE "_bk_google_chat_sender_samples" AS SELECT * FROM "google_chat_sender_samples";

CREATE TABLE "sources_replacement" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "kind"               TEXT NOT NULL
                       CHECK ("kind" IN (
                         'google-doc',
                         'google-sheet',
                         'google-slides',
                         'google-drive-folder',
                         'google-chat-space',
                         'discord-channel',
                         'discord-guild',
                         'website',
                         'upload',
                         'text',
                         'conversation'
                       )),
  "external_id"        TEXT,
  "url"                TEXT NOT NULL,
  "title"              TEXT NOT NULL,
  "chapter_id"         TEXT,
  "added_by"           TEXT NOT NULL REFERENCES "user"("id"),
  "status"             TEXT NOT NULL DEFAULT 'pending'
                       CHECK ("status" IN ('pending', 'fetching', 'ready', 'error', 'archived')),
  "refresh_policy"     TEXT NOT NULL DEFAULT 'manual'
                       CHECK ("refresh_policy" IN ('manual', 'hourly', 'daily', 'weekly')),
  "last_fetched_at"    INTEGER,
  "error_message"      TEXT,
  "created_at"         INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"         INTEGER NOT NULL DEFAULT (unixepoch()),
  "fetch_attempt_id"   TEXT,
  "visibility"         TEXT NOT NULL DEFAULT 'member'
                       CHECK ("visibility" IN (
                         'private',
                         'member',
                         'organizer',
                         'chapter-member',
                         'chapter-organizer'
                       )),
  "space_id"           TEXT NOT NULL DEFAULT 'gdg-jp',
  -- Kind-specific JSON settings (discord-guild: channel selection rules).
  "config"             TEXT,
  -- When the runner last folded this source's documents into pages (Stage 04).
  "last_integrated_at" INTEGER,
  CHECK (
    ("visibility" IN ('chapter-member', 'chapter-organizer')) = ("chapter_id" IS NOT NULL)
  )
);

INSERT INTO "sources_replacement" (
  "id", "kind", "external_id", "url", "title", "chapter_id", "added_by", "status",
  "refresh_policy", "last_fetched_at", "error_message", "created_at", "updated_at",
  "fetch_attempt_id", "visibility", "space_id", "config", "last_integrated_at"
)
SELECT
  "id", "kind", "external_id", "url", "title", "chapter_id", "added_by", "status",
  "refresh_policy", "last_fetched_at", "error_message", "created_at", "updated_at",
  "fetch_attempt_id", "visibility", "space_id", "config", "last_integrated_at"
FROM "sources";

DROP TABLE "sources";
ALTER TABLE "sources_replacement" RENAME TO "sources";

CREATE INDEX "idx_sources_status" ON "sources" ("status");
CREATE INDEX "idx_sources_chapter_id" ON "sources" ("chapter_id");
CREATE INDEX "idx_sources_added_by" ON "sources" ("added_by");
CREATE INDEX "idx_sources_refresh_policy" ON "sources" ("refresh_policy", "status");
CREATE INDEX "idx_sources_visibility" ON "sources" ("visibility", "chapter_id");
CREATE INDEX "idx_sources_space" ON "sources" ("space_id", "status");
CREATE UNIQUE INDEX "idx_sources_owner_kind_external_id"
  ON "sources" ("space_id", "added_by", "kind", "external_id") WHERE "external_id" IS NOT NULL;

-- Restore the foreign-key closure, parents first.
DELETE FROM "google_chat_sender_samples";
DELETE FROM "source_assets";
DELETE FROM "source_documents";
DELETE FROM "page_sources";
DELETE FROM "source_import_runs";
INSERT INTO "source_import_runs" SELECT * FROM "_bk_source_import_runs";
INSERT INTO "page_sources" SELECT * FROM "_bk_page_sources";
INSERT INTO "source_documents" SELECT * FROM "_bk_source_documents";
INSERT INTO "source_assets" SELECT * FROM "_bk_source_assets";
INSERT INTO "google_chat_sender_samples" SELECT * FROM "_bk_google_chat_sender_samples";
DROP TABLE "_bk_source_import_runs";
DROP TABLE "_bk_page_sources";
DROP TABLE "_bk_source_documents";
DROP TABLE "_bk_source_assets";
DROP TABLE "_bk_google_chat_sender_samples";

CREATE TRIGGER page_sources_sync_revision_insert AFTER INSERT ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_update AFTER UPDATE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_delete AFTER DELETE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
