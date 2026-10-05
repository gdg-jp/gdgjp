-- Simplify the user table to: id, email, name, image, is_admin, created_at, updated_at.
--
-- The previous version of this migration used the SQLite
-- "create-new / insert / drop-old / rename" pattern with
-- PRAGMA foreign_keys = OFF at the top. That PRAGMA is a no-op inside a
-- transaction (per SQLite spec) and D1 wraps every migration in one — so
-- foreign keys stayed enabled, and `DROP TABLE "user"` cascade-deleted every
-- row in `memberships` (which has `user_id ... ON DELETE CASCADE`).
--
-- Use in-place ALTER TABLE statements instead: ADD/DROP/RENAME COLUMN never
-- drops the parent table, so child rows are unaffected regardless of FK state.

-- 1. Drop emailVerified (Google always returns verified emails).
ALTER TABLE "user" DROP COLUMN "emailVerified";

-- 2. Replace isAdmin (nullable INTEGER) with is_admin (NOT NULL DEFAULT 0).
--    A column-level rename can't change NOT NULL or DEFAULT, so add + backfill + drop.
ALTER TABLE "user" ADD COLUMN "is_admin" INTEGER NOT NULL DEFAULT 0;
UPDATE "user" SET "is_admin" = COALESCE("isAdmin", 0);
ALTER TABLE "user" DROP COLUMN "isAdmin";

-- 3. Replace TEXT ISO-8601 timestamps with INTEGER epoch seconds.
--    ALTER TABLE ADD COLUMN can't take a non-constant DEFAULT (e.g. unixepoch()),
--    so the default literal is 0 and the application supplies created_at/updated_at
--    explicitly on every INSERT (see initializeRpAuth's upsertUser).
ALTER TABLE "user" ADD COLUMN "created_at" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "updated_at" INTEGER NOT NULL DEFAULT 0;
UPDATE "user" SET
  "created_at" = CAST(strftime('%s', "createdAt") AS INTEGER),
  "updated_at" = CAST(strftime('%s', "updatedAt") AS INTEGER);
ALTER TABLE "user" DROP COLUMN "createdAt";
ALTER TABLE "user" DROP COLUMN "updatedAt";
