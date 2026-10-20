-- The local user row is only an identity link plus a name/image display cache;
-- admin status comes from the live accounts IdP claims, so this snapshot is unused.
ALTER TABLE "user" DROP COLUMN is_admin;
