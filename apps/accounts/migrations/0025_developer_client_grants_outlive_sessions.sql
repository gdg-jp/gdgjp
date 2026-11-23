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
--
-- A grant is also bound to the consent it was issued under. Each authorization
-- code a developer client receives while the user's consent exists is recorded
-- in developerClientGrantCode, and every token of that grant carries the code's
-- identifier (Better Auth copies authorizationCodeId through refresh
-- rotations). Removing the last consent deletes those records, so a code
-- exchange or rotation that read its code or refresh token before the removal
-- cannot write tokens afterwards, even when the user approves the app again in
-- between. A code that stores a resource is never recorded.

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

CREATE TABLE "developerClientGrantCode" (
  "authorizationCodeId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX "developerClientGrantCode_user_client_idx"
  ON "developerClientGrantCode" ("userId", "clientId");

CREATE TRIGGER developer_client_code_records_grant
AFTER INSERT ON "verification"
WHEN CASE WHEN json_valid(NEW."value") THEN
  json_extract(NEW."value", '$.type') = 'authorization_code'
  AND json_extract(NEW."value", '$.query.client_id') IN (
    SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL
  )
  AND CASE json_type(NEW."value", '$.resource')
    WHEN 'array' THEN json_array_length(NEW."value", '$.resource') = 0
    WHEN 'null' THEN 1
    ELSE json_type(NEW."value", '$.resource') IS NULL
  END
  AND json_type(NEW."value", '$.query.resource') IS NULL
  AND EXISTS (
    SELECT 1 FROM "oauthConsent"
    WHERE "userId" = json_extract(NEW."value", '$.userId')
      AND "clientId" = json_extract(NEW."value", '$.query.client_id')
  )
ELSE 0 END
BEGIN
  INSERT OR IGNORE INTO "developerClientGrantCode"
    ("authorizationCodeId", "userId", "clientId", "createdAt")
  VALUES (
    NEW."identifier",
    json_extract(NEW."value", '$.userId'),
    json_extract(NEW."value", '$.query.client_id'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE TRIGGER developer_client_access_token_requires_consent
BEFORE INSERT ON "oauthAccessToken"
WHEN NEW."userId" IS NOT NULL
  AND NEW."clientId" IN (SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL)
  AND (
    NOT EXISTS (
      SELECT 1 FROM "oauthConsent"
      WHERE "userId" = NEW."userId" AND "clientId" = NEW."clientId"
    )
    OR NOT EXISTS (
      SELECT 1 FROM "developerClientGrantCode"
      WHERE "authorizationCodeId" = NEW."authorizationCodeId"
        AND "userId" = NEW."userId" AND "clientId" = NEW."clientId"
    )
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
    OR NOT EXISTS (
      SELECT 1 FROM "developerClientGrantCode"
      WHERE "authorizationCodeId" = NEW."authorizationCodeId"
        AND "userId" = NEW."userId" AND "clientId" = NEW."clientId"
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
  DELETE FROM "developerClientGrantCode"
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
