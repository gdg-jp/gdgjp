CREATE TABLE IF NOT EXISTS "page_comments" (
  "id"           TEXT    NOT NULL PRIMARY KEY,
  "page_id"      TEXT    NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "author_id"    TEXT    NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "parent_id"    TEXT    REFERENCES "page_comments"("id") ON DELETE CASCADE,
  "content_json" TEXT    NOT NULL,
  "deleted_at"   INTEGER,
  "created_at"   INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS "idx_page_comments_page_id"
  ON "page_comments" ("page_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_page_comments_parent_id"
  ON "page_comments" ("parent_id");

CREATE TABLE IF NOT EXISTS "comment_reactions" (
  "comment_id" TEXT    NOT NULL REFERENCES "page_comments"("id") ON DELETE CASCADE,
  "user_id"    TEXT    NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "emoji"      TEXT    NOT NULL,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("comment_id", "user_id", "emoji")
);
