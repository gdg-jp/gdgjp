-- Forward revert of every schema change introduced by PRs #48–#52.
-- The earlier SSO migrations (0009–0012) remain in place for d1_migrations
-- history continuity; this entry undoes their net effect so both fresh
-- local installs and prod converge to the pre-#48 schema after the full
-- migrate sequence is applied.
DROP TABLE IF EXISTS userinfo_cache;
ALTER TABLE "account" ADD COLUMN "password" TEXT;
ALTER TABLE "user" ADD COLUMN "isAdmin" INTEGER;
