-- Allow the native CLI client to use the device authorization grant
-- (RFC 8628) in addition to authorization_code/refresh_token. This grant
-- type is not known to the vendored oauth-provider plugin; it is only
-- checked as an application-level allowlist in device-authorization.server.ts.
UPDATE oauthClient
SET grantTypes = '["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:device_code"]',
    updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE clientId = 'gdg-cli';
