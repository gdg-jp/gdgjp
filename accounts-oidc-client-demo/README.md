# GDG Accounts OIDC Client Demo

This is a deliberately independent OpenID Connect relying party. It does not import
`gdg-lib`, any other workspace package, or use a Cloudflare service binding.

## Configuration

1. Deploy once with `pnpm --filter @gdgjp/accounts-oidc-client-demo run deploy`.
2. Register an OIDC confidential web client in GDG Accounts using:
   - Redirect URI: `https://gdgjp-accounts-oidc-client-demo.<account>.workers.dev/auth/callback`
   - Post-logout redirect URI: `https://gdgjp-accounts-oidc-client-demo.<account>.workers.dev/`
   - Scopes: `openid email profile https://gdgs.jp/scopes/chapters`
3. Set the client ID and secrets, then deploy again:

```sh
pnpm --filter @gdgjp/accounts-oidc-client-demo exec wrangler secret put IDP_CLIENT_SECRET
pnpm --filter @gdgjp/accounts-oidc-client-demo exec wrangler secret put SESSION_SECRET
pnpm --filter @gdgjp/accounts-oidc-client-demo run deploy
```

Set `IDP_CLIENT_ID` in `wrangler.jsonc` to the value issued by Accounts before the
second deployment. For local development, copy `.dev.vars.example` to `.dev.vars`.

The Worker stores no data in D1 or KV. It encrypts short-lived OIDC transactions and
the eight-hour local session in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
