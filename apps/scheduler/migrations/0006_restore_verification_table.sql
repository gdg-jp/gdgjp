-- M1 (migration 0004) dropped the verification table on the mistaken premise
-- that better-auth's genericOAuth plugin doesn't write to it. It does — the
-- OAuth state + PKCE codeVerifier are persisted to verification between the
-- authorize redirect and the callback (see better-auth dist/oauth2/state.mjs
-- generateState → setOAuthState). Sign-in fails on prod with
--   D1_ERROR: no such table: verification
-- Restore the table with the same shape better-auth originally created.
CREATE TABLE IF NOT EXISTS "verification" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "expiresAt"  TEXT NOT NULL,
  "createdAt"  TEXT NOT NULL,
  "updatedAt"  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
