-- The native CLI uses the standard OIDC userinfo endpoint for wiki sync.
-- Grant the existing profile, email, and chapter claims scopes in addition to
-- the CLI scope used for native-client session management.
UPDATE oauthClient
SET scopes = '["openid","profile","email","offline_access","https://gdgs.jp/scopes/chapters","https://gdgs.jp/scopes/cli"]',
    updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE clientId = 'gdg-cli';
