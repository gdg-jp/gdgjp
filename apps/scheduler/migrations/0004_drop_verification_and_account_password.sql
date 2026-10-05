-- RPs delegate all credential flows (signup, password, email verification,
-- magic link) to the IdP. better-auth's `verification` table is only written
-- by the email-verification / magic-link plugins, which are not loaded here.
-- The `account.password` column is similarly only used when better-auth
-- manages local credentials, never for an OAuth-only RP. Drop both.
DROP TABLE IF EXISTS "verification";
ALTER TABLE "account" DROP COLUMN "password";
