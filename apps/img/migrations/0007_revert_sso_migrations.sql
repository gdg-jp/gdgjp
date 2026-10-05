-- Forward revert of every schema change introduced by PRs #48–#52.
-- The earlier SSO migrations (0003–0006) remain in place for d1_migrations
-- history continuity; this entry undoes their net effect.
DROP TABLE IF EXISTS userinfo_cache;
ALTER TABLE "account" ADD COLUMN "password" TEXT;
ALTER TABLE "user" ADD COLUMN "isAdmin" INTEGER;
