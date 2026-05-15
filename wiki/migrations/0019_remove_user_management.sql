-- Drop user-management features that have moved to the accounts IdP.
-- The accounts app is now the source of truth for user provisioning,
-- chapter memberships, and the isAdmin flag.

-- Invitation flow is owned by accounts; wiki no longer issues invites.
DROP INDEX IF EXISTS idx_invitations_email;
DROP TABLE IF EXISTS invitations;

-- Replace user.role + user.chapterId with a single isAdmin boolean populated
-- from the IdP at sign-in via better-auth's mapProfileToUser. Per-chapter
-- membership is no longer tracked locally; if/when wiki needs it for page
-- visibility it should be read from the IdP /oauth2/userinfo claims.
ALTER TABLE "user" DROP COLUMN "role";
ALTER TABLE "user" DROP COLUMN "chapterId";
ALTER TABLE "user" ADD COLUMN "isAdmin" INTEGER NOT NULL DEFAULT 0;
