-- Developer Console clients are available only while their owner belongs to
-- at least one chapter with an active membership. Keep this invariant in D1
-- so every membership mutation path, including chapter cascades, behaves the
-- same way.
--
-- Seeded/trusted clients have a NULL userId and are intentionally unaffected.
-- Restoring a membership does not re-enable a client or restore its tokens;
-- the owner must explicitly re-enable it and authorize again.

CREATE TRIGGER disable_owned_oauth_clients_after_membership_delete
AFTER DELETE ON memberships
WHEN OLD.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM memberships
    WHERE user_id = OLD.user_id AND status = 'active'
  )
BEGIN
  DELETE FROM oauthAccessToken
  WHERE clientId IN (
    SELECT clientId FROM oauthClient WHERE userId = OLD.user_id
  );

  DELETE FROM oauthRefreshToken
  WHERE clientId IN (
    SELECT clientId FROM oauthClient WHERE userId = OLD.user_id
  );

  UPDATE oauthClient
  SET disabled = 1,
      updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE userId = OLD.user_id;
END;

CREATE TRIGGER disable_owned_oauth_clients_after_membership_deactivation
AFTER UPDATE OF status ON memberships
WHEN OLD.status = 'active'
  AND NEW.status <> 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM memberships
    WHERE user_id = OLD.user_id AND status = 'active'
  )
BEGIN
  DELETE FROM oauthAccessToken
  WHERE clientId IN (
    SELECT clientId FROM oauthClient WHERE userId = OLD.user_id
  );

  DELETE FROM oauthRefreshToken
  WHERE clientId IN (
    SELECT clientId FROM oauthClient WHERE userId = OLD.user_id
  );

  UPDATE oauthClient
  SET disabled = 1,
      updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE userId = OLD.user_id;
END;
