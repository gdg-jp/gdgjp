-- isAdmin is no longer denormalized at RPs. Scheduler never read it; the column
-- is removed for parity with tinyurl/img. See docs/01_sso_migration/M2.md.
ALTER TABLE "user" DROP COLUMN "isAdmin";
