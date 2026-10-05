CREATE TABLE IF NOT EXISTS "notifications" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "user_id"    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "type"       TEXT NOT NULL,
  "title_ja"   TEXT NOT NULL,
  "title_en"   TEXT NOT NULL,
  "ref_id"     TEXT,
  "ref_url"    TEXT,
  "read_at"    INTEGER,
  "emailed_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
  ON "notifications" ("user_id", "read_at");
CREATE INDEX IF NOT EXISTS "idx_notifications_user_created_at"
  ON "notifications" ("user_id", "created_at");
