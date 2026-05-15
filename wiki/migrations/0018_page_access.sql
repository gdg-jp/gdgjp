CREATE TABLE IF NOT EXISTS "page_access" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "page_id"    TEXT NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "email"      TEXT NOT NULL,
  "user_id"    TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "page_role"  TEXT NOT NULL DEFAULT 'viewer',
  "granted_by" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE ("page_id", "email")
);
CREATE INDEX IF NOT EXISTS "idx_page_access_page_id" ON "page_access" ("page_id");
CREATE INDEX IF NOT EXISTS "idx_page_access_user_id" ON "page_access" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_page_access_email"   ON "page_access" ("email");
