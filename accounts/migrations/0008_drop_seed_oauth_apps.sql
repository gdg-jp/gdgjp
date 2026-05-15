-- Trusted OAuth clients are configured at runtime via trustedClientsFromEnv()
-- (accounts/app/lib/auth.server.ts). The seed rows from 0004/0005/0007 carry
-- empty clientSecret and "[]" redirectUrls, so they were never functional —
-- they only served to mislead anyone reading the schema. Drop them.
DELETE FROM "oauthApplication"
WHERE "id" IN ('trusted-tinyurl', 'trusted-wiki', 'trusted-img', 'trusted-scheduler');
