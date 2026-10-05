-- Replace the legacy per-email owner model with Google Docs-style share subjects.
-- The production wiki has a single page and intentionally does not retain old grants.
DELETE FROM "page_access";
DROP TABLE "page_access";

CREATE TABLE "page_access" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "page_id"       TEXT NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "subject_type"  TEXT NOT NULL CHECK ("subject_type" IN ('email', 'chapter')),
  "subject_key"   TEXT NOT NULL,
  "subject_label" TEXT NOT NULL,
  "user_id"       TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "role"          TEXT NOT NULL DEFAULT 'viewer' CHECK ("role" IN ('viewer', 'commenter', 'editor')),
  "granted_by"    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at"    INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE ("page_id", "subject_type", "subject_key")
);
CREATE INDEX "idx_page_access_page_id" ON "page_access" ("page_id");
CREATE INDEX "idx_page_access_user_id" ON "page_access" ("user_id");
CREATE INDEX "idx_page_access_subject" ON "page_access" ("subject_type", "subject_key");

ALTER TABLE "pages" ADD COLUMN "general_role" TEXT NOT NULL DEFAULT 'viewer'
  CHECK ("general_role" IN ('viewer', 'commenter', 'editor'));
-- Existing rows deliberately become restricted; new application inserts use the
-- restricted default from the Drizzle schema.
UPDATE "pages" SET "visibility" = 'restricted', "general_role" = 'viewer';
