-- The membership triggers of migration 0014 act once, when an owner's last
-- active membership goes away. A write that was decided before that moment
-- and lands after it was never checked again. This migration makes the
-- revocation hold for those late writes as well.
--
-- Enabling or creating a developer-owned client is now conditional on an
-- active membership in the same statement (oauth-clients.server.ts). Every
-- developer client that is enabled while its owner has no active membership
-- is disabled here.
--
-- Disabling a developer-owned client, by its owner or by the membership
-- triggers, or changing its registered scopes, deletes its tokens, its pending
-- authorization codes, and the developerClientGrantCode records of migration
-- 0025 in the statement that writes the client. A token endpoint request that
-- read its code or refresh token before that statement then fails on the
-- insert triggers of migration 0025 when it writes its tokens, even after the
-- owner returns and enables the client again. A code issued while the client
-- is disabled is not recorded, so it can never be exchanged.

UPDATE "oauthClient"
SET "disabled" = 1,
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE "userId" IS NOT NULL
  AND COALESCE("disabled", 0) <> 1
  AND NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = "oauthClient"."userId" AND status = 'active'
  );

DELETE FROM "verification"
WHERE CASE WHEN json_valid("value") THEN
  json_extract("value", '$.type') = 'authorization_code'
  AND json_extract("value", '$.query.client_id') IN (
    SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL AND "disabled" = 1
  )
ELSE 0 END;

DELETE FROM "oauthAccessToken"
WHERE "clientId" IN (
  SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL AND "disabled" = 1
);

DELETE FROM "oauthRefreshToken"
WHERE "clientId" IN (
  SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL AND "disabled" = 1
);

DELETE FROM "developerClientGrantCode"
WHERE "clientId" IN (
  SELECT "clientId" FROM "oauthClient" WHERE "userId" IS NOT NULL AND "disabled" = 1
);

DROP TRIGGER IF EXISTS developer_client_code_records_grant;

CREATE TRIGGER developer_client_code_records_grant
AFTER INSERT ON "verification"
WHEN CASE WHEN json_valid(NEW."value") THEN
  json_extract(NEW."value", '$.type') = 'authorization_code'
  AND json_extract(NEW."value", '$.query.client_id') IN (
    SELECT "clientId" FROM "oauthClient"
    WHERE "userId" IS NOT NULL AND COALESCE("disabled", 0) = 0
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

CREATE TRIGGER developer_client_revocation_purges_grants
AFTER UPDATE OF "disabled", "scopes" ON "oauthClient"
WHEN NEW."userId" IS NOT NULL
  AND (NEW."disabled" = 1 OR NEW."scopes" IS NOT OLD."scopes")
BEGIN
  DELETE FROM "verification"
  WHERE CASE WHEN json_valid("value") THEN
    json_extract("value", '$.type') = 'authorization_code'
    AND json_extract("value", '$.query.client_id') = NEW."clientId"
  ELSE 0 END;
  DELETE FROM "oauthAccessToken" WHERE "clientId" = NEW."clientId";
  DELETE FROM "oauthRefreshToken" WHERE "clientId" = NEW."clientId";
  DELETE FROM "developerClientGrantCode" WHERE "clientId" = NEW."clientId";
END;
