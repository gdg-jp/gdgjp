-- A developer-owned client's grant belongs to the user and the app, not to the
-- browser sign-in that created it. Those clients now ask for consent, and the
-- user removes the grant from /settings/connected-apps. Ending a session keeps
-- deleting the tokens of first-party clients (NULL userId) and still leaves
-- device-grant clients alone.

UPDATE "oauthClient"
SET "skipConsent" = 0,
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE "userId" IS NOT NULL;

DROP TRIGGER IF EXISTS session_end_revokes_oauth_tokens;

CREATE TRIGGER session_end_revokes_oauth_tokens
BEFORE DELETE ON "session"
BEGIN
  DELETE FROM "oauthAccessToken"
  WHERE "sessionId" = OLD."id"
    AND "clientId" NOT IN (
      SELECT "clientId" FROM "oauthClient"
      WHERE "grantTypes" LIKE '%device_code%' OR "userId" IS NOT NULL
    );
  DELETE FROM "oauthRefreshToken"
  WHERE "sessionId" = OLD."id"
    AND "clientId" NOT IN (
      SELECT "clientId" FROM "oauthClient"
      WHERE "grantTypes" LIKE '%device_code%' OR "userId" IS NOT NULL
    );
END;
