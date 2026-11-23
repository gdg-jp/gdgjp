-- A developer-owned client's grant belongs to the user and the app, not to the
-- browser sign-in that created it. Those clients now ask for consent, and the
-- user removes the grant from /settings/connected-apps. Ending a session keeps
-- deleting the tokens of first-party clients (NULL userId) and still leaves
-- device-grant clients alone.
--
-- Consent is the grant: a developer-owned client may hold a user's token only
-- while an oauthConsent row exists for that user and client. Better Auth writes
-- that row before it issues the authorization code, so the triggers below only
-- refuse tokens minted after the grant was removed (a code or a refresh
-- rotation in flight). Developer clients skipped consent before this
-- migration, so their existing grants never had one: they are deleted here, as
-- are pending authorization codes, and their users see the consent page at the
-- next sign-in through the app. A refresh token that names a resource would
-- keep minting stateless JWT access tokens that removal cannot revoke, so a
-- developer client may not hold one at all.

UPDATE "oauthClient"
SET "skipConsent" = 0,
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE "userId" IS NOT NULL;

DELETE FROM "verification"
WHERE CASE WHEN json_valid("value") THEN
  json_extract("value", '$.type') = 'authorization_code'
  AND json_extract("value", '$.query.client_id') IN (
    SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL
  )
ELSE 0 END;

DELETE FROM "oauthAccessToken"
WHERE "clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "oauthConsent" consent
    WHERE consent."userId" = "oauthAccessToken"."userId"
      AND consent."clientId" = "oauthAccessToken"."clientId"
  );

DELETE FROM "oauthRefreshToken"
WHERE "clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL)
  AND (
    "resources" IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM "oauthConsent" consent
      WHERE consent."userId" = "oauthRefreshToken"."userId"
        AND consent."clientId" = "oauthRefreshToken"."clientId"
    )
  );

CREATE TRIGGER developer_client_access_token_requires_consent
BEFORE INSERT ON "oauthAccessToken"
WHEN NEW."userId" IS NOT NULL
  AND NEW."clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "oauthConsent"
    WHERE "userId" = NEW."userId" AND "clientId" = NEW."clientId"
  )
BEGIN
  SELECT RAISE(ABORT, 'developer client token without consent');
END;

CREATE TRIGGER developer_client_refresh_token_requires_consent
BEFORE INSERT ON "oauthRefreshToken"
WHEN NEW."clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL)
  AND (
    NEW."resources" IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM "oauthConsent"
      WHERE "userId" = NEW."userId" AND "clientId" = NEW."clientId"
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'developer client token without consent');
END;

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
