-- Forward revert of every schema change introduced by PRs #48–#52.
-- The earlier SSO migrations (0004–0006) remain in place for d1_migrations
-- history continuity; this entry undoes their net effect.
ALTER TABLE "account" ADD COLUMN "password" TEXT;
ALTER TABLE "user" ADD COLUMN "isAdmin" INTEGER;
