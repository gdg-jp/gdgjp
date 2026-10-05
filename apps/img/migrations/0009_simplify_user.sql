-- See accounts/migrations/0012_simplify_user.sql for full notes. img's
-- `images` table has `user_id ... ON DELETE CASCADE`, so the old
-- create-new/drop-old pattern wiped every uploaded image's owner record.

ALTER TABLE "user" DROP COLUMN "emailVerified";

ALTER TABLE "user" ADD COLUMN "is_admin" INTEGER NOT NULL DEFAULT 0;
UPDATE "user" SET "is_admin" = COALESCE("isAdmin", 0);
ALTER TABLE "user" DROP COLUMN "isAdmin";

ALTER TABLE "user" ADD COLUMN "created_at" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "updated_at" INTEGER NOT NULL DEFAULT 0;
UPDATE "user" SET
  "created_at" = CAST(strftime('%s', "createdAt") AS INTEGER),
  "updated_at" = CAST(strftime('%s', "updatedAt") AS INTEGER);
ALTER TABLE "user" DROP COLUMN "createdAt";
ALTER TABLE "user" DROP COLUMN "updatedAt";
