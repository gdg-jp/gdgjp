-- isAdmin is now resolved via fresh claims (getFreshClaims -> userinfo) instead
-- of denormalized onto the local user row. See docs/01_sso_migration/M2.md.
ALTER TABLE "user" DROP COLUMN "isAdmin";
