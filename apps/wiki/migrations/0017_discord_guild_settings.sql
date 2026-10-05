CREATE TABLE "discord_guild_settings" (
  "guild_id"            TEXT NOT NULL PRIMARY KEY,
  "chapter_id"          TEXT NOT NULL UNIQUE REFERENCES "chapters"("id") ON DELETE CASCADE,
  "reminder_channel_id" TEXT NOT NULL,
  "enabled"             INTEGER NOT NULL DEFAULT 1,
  "created_at"          INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX "idx_discord_guild_settings_chapter_id"
  ON "discord_guild_settings" ("chapter_id");
