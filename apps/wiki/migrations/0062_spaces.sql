-- Knowledge platform v2 Stage 01: spaces (tenant layer outside the existing ACL).
--
-- Every existing source and page moves into the shared space `gdg-jp`. The inner ACL
-- (sources.visibility, page visibility, page_access, <acl src> spans) is untouched.
-- `gdg-jp` reproduces the v1 population exactly: anyone (even anonymous) may reach the
-- space, and every signed-in user is an editor; the inner ACL then decides as before.
-- The local `chapters` table is not synced from Accounts, so membership is expressed with
-- wildcard principals instead of one row per chapter.

CREATE TABLE "spaces" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "slug"              TEXT NOT NULL UNIQUE,
  "name"              TEXT NOT NULL,
  "kind"              TEXT NOT NULL CHECK ("kind" IN ('personal', 'chapter', 'shared')),
  -- Opaque Accounts chapter id (not an FK: local `chapters` is unsynced). Chapter spaces only.
  "chapter_id"        TEXT UNIQUE,
  "lang"              TEXT NOT NULL DEFAULT 'ja' CHECK ("lang" IN ('ja', 'en')),
  "translate_enabled" INTEGER NOT NULL DEFAULT 1,
  -- NULL only for the migrated system space `gdg-jp`.
  "created_by"        TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"        INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"        INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (("kind" = 'chapter') = ("chapter_id" IS NOT NULL))
);

CREATE TABLE "space_members" (
  "space_id"       TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  -- user: user.id or '*' (any signed-in user); public: '*' (anyone, signed in or not);
  -- chapter_role: '<chapterId>:<member|organizer>' or '*:<member|organizer>';
  -- discord_guild: guild snowflake; chat_space: 'spaces/<id>'.
  "principal_type" TEXT NOT NULL
                   CHECK ("principal_type" IN ('user', 'public', 'chapter_role', 'discord_guild', 'chat_space')),
  "principal_id"   TEXT NOT NULL,
  "role"           TEXT NOT NULL CHECK ("role" IN ('owner', 'editor', 'viewer')),
  "created_at"     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("space_id", "principal_type", "principal_id"),
  CHECK ("principal_type" <> 'public' OR ("principal_id" = '*' AND "role" = 'viewer'))
);
CREATE INDEX "idx_space_members_principal" ON "space_members" ("principal_type", "principal_id");

CREATE TABLE "review_flags" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "space_id"    TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "target_type" TEXT NOT NULL CHECK ("target_type" IN ('page', 'source', 'job')),
  "target_id"   TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "payload"     TEXT NOT NULL DEFAULT '{}',
  "resolved_at" INTEGER,
  "resolved_by" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "idx_review_flags_open" ON "review_flags" ("space_id", "resolved_at", "created_at" DESC);

INSERT INTO "spaces" ("id", "slug", "name", "kind", "lang")
VALUES ('gdg-jp', 'gdg-jp', 'GDG Japan', 'shared', 'ja')
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "space_members" ("space_id", "principal_type", "principal_id", "role") VALUES
  ('gdg-jp', 'public', '*', 'viewer'),
  ('gdg-jp', 'user', '*', 'editor')
ON CONFLICT DO NOTHING;

-- sources: plain column (no FK — SQLite rejects REFERENCES with a non-NULL default on
-- ADD COLUMN). The app writes only ids that exist; spaces are never deleted with sources.
ALTER TABLE "sources" ADD COLUMN "space_id" TEXT NOT NULL DEFAULT 'gdg-jp';
CREATE INDEX "idx_sources_space" ON "sources" ("space_id", "status");
DROP INDEX IF EXISTS "idx_sources_owner_kind_external_id";
CREATE UNIQUE INDEX "idx_sources_owner_kind_external_id"
  ON "sources" ("space_id", "added_by", "kind", "external_id") WHERE "external_id" IS NOT NULL;

ALTER TABLE "user_preferences" ADD COLUMN "last_space_id" TEXT;
ALTER TABLE "user_preferences" ADD COLUMN "hide_agent_pages" INTEGER NOT NULL DEFAULT 0;

-- pages: rebuild to replace UNIQUE(slug) with UNIQUE(space_id, slug).
-- D1 ignores `PRAGMA foreign_keys = OFF` inside migrations: dropping a parent table runs
-- its ON DELETE CASCADE / SET NULL actions. Every row in the foreign-key closure of the
-- rebuilt table is therefore copied aside first, and after the rename the children are
-- cleared and restored parent-first. Checks are deferred to COMMIT so the restore order
-- inside a table (comment replies, self references) does not matter. This works the same
-- whether or not the engine cascades. (tests/migrations/0062_spaces.test.ts runs it with
-- foreign keys ON, as D1 does.)
PRAGMA defer_foreign_keys = true;

CREATE TABLE "_bk_page_tags" AS SELECT * FROM "page_tags";
CREATE TABLE "_bk_page_attachments" AS SELECT * FROM "page_attachments";
CREATE TABLE "_bk_page_versions" AS SELECT * FROM "page_versions";
CREATE TABLE "_bk_page_favorites" AS SELECT * FROM "page_favorites";
CREATE TABLE "_bk_page_sources" AS SELECT * FROM "page_sources";
CREATE TABLE "_bk_page_views" AS SELECT * FROM "page_views";
CREATE TABLE "_bk_page_comments" AS SELECT * FROM "page_comments";
CREATE TABLE "_bk_comment_reactions" AS SELECT * FROM "comment_reactions";
CREATE TABLE "_bk_page_embedding_status" AS SELECT * FROM "page_embedding_status";
CREATE TABLE "_bk_page_access" AS SELECT * FROM "page_access";
CREATE TABLE "_bk_task_lists" AS SELECT * FROM "task_lists";
CREATE TABLE "_bk_task_list_teams" AS SELECT * FROM "task_list_teams";
CREATE TABLE "_bk_tasks" AS SELECT * FROM "tasks";
CREATE TABLE "_bk_task_dependencies" AS SELECT * FROM "task_dependencies";
CREATE TABLE "_bk_google_document_imports" AS SELECT * FROM "google_document_imports";
CREATE TABLE "_bk_google_document_import_nodes" AS SELECT * FROM "google_document_import_nodes";
CREATE TABLE "_bk_translation_jobs" AS SELECT * FROM "translation_jobs";

-- Triggers on child tables reference `pages` in their bodies; RENAME rewrites them and
-- fails while `pages` is dropped. Drop them here and recreate them after the rename.
DROP TRIGGER IF EXISTS page_tags_sync_revision_insert;
DROP TRIGGER IF EXISTS page_tags_sync_revision_delete;
DROP TRIGGER IF EXISTS page_sources_sync_revision_insert;
DROP TRIGGER IF EXISTS page_sources_sync_revision_update;
DROP TRIGGER IF EXISTS page_sources_sync_revision_delete;
DROP TRIGGER IF EXISTS page_attachments_sync_revision_insert;
DROP TRIGGER IF EXISTS page_attachments_sync_revision_update;
DROP TRIGGER IF EXISTS page_attachments_sync_revision_delete;
DROP TRIGGER IF EXISTS page_access_sync_revision_insert;
DROP TRIGGER IF EXISTS page_access_sync_revision_update;
DROP TRIGGER IF EXISTS page_access_sync_revision_delete;

CREATE TABLE pages_replacement (
  id TEXT NOT NULL PRIMARY KEY,
  space_id TEXT NOT NULL DEFAULT 'gdg-jp' REFERENCES spaces(id),
  title_ja TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL,
  content_ja TEXT NOT NULL,
  content_en TEXT NOT NULL DEFAULT '',
  translation_status_ja TEXT NOT NULL DEFAULT 'human',
  translation_status_en TEXT NOT NULL DEFAULT 'missing',
  summary_ja TEXT NOT NULL DEFAULT '',
  summary_en TEXT NOT NULL DEFAULT '',
  parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'archived')),
  page_type TEXT,
  page_metadata TEXT,
  ingestion_session_id TEXT REFERENCES ingestion_sessions(id) ON DELETE SET NULL,
  actionability_score INTEGER,
  author_id TEXT NOT NULL,
  last_edited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  visibility TEXT NOT NULL DEFAULT 'restricted',
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  general_role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (general_role IN ('viewer', 'commenter', 'editor')),
  sync_revision INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL DEFAULT 'human' CHECK (origin IN ('human', 'agent')),
  acl_synced_with_parent INTEGER NOT NULL DEFAULT 1,
  acl_source_ids TEXT NOT NULL DEFAULT '[]',
  UNIQUE (space_id, slug)
);

INSERT INTO pages_replacement (
  id, space_id, title_ja, title_en, slug, content_ja, content_en, translation_status_ja,
  translation_status_en, summary_ja, summary_en, parent_id, sort_order, status, page_type,
  page_metadata, ingestion_session_id, actionability_score, author_id, last_edited_by,
  created_at, updated_at, visibility, chapter_id, general_role, sync_revision, origin,
  acl_synced_with_parent, acl_source_ids
)
SELECT
  id, 'gdg-jp', title_ja, title_en, slug, content_ja, content_en, translation_status_ja,
  translation_status_en, summary_ja, summary_en, parent_id, sort_order, status, page_type,
  page_metadata, ingestion_session_id, actionability_score, author_id, last_edited_by,
  created_at, updated_at, visibility, chapter_id, general_role, sync_revision, origin,
  acl_synced_with_parent, acl_source_ids
FROM pages;

-- pages_replacement.parent_id REFERENCES "pages" by name, so dropping the old table runs
-- ON DELETE SET NULL on the NEW table and would flatten the page tree. Keep the links.
CREATE TABLE "_bk_page_parents" AS SELECT id, parent_id FROM pages WHERE parent_id IS NOT NULL;

DROP TABLE pages;
ALTER TABLE pages_replacement RENAME TO pages;

UPDATE pages SET parent_id = (SELECT b.parent_id FROM "_bk_page_parents" b WHERE b.id = pages.id)
WHERE id IN (SELECT id FROM "_bk_page_parents");
DROP TABLE "_bk_page_parents";

-- Restore the foreign-key closure (see header of the pages rebuild).
-- Before any trigger is recreated, so restored rows do not bump sync_revision.
DELETE FROM "translation_jobs";
DELETE FROM "google_document_import_nodes";
DELETE FROM "google_document_imports";
DELETE FROM "task_dependencies";
DELETE FROM "tasks";
DELETE FROM "task_list_teams";
DELETE FROM "task_lists";
DELETE FROM "page_access";
DELETE FROM "page_embedding_status";
DELETE FROM "comment_reactions";
DELETE FROM "page_comments";
DELETE FROM "page_views";
DELETE FROM "page_sources";
DELETE FROM "page_favorites";
DELETE FROM "page_versions";
DELETE FROM "page_attachments";
DELETE FROM "page_tags";
INSERT INTO "page_tags" SELECT * FROM "_bk_page_tags";
INSERT INTO "page_attachments" SELECT * FROM "_bk_page_attachments";
INSERT INTO "page_versions" SELECT * FROM "_bk_page_versions";
INSERT INTO "page_favorites" SELECT * FROM "_bk_page_favorites";
INSERT INTO "page_sources" SELECT * FROM "_bk_page_sources";
INSERT INTO "page_views" SELECT * FROM "_bk_page_views";
INSERT INTO "page_comments" SELECT * FROM "_bk_page_comments";
INSERT INTO "comment_reactions" SELECT * FROM "_bk_comment_reactions";
INSERT INTO "page_embedding_status" SELECT * FROM "_bk_page_embedding_status";
INSERT INTO "page_access" SELECT * FROM "_bk_page_access";
INSERT INTO "task_lists" SELECT * FROM "_bk_task_lists";
INSERT INTO "task_list_teams" SELECT * FROM "_bk_task_list_teams";
INSERT INTO "tasks" SELECT * FROM "_bk_tasks";
INSERT INTO "task_dependencies" SELECT * FROM "_bk_task_dependencies";
INSERT INTO "google_document_imports" SELECT * FROM "_bk_google_document_imports";
INSERT INTO "google_document_import_nodes" SELECT * FROM "_bk_google_document_import_nodes";
INSERT INTO "translation_jobs" SELECT * FROM "_bk_translation_jobs";
DROP TABLE "_bk_page_tags";
DROP TABLE "_bk_page_attachments";
DROP TABLE "_bk_page_versions";
DROP TABLE "_bk_page_favorites";
DROP TABLE "_bk_page_sources";
DROP TABLE "_bk_page_views";
DROP TABLE "_bk_page_comments";
DROP TABLE "_bk_comment_reactions";
DROP TABLE "_bk_page_embedding_status";
DROP TABLE "_bk_page_access";
DROP TABLE "_bk_task_lists";
DROP TABLE "_bk_task_list_teams";
DROP TABLE "_bk_tasks";
DROP TABLE "_bk_task_dependencies";
DROP TABLE "_bk_google_document_imports";
DROP TABLE "_bk_google_document_import_nodes";
DROP TABLE "_bk_translation_jobs";

CREATE INDEX idx_pages_status_updated ON pages (status, updated_at DESC);
CREATE INDEX idx_pages_parent_order ON pages (parent_id, sort_order ASC);
CREATE INDEX idx_pages_author ON pages (author_id, updated_at DESC);
CREATE INDEX idx_pages_slug ON pages (slug);
CREATE INDEX idx_pages_visibility ON pages (visibility);
CREATE INDEX idx_pages_chapter_id ON pages (chapter_id);
CREATE INDEX "idx_pages_origin" ON "pages" ("origin");
CREATE INDEX idx_pages_parent_acl_sync ON pages (parent_id, acl_synced_with_parent);
CREATE INDEX idx_pages_space_status ON pages (space_id, status, updated_at DESC);

CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(page_id, title_ja, title_en, summary_ja, summary_en, tags_text)
  VALUES (new.id, new.title_ja, new.title_en, new.summary_ja, new.summary_en, '');
END;
CREATE TRIGGER pages_fts_update AFTER UPDATE ON pages BEGIN
  UPDATE pages_fts
  SET title_ja = new.title_ja, title_en = new.title_en, summary_ja = new.summary_ja,
      summary_en = new.summary_en
  WHERE page_id = new.id;
END;
CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
  DELETE FROM pages_fts WHERE page_id = old.id;
END;
CREATE TRIGGER pages_fts_trigram_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts_trigram(page_id, title_ja, title_en, summary_ja, summary_en, tags_text)
  VALUES (new.id, new.title_ja, new.title_en, new.summary_ja, new.summary_en, '');
END;
CREATE TRIGGER pages_fts_trigram_update AFTER UPDATE ON pages BEGIN
  UPDATE pages_fts_trigram
  SET title_ja = new.title_ja, title_en = new.title_en, summary_ja = new.summary_ja,
      summary_en = new.summary_en
  WHERE page_id = new.id;
END;
CREATE TRIGGER pages_fts_trigram_delete AFTER DELETE ON pages BEGIN
  DELETE FROM pages_fts_trigram WHERE page_id = old.id;
END;
CREATE TRIGGER trg_page_embedding_insert
AFTER INSERT ON pages WHEN NEW.status = 'published'
BEGIN
  INSERT OR IGNORE INTO page_embedding_status (page_id, status) VALUES (NEW.id, 'pending');
END;
CREATE TRIGGER trg_page_embedding_update
AFTER UPDATE ON pages WHEN NEW.status = 'published'
BEGIN
  INSERT INTO page_embedding_status (page_id, status, updated_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET status = 'pending', updated_at = unixepoch();
END;
CREATE TRIGGER pages_sync_revision_update
AFTER UPDATE ON pages WHEN NEW.sync_revision = OLD.sync_revision
BEGIN
  UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.id;
END;
CREATE TRIGGER pages_translation_insert
AFTER INSERT ON pages
WHEN NEW.translation_status_en <> 'human'
  AND length(trim(NEW.title_ja || NEW.summary_ja || NEW.content_ja)) > 0
BEGIN
  INSERT INTO translation_jobs(page_id, status, requested_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET
    status = 'pending', source_hash = NULL, requested_at = unixepoch(),
    started_at = NULL, completed_at = NULL, lease_until = NULL,
    next_attempt_at = NULL, attempts = 0, last_error = NULL;
END;
CREATE TRIGGER pages_translation_ja_update
AFTER UPDATE OF title_ja, summary_ja, content_ja ON pages
WHEN NEW.translation_status_en <> 'human'
  AND (NEW.title_ja IS NOT OLD.title_ja
    OR NEW.summary_ja IS NOT OLD.summary_ja
    OR NEW.content_ja IS NOT OLD.content_ja)
  AND length(trim(NEW.title_ja || NEW.summary_ja || NEW.content_ja)) > 0
BEGIN
  UPDATE pages SET translation_status_en = 'missing'
    WHERE id = NEW.id AND translation_status_en <> 'missing';
  INSERT INTO translation_jobs(page_id, status, requested_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET
    status = 'pending', source_hash = NULL, requested_at = unixepoch(),
    started_at = NULL, completed_at = NULL, lease_until = NULL,
    next_attempt_at = NULL, attempts = 0, last_error = NULL;
END;
CREATE TRIGGER pages_translation_missing_update
AFTER UPDATE OF translation_status_en ON pages
WHEN NEW.translation_status_en = 'missing'
  AND OLD.translation_status_en <> 'missing'
  AND length(trim(NEW.title_ja || NEW.summary_ja || NEW.content_ja)) > 0
BEGIN
  INSERT INTO translation_jobs(page_id, status, requested_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET
    status = 'pending', source_hash = NULL, requested_at = unixepoch(),
    started_at = NULL, completed_at = NULL, lease_until = NULL,
    next_attempt_at = NULL, attempts = 0, last_error = NULL;
END;
CREATE TRIGGER pages_translation_human_update
AFTER UPDATE OF translation_status_en ON pages
WHEN NEW.translation_status_en = 'human'
  AND OLD.translation_status_en <> 'human'
BEGIN
  UPDATE translation_jobs SET
    status = 'completed', completed_at = unixepoch(), lease_until = NULL,
    next_attempt_at = NULL, last_error = NULL
  WHERE page_id = NEW.id;
END;

-- Child-table sync_revision triggers (dropped above).
CREATE TRIGGER page_tags_sync_revision_insert AFTER INSERT ON page_tags
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_tags_sync_revision_delete AFTER DELETE ON page_tags
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
CREATE TRIGGER page_sources_sync_revision_insert AFTER INSERT ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_update AFTER UPDATE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_delete AFTER DELETE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
CREATE TRIGGER page_attachments_sync_revision_insert AFTER INSERT ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_attachments_sync_revision_update AFTER UPDATE ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_attachments_sync_revision_delete AFTER DELETE ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
CREATE TRIGGER page_access_sync_revision_insert AFTER INSERT ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_access_sync_revision_update AFTER UPDATE ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_access_sync_revision_delete AFTER DELETE ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
