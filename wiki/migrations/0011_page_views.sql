CREATE TABLE IF NOT EXISTS "page_views" (
  "user_id"   TEXT    NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "page_id"   TEXT    NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "viewed_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("user_id", "page_id")
);
CREATE INDEX IF NOT EXISTS "idx_page_views_user_viewed_at"
  ON "page_views" ("user_id", "viewed_at" DESC);
