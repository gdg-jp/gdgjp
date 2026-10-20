-- An OAuth grant obtained through a browser sign-in must not outlive that
-- sign-in. Better Auth stores the issuing IdP session on every token row but
-- only nulls it (ON DELETE SET NULL) when the session ends, so relying parties
-- could keep refreshing for 30 days after sign-out, account switching or an
-- admin revocation. Delete those tokens before the session row goes away.
--
-- Device-grant clients (the gdg CLI) are excluded: the browser session only
-- approves the device, and the CLI credential deliberately survives browser
-- sign-out. `revokeUserSessions` still removes those tokens explicitly.
CREATE TRIGGER session_end_revokes_oauth_tokens
BEFORE DELETE ON "session"
BEGIN
  DELETE FROM "oauthAccessToken"
  WHERE "sessionId" = OLD."id"
    AND "clientId" NOT IN (
      SELECT "clientId" FROM "oauthClient" WHERE "grantTypes" LIKE '%device_code%'
    );
  DELETE FROM "oauthRefreshToken"
  WHERE "sessionId" = OLD."id"
    AND "clientId" NOT IN (
      SELECT "clientId" FROM "oauthClient" WHERE "grantTypes" LIKE '%device_code%'
    );
END;
