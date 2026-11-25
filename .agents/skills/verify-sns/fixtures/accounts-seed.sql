-- CLI bearer identities for verify-sns. Apply to the local Accounts D1
-- (gdgjp-accounts-db) after its migrations; migration 0015 already creates the
-- first-party 'gdg-cli' oauthClient. The oauthAccessToken.token column stores
-- base64url(SHA-256(raw token)); callers send the raw token:
--   organizer: sns-verify-cli-organizer-token-0001
--   member:    sns-verify-cli-member-token-0001

INSERT OR IGNORE INTO chapters (id, slug, name, kind) VALUES
  (1, 'dev-chapter', 'GDG Dev Chapter', 'gdg');

INSERT INTO "user" (id, name, email, image, is_admin, created_at, updated_at, email_verified) VALUES
  ('verify-cli-organizer', 'Verify CLI Organizer', 'verify-cli-organizer@verify.invalid', NULL, 0,
   1767225600, 1767225600, 1),
  ('verify-cli-member', 'Verify CLI Member', 'verify-cli-member@verify.invalid', NULL, 0,
   1767225600, 1767225600, 1);

INSERT INTO memberships (user_id, chapter_id, role, status, created_at, approved_at) VALUES
  ('verify-cli-organizer', 1, 'organizer', 'active', 1767225600, 1767225600),
  ('verify-cli-member', 1, 'member', 'active', 1767225600, 1767225600);

INSERT INTO "oauthAccessToken" (id, token, clientId, userId, expiresAt, createdAt, scopes) VALUES
  ('verify-cli-organizer-token', 'fMhQfLLcF-VhgYWfun0Y6FBl2nHxt3yOvLgH2_natxU', 'gdg-cli',
   'verify-cli-organizer', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
   '["openid","https://gdgs.jp/scopes/chapters","https://gdgs.jp/scopes/cli"]'),
  ('verify-cli-member-token', '9YmWPvBygM4ydLAtH2fjG3k7XiNi6W3GKSDcCLvGg_Q', 'gdg-cli',
   'verify-cli-member', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
   '["openid","https://gdgs.jp/scopes/chapters","https://gdgs.jp/scopes/cli"]');
