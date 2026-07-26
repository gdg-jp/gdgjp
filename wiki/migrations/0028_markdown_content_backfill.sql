-- Records completion of application-level data migrations that cannot be
-- expressed in SQLite alone. TipTap JSON → Markdown needs the shared
-- TypeScript renderer, so it is performed by content-backfill.server.ts
-- immediately after this schema migration is deployed.
CREATE TABLE IF NOT EXISTS content_backfills (
  name TEXT NOT NULL PRIMARY KEY,
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
