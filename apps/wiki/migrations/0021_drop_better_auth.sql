-- Drop better-auth tables on the wiki RP side.

DROP INDEX IF EXISTS "verification_identifier_idx";
DROP INDEX IF EXISTS "account_userId_idx";
DROP INDEX IF EXISTS "session_userId_idx";

DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
