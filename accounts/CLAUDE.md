# CLAUDE.md — `@gdgjp/accounts`

OIDC identity provider at accounts.gdgs.jp. Repo-wide conventions are in `../CLAUDE.md`.

## Authentication architecture

React Router mounts Better Auth at `/api/auth/*`. `app/lib/auth.server.ts` is the single source of
truth for Google sign-in, sessions, OAuth/OIDC endpoints, token lifetimes, scopes, and claims. The
provider is the current `@better-auth/oauth-provider`, not Better Auth's deprecated
`oidcProvider` plugin.

The issuer is the `APP_URL` origin. Discovery advertises:

- `/.well-known/openid-configuration`
- `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token`, `/api/auth/oauth2/userinfo`
- `/api/auth/jwks` (RS256) and `/api/auth/oauth2/end-session`

Only authorization-code + refresh-token grants are enabled. PKCE S256 is required. Dynamic client
registration is disabled. First-party clients have `skipConsent` and `enableEndSession` set by the
admin-only `/admin/seed-clients` route.

Active chapter members can create individually owned confidential web clients through
`/developers/apps`. `app/lib/oauth-clients.server.ts` is the authorization and validation boundary:
it fixes clients to `client_secret_basic`, authorization code + refresh token, PKCE, and the allowed
scope set. Self-service clients skip consent by product policy. Client secrets are returned only by
create/rotate responses, which must retain `Cache-Control: no-store`.

Chapter authorization uses the dedicated `https://gdgs.jp/scopes/chapters` scope. UserInfo and ID
tokens include `https://gdgs.jp/claims/chapters` and `https://gdgs.jp/claims/is_admin` only when that
scope was granted. Memberships are read fresh from D1 when claims are minted.

## Storage and schema

D1 contains Better Auth's core session/social-account tables, OAuth clients/tokens/consents, JWKS,
and the domain-owned `user`, `chapters`, and `memberships` tables. Trusted client secrets are stored
as SHA-256 hashes in `oauthClient`; source secrets remain Wrangler secrets.

Migration history is non-trivial: Better Auth was added in 0002, removed in 0011, and restored with
the current provider in 0013. Migration 0014 installs membership triggers that disable individually
owned clients and revoke their tokens when their owner loses their final active membership. The
`user` table must only be changed in place: dropping/recreating it can cascade-delete `memberships`
under D1's migration transaction behavior.

## Bindings and secrets

- `DB`: D1 `gdgjp-accounts-db`
- `ASSETS`: static assets from `./build/client`
- Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, and one
  `<APP>_CLIENT_SECRET` per trusted RP

After changing a client ID, secret, redirect URI, or post-logout URI, deploy and run
`/admin/seed-clients` again.

## Commands

```sh
pnpm --filter @gdgjp/accounts dev
pnpm --filter @gdgjp/accounts test
pnpm --filter @gdgjp/accounts typecheck
pnpm --filter @gdgjp/accounts migrate:local
pnpm --filter @gdgjp/accounts migrate:remote
```
