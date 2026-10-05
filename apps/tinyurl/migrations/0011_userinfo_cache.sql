-- Cross-isolate cache for /oauth2/userinfo responses. Replaces the per-isolate
-- in-memory Map at tinyurl/app/lib/chapter.server.ts. See docs/01_sso_migration/M4.md.
CREATE TABLE userinfo_cache (
  user_id     TEXT NOT NULL PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  claims_json TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL
);
