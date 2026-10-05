-- Move wiki-specific user fields out of the better-auth `user` table into a
-- dedicated `user_preferences` table keyed by user_id.

CREATE TABLE user_preferences (
  user_id                    TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  preferred_ui_language      TEXT NOT NULL DEFAULT 'ja',
  preferred_content_language TEXT NOT NULL DEFAULT 'ja',
  discord_id                 TEXT UNIQUE
);

INSERT INTO user_preferences (user_id, preferred_ui_language, preferred_content_language, discord_id)
SELECT
  id,
  COALESCE(preferredUiLanguage, 'ja'),
  COALESCE(preferredContentLanguage, 'ja'),
  discord_id
FROM "user";
