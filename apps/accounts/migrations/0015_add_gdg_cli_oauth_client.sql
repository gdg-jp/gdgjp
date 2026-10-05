-- First-party native client used by the gdg command-line tool. Public native
-- clients never have a client secret and Better Auth enforces PKCE for them.
INSERT INTO oauthClient (
  id, clientId, clientSecret, disabled, skipConsent, enableEndSession,
  subjectType, scopes, createdAt, updatedAt, name, redirectUris,
  postLogoutRedirectUris, tokenEndpointAuthMethod, grantTypes, responseTypes,
  public, type, requirePKCE
) VALUES (
  'gdg-cli', 'gdg-cli', NULL, 0, 1, 0,
  'public', '["openid","profile","email","offline_access","https://gdgs.jp/scopes/chapters","https://gdgs.jp/scopes/cli"]',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'GDG Japan CLI', '["http://127.0.0.1:8787/callback"]', '[]', 'none',
  '["authorization_code","refresh_token"]', '["code"]', 1, 'native', 1
) ON CONFLICT(clientId) DO UPDATE SET
  disabled = 0,
  skipConsent = 1,
  enableEndSession = 0,
  scopes = excluded.scopes,
  updatedAt = excluded.updatedAt,
  name = excluded.name,
  redirectUris = excluded.redirectUris,
  postLogoutRedirectUris = excluded.postLogoutRedirectUris,
  tokenEndpointAuthMethod = 'none',
  grantTypes = excluded.grantTypes,
  responseTypes = excluded.responseTypes,
  public = 1,
  type = 'native',
  requirePKCE = 1;
