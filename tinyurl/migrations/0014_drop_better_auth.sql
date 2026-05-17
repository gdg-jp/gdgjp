-- Drop better-auth tables on the RP side.
-- After the SSO migration, the RP keeps no OAuth tokens or sessions in D1 —
-- access/refresh tokens live in the signed session cookie, and the OAuth
-- transaction (PKCE verifier/state/nonce) is a short-lived signed cookie too.

DROP INDEX IF EXISTS "verification_identifier_idx";
DROP INDEX IF EXISTS "account_userId_idx";
DROP INDEX IF EXISTS "session_userId_idx";

DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
