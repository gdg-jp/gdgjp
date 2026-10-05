-- Migration: 0001_google_drive_tokens
-- Adds per-user Google Drive OAuth token storage for the ingestion feature.
--
-- Run with:
--   pnpm wrangler d1 execute gdgoc-wiki-production-db --remote --file=drizzle/0001_google_drive_tokens.sql

CREATE TABLE IF NOT EXISTS "google_drive_tokens" (
  "user_id"       TEXT NOT NULL PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token"  TEXT NOT NULL,
  "refresh_token" TEXT,
  "expires_at"    INTEGER NOT NULL,
  "updated_at"    INTEGER NOT NULL DEFAULT (unixepoch())
);
