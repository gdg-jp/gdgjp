CREATE TABLE IF NOT EXISTS "page_favorites" (
  "user_id"    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "page_id"    TEXT NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("user_id", "page_id")
);
CREATE INDEX IF NOT EXISTS "idx_page_favorites_user"
  ON "page_favorites" ("user_id");
