-- Drop better-auth's IdP-side tables.
-- OAuth state (clients, grants, tokens, consent) now lives in OAUTH_KV,
-- managed by @cloudflare/workers-oauth-provider. The IdP login session is
-- a signed cookie (no session table needed).

DROP INDEX IF EXISTS "oauthConsent_userId_idx";
DROP INDEX IF EXISTS "oauthConsent_clientId_idx";
DROP INDEX IF EXISTS "oauthAccessToken_userId_idx";
DROP INDEX IF EXISTS "oauthAccessToken_clientId_idx";
DROP INDEX IF EXISTS "oauthApplication_userId_idx";
DROP INDEX IF EXISTS "verification_identifier_idx";
DROP INDEX IF EXISTS "account_userId_idx";
DROP INDEX IF EXISTS "session_userId_idx";

DROP TABLE IF EXISTS "oauthConsent";
DROP TABLE IF EXISTS "oauthAccessToken";
DROP TABLE IF EXISTS "oauthApplication";
DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
