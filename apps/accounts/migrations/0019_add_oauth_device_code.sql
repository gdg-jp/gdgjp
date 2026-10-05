-- RFC 8628 device authorization grant storage. deviceCode/userCode are
-- stored as SHA-256 hashes (never the raw values) so a leaked D1 row can't
-- be used to claim a pending device login. authorizationCode holds the
-- one-time authorization_code minted by the provider on approve (never the
-- final access/refresh tokens); the token endpoint exchanges it for real
-- tokens at poll time and never persists the result. ipHash is a SHA-256 of
-- the requesting IP, used only to cap pending rows per address.
CREATE TABLE oauthDeviceCode (
  id TEXT NOT NULL PRIMARY KEY,
  deviceCodeHash TEXT NOT NULL UNIQUE,
  userCodeHash TEXT NOT NULL UNIQUE,
  clientId TEXT NOT NULL REFERENCES oauthClient (clientId) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  codeVerifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'denied', 'completed')),
  userId TEXT REFERENCES "user" (id) ON DELETE CASCADE,
  authorizationCode TEXT,
  intervalSeconds INTEGER NOT NULL DEFAULT 5,
  lastPolledAt TEXT,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  ipHash TEXT
);
CREATE INDEX oauthDeviceCode_expiresAt_idx ON oauthDeviceCode (expiresAt);
CREATE INDEX oauthDeviceCode_clientId_idx ON oauthDeviceCode (clientId);
CREATE INDEX oauthDeviceCode_ipHash_idx ON oauthDeviceCode (ipHash);
