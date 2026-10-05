-- Additive Google Workspace OAuth linking (separate from the login-only
-- Google sign-in in Better Auth's own `account` table). See
-- docs/agents-local-gws/01-accounts-workspace-link.md.
--
-- googleWorkspaceOauthState: short-lived, single-use rows for the
-- incremental-consent start/callback round trip. `id` is the `state` value
-- itself. Consumed (and expired rows swept) via a one-shot
-- `DELETE ... RETURNING`, the same idiom oauthDeviceCode's completed-poll
-- claim uses, so two racing callbacks for the same state can't both succeed.
CREATE TABLE googleWorkspaceOauthState (
  id TEXT NOT NULL PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  codeVerifier TEXT NOT NULL,
  returnTo TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX googleWorkspaceOauthState_expiresAt_idx ON googleWorkspaceOauthState (expiresAt);

-- googleWorkspaceConnection: one row per user holding the encrypted Google
-- refresh token for the additive Workspace grant. Ciphertext format:
-- AES-GCM, a random 96-bit nonce generated per row (never reused), and
-- `userId` bound in as AAD (authenticated but not encrypted) so a ciphertext
-- copied onto a different user's row fails to decrypt. `encryptionKeyVersion`
-- selects which Wrangler-secret key (GOOGLE_WORKSPACE_ENCRYPTION_KEY,
-- or GOOGLE_WORKSPACE_ENCRYPTION_KEY_V<n> after a rotation) decrypts the row;
-- rotation re-encrypts under the new key the next time the row is written
-- (reconnect), not in place.
CREATE TABLE googleWorkspaceConnection (
  userId TEXT NOT NULL PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  refreshTokenCiphertext TEXT NOT NULL,
  refreshTokenNonce TEXT NOT NULL,
  encryptionKeyVersion INTEGER NOT NULL,
  scope TEXT NOT NULL,
  connectedAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  revokedAt TEXT
);

-- Audit trail for the privileged token-vending endpoint
-- (api.agents.google-workspace-token.ts). No token material is ever logged.
CREATE TABLE googleWorkspaceTokenAudit (
  id TEXT NOT NULL PRIMARY KEY,
  callerUserId TEXT NOT NULL,
  targetUserId TEXT NOT NULL,
  outcome TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX googleWorkspaceTokenAudit_caller_createdAt_idx
  ON googleWorkspaceTokenAudit (callerUserId, createdAt);

-- Fixed-window rate-limit counter for the same endpoint, one row per caller.
-- Reserving quota is a single atomic `INSERT ... ON CONFLICT ... RETURNING`
-- (see reserveTokenVendQuota in google-workspace.server.ts) rather than a
-- separate count-then-insert-audit-row pair, so concurrent requests from a
-- leaked gdgagent-svc credential can't all observe "under the limit" and all
-- proceed.
CREATE TABLE googleWorkspaceTokenRateLimit (
  callerUserId TEXT NOT NULL PRIMARY KEY,
  windowStart INTEGER NOT NULL,
  count INTEGER NOT NULL
);
