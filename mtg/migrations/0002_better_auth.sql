CREATE TABLE "user" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "email"         TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image"         TEXT,
  "createdAt"     TEXT NOT NULL,
  "updatedAt"     TEXT NOT NULL,
  "isAdmin"       INTEGER
);

CREATE TABLE "session" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TEXT NOT NULL,
  "token"     TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId"    TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id"                     TEXT NOT NULL PRIMARY KEY,
  "accountId"              TEXT NOT NULL,
  "providerId"             TEXT NOT NULL,
  "userId"                 TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"            TEXT,
  "refreshToken"           TEXT,
  "idToken"                TEXT,
  "accessTokenExpiresAt"   TEXT,
  "refreshTokenExpiresAt"  TEXT,
  "scope"                  TEXT,
  "password"               TEXT,
  "createdAt"              TEXT NOT NULL,
  "updatedAt"              TEXT NOT NULL
);

CREATE TABLE "verification" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "expiresAt"  TEXT NOT NULL,
  "createdAt"  TEXT NOT NULL,
  "updatedAt"  TEXT NOT NULL
);

CREATE INDEX "session_userId_idx"          ON "session" ("userId");
CREATE INDEX "account_userId_idx"          ON "account" ("userId");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
