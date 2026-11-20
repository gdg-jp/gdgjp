-- Align D1 schema with better-auth@1.7.26 (jwt plugin) and @better-auth/oauth-provider@1.7.26.

ALTER TABLE "jwks" ADD COLUMN "alg" TEXT;
ALTER TABLE "jwks" ADD COLUMN "crv" TEXT;

ALTER TABLE "oauthClient" ADD COLUMN "clientDiscoveryId" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "clientCredentialsScopes" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "backchannelLogoutUri" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "backchannelLogoutSessionRequired" INTEGER;
ALTER TABLE "oauthClient" ADD COLUMN "applicationType" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "jwks" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "jwksUri" TEXT;
ALTER TABLE "oauthClient" ADD COLUMN "dpopBoundAccessTokens" INTEGER DEFAULT 0;

UPDATE "oauthClient"
SET "applicationType" = "type"
WHERE "applicationType" IS NULL AND "type" IN ('web', 'native');

ALTER TABLE "oauthRefreshToken" ADD COLUMN "authorizationCodeId" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "resources" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "requestedUserInfoClaims" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotatedAt" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotationReplayResponse" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "rotationReplayExpiresAt" TEXT;
ALTER TABLE "oauthRefreshToken" ADD COLUMN "confirmation" TEXT;
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken" ("authorizationCodeId");

ALTER TABLE "oauthAccessToken" ADD COLUMN "authorizationCodeId" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN "resources" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN "requestedUserInfoClaims" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN "revoked" TEXT;
ALTER TABLE "oauthAccessToken" ADD COLUMN "confirmation" TEXT;
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken" ("authorizationCodeId");

ALTER TABLE "oauthConsent" ADD COLUMN "resources" TEXT;
ALTER TABLE "oauthConsent" ADD COLUMN "requestedUserInfoClaims" TEXT;

CREATE TABLE "oauthResource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "accessTokenTtl" INTEGER,
  "refreshTokenTtl" INTEGER,
  "signingAlgorithm" TEXT,
  "signingKeyId" TEXT,
  "allowedScopes" TEXT,
  "customClaims" TEXT,
  "dpopBoundAccessTokensRequired" INTEGER DEFAULT 0,
  "disabled" INTEGER DEFAULT 0,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "policyVersion" INTEGER DEFAULT 1,
  "metadata" TEXT
);

CREATE TABLE "oauthClientResource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
  "resourceId" TEXT NOT NULL REFERENCES "oauthResource" ("identifier") ON DELETE CASCADE,
  "metadata" TEXT,
  "createdAt" TEXT
);
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource" ("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource" ("resourceId");
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx"
  ON "oauthClientResource" ("clientId", "resourceId");

CREATE TABLE "oauthClientAssertion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TEXT NOT NULL
);
