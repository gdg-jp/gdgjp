-- Knowledge platform v2 Stage 02: Discord server sources, hourly refresh, integration state
-- and the agent job queue.
--
-- `sources` and `source_import_runs` are rebuilt because `kind` / `refresh_policy` are
-- CHECK-constrained.
-- D1 ignores `PRAGMA foreign_keys = OFF` inside migrations: dropping a parent table runs
-- its ON DELETE CASCADE / SET NULL actions. Every row in the foreign-key closure of the
-- rebuilt table is therefore copied aside first, and after the rename the children are
-- cleared and restored parent-first. Checks are deferred to COMMIT so the restore order
-- inside a table (comment replies, self references) does not matter. This works the same
-- whether or not the engine cascades. (tests/migrations/0062_spaces.test.ts runs it with
-- foreign keys ON, as D1 does.)
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
  "fetch_attempt_id", "visibility", "space_id"
)
SELECT
  "id", "kind", "external_id", "url", "title", "chapter_id", "added_by", "status",
  "refresh_policy", "last_fetched_at", "error_message", "created_at", "updated_at",
  "fetch_attempt_id", "visibility", "space_id"
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

CREATE TABLE "source_import_runs_replacement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_id" TEXT NOT NULL UNIQUE REFERENCES "sources"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK (
    "kind" IN ('google-chat-space', 'google-drive', 'website', 'discord-channel', 'discord-guild')
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
INSERT INTO "source_import_runs_replacement" SELECT
  "id", "source_id", "kind", "fetch_attempt_id", "phase", "since_cursor", "progress",
  "consecutive_failures", "error_message", "created_at", "updated_at"
FROM "_bk_source_import_runs";
DROP TABLE "source_import_runs";
ALTER TABLE "source_import_runs_replacement" RENAME TO "source_import_runs";

-- Restore the foreign-key closure.
DELETE FROM "google_chat_sender_samples";
DELETE FROM "source_assets";
DELETE FROM "source_documents";
DELETE FROM "page_sources";
INSERT INTO "page_sources" SELECT * FROM "_bk_page_sources";
INSERT INTO "source_documents" SELECT * FROM "_bk_source_documents";
INSERT INTO "source_assets" SELECT * FROM "_bk_source_assets";
INSERT INTO "google_chat_sender_samples" SELECT * FROM "_bk_google_chat_sender_samples";
DROP TABLE "_bk_page_sources";
DROP TABLE "_bk_source_documents";
DROP TABLE "_bk_source_assets";
DROP TABLE "_bk_google_chat_sender_samples";
DROP TABLE "_bk_source_import_runs";

CREATE TRIGGER page_sources_sync_revision_insert AFTER INSERT ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_update AFTER UPDATE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_delete AFTER DELETE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;

-- Content hash the runner last integrated; != content_hash means "not yet in the pages".
ALTER TABLE "source_documents" ADD COLUMN "integrated_hash" TEXT;

-- Queue between the Worker (producer) and the OCI runner (consumer, Stage 04).
CREATE TABLE "agent_jobs" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "type"        TEXT NOT NULL CHECK ("type" IN ('synthesize', 'answer', 'consolidate', 'translate')),
  "space_id"    TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "status"      TEXT NOT NULL DEFAULT 'queued'
                CHECK ("status" IN ('queued', 'leased', 'succeeded', 'failed', 'needs_review', 'expired')),
  -- answer = 10, manual synthesize / translate-now = 5, synthesize = 0, translate = -5,
  -- consolidate = -10
  "priority"    INTEGER NOT NULL DEFAULT 0,
  -- synthesize: { sourceIds, documentIds, requests? }; translate: { pageId, sourceHash };
  -- answer: { bundleKey, … } (Stage 05)
  "payload"     TEXT NOT NULL DEFAULT '{}',
  "result"      TEXT,
  "error"       TEXT,
  "lease_owner" TEXT,
  "lease_until" INTEGER,
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  -- Earliest time the job may be leased (hourly batching of synthesize per space).
  "run_after"   INTEGER NOT NULL DEFAULT (unixepoch()),
  -- answer only: past this the job is expired and the asker gets the degraded reply.
  "deadline_at" INTEGER,
  "created_at"  INTEGER NOT NULL DEFAULT (unixepoch()),
  "started_at"  INTEGER,
  "finished_at" INTEGER
);
CREATE INDEX "idx_agent_jobs_queue" ON "agent_jobs" ("status", "priority" DESC, "run_after", "created_at");
CREATE INDEX "idx_agent_jobs_space" ON "agent_jobs" ("space_id", "type", "status");
-- At most one QUEUED synthesize / consolidate per space: new work merges into it.
CREATE UNIQUE INDEX "idx_agent_jobs_one_queued_per_space"
  ON "agent_jobs" ("space_id", "type")
  WHERE "status" = 'queued' AND "type" IN ('synthesize', 'consolidate');
