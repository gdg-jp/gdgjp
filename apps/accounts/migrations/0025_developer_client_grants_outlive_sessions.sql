-- A developer-owned client's grant belongs to the user and the app, not to the
-- browser sign-in that created it. Those clients now ask for consent, and the
-- user removes the grant from /settings/connected-apps. Ending a session keeps
-- deleting the tokens of first-party clients (NULL userId) and still leaves
-- device-grant clients alone.
--
-- Consent is the grant: a developer-owned client may hold a user's token or
-- pending authorization code only while an oauthConsent row exists for that
-- user and client. Better Auth writes that row before it issues the code. The
-- insert triggers refuse a token minted after the grant was removed (a code or
-- a refresh rotation in flight), and the delete trigger removes the user's
-- tokens and codes for the client when its last consent row goes, whichever
-- path deletes it. Every existing developer-client token and pending code
-- predates this model, so all of them are deleted here, with or without a
-- consent row; consent rows are kept. Users see the consent page or, with a
-- consent row, get new tokens at their next sign-in through the app. A refresh
-- token that names a resource would keep minting stateless JWT access tokens
-- that removal cannot revoke, so a developer client may not hold one at all.

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
WHERE "clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL);

DELETE FROM "oauthRefreshToken"
WHERE "clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL);

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

CREATE TRIGGER developer_client_consent_removal_revokes_grant
AFTER DELETE ON "oauthConsent"
WHEN OLD."userId" IS NOT NULL
  AND OLD."clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "oauthConsent"
    WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId"
  )
BEGIN
  DELETE FROM "verification"
  WHERE CASE WHEN json_valid("value") THEN
    json_extract("value", '$.type') = 'authorization_code'
    AND json_extract("value", '$.userId') = OLD."userId"
    AND json_extract("value", '$.query.client_id') = OLD."clientId"
  ELSE 0 END;
  DELETE FROM "oauthAccessToken"
  WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId";
  DELETE FROM "oauthRefreshToken"
  WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId";
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
