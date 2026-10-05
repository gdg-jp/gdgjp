-- See tinyurl/migrations/0014 for full notes; same change in this app.

DROP INDEX IF EXISTS "verification_identifier_idx";
DROP INDEX IF EXISTS "account_userId_idx";
DROP INDEX IF EXISTS "session_userId_idx";

DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
