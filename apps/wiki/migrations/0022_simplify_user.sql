-- Simplify the user table to: id, email, name, image, is_admin, created_at, updated_at.
-- Wiki's pre-migration shape already has INTEGER timestamps and a NOT-NULL
-- isAdmin (unlike the better-auth-generated schema in the other RPs), so this
-- is a straight rename + column drop — no add/backfill needed.
--
-- See accounts/migrations/0012_simplify_user.sql for why this uses in-place
-- ALTER TABLE rather than create-new/drop-old (the latter cascade-deletes
-- `user_preferences` rows, plus notifications/fcmTokens/googleDriveTokens/
-- comments/taskAssignees that reference user.id ON DELETE CASCADE).

-- Drop emailVerified (Google always returns verified emails).
ALTER TABLE "user" DROP COLUMN "emailVerified";

-- Drop columns moved to user_preferences in 0020. The unique index on
-- discord_id must be dropped first — SQLite refuses DROP COLUMN on a column
-- referenced by any schema object, including indexes.
DROP INDEX IF EXISTS "user_discord_id_unique";
ALTER TABLE "user" DROP COLUMN "discord_id";
ALTER TABLE "user" DROP COLUMN "preferredUiLanguage";
ALTER TABLE "user" DROP COLUMN "preferredContentLanguage";

-- Rename camelCase columns to snake_case (types/constraints preserved).
ALTER TABLE "user" RENAME COLUMN "isAdmin" TO "is_admin";
ALTER TABLE "user" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "user" RENAME COLUMN "updatedAt" TO "updated_at";
