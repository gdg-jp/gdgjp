CREATE TABLE "fcm_tokens" (
  "token"        TEXT NOT NULL PRIMARY KEY,
  "user_id"      TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "device_label" TEXT,
  "created_at"   INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "idx_fcm_tokens_user_id" ON "fcm_tokens" ("user_id");
