-- Drop user-management features that have moved to the accounts IdP.
-- The accounts app is now the source of truth for user provisioning,
-- chapter memberships, and the isAdmin flag.
--
-- Order matters: add the new isAdmin column FIRST, backfill it from the
-- existing role values, and only then drop the old columns. This preserves
-- admin status for users imported from the old gdgoc-wiki database.

-- 1. Add the new column with a safe default (non-admin).
ALTER TABLE "user" ADD COLUMN "isAdmin" INTEGER NOT NULL DEFAULT 0;

-- 2. Carry forward existing admin status. Other pre-SSO roles
--    (lead/member/viewer/pending) collapse to regular users; chapter-scoped
--    membership is now read from the IdP /oauth2/userinfo claims.
UPDATE "user" SET "isAdmin" = 1 WHERE "role" = 'admin';

-- 3. Drop the columns/tables that the accounts IdP owns.
ALTER TABLE "user" DROP COLUMN "role";
ALTER TABLE "user" DROP COLUMN "chapterId";

-- Invitation flow is owned by accounts; wiki no longer issues invites.
DROP INDEX IF EXISTS idx_invitations_email;
DROP TABLE IF EXISTS invitations;
