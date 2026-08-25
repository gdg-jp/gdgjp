# @gdgjp/accounts

OAuth 2.0 / OIDC identity provider for GDG Japan, deployed at `accounts.gdgs.jp`. Every other
relying-party app (`tinyurl`, `img`, `scheduler`, `sns`, `wiki`, `pay`, plus the `agents` service
and the `gdg` CLI) authenticates its users against this service instead of implementing sign-in
itself; see `gdg-lib/README.md` for the RP-side integration.

## Architecture

React Router v7 SSR on Cloudflare Workers. Authentication is Better Auth (`better-auth` +
`@better-auth/oauth-provider`), mounted at `/api/auth/*` — not the community
`@cloudflare/workers-oauth-provider` package. `app/lib/auth.server.ts` is the single source of
truth for Google sign-in, sessions, OAuth/OIDC endpoints, token lifetimes, scopes, and claims.

Discovery and protocol endpoints:

| Path | Purpose |
| --- | --- |
| `/.well-known/openid-configuration`, `/.well-known/oauth-authorization-server` | Discovery documents |
| `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token`, `/api/auth/oauth2/userinfo` | Core OAuth/OIDC endpoints |
| `/api/auth/jwks` | RS256 JWKS (rotated monthly, 30-day grace period) |
| `/api/auth/oauth2/end-session` | RP-Initiated Logout |
| `/authorize`, `/oauth/token`, `/userinfo`, `/oauth/consent` | Legacy-path compatibility routes kept alive across the provider cutover |
| `/device` | RFC 8628 device authorization grant (used by the `gdg` CLI) |

Only `authorization_code` and `refresh_token` grants are enabled (plus the device grant, handled
separately since the plugin doesn't support it natively); PKCE S256 is required and dynamic client
registration is disabled. First-party clients (the trusted RPs above) get `skipConsent` and
`enableEndSession` via the admin seeding flow below. Active chapter members can additionally
self-register individually owned confidential clients through `/developers/apps`, gated by
`app/lib/oauth-clients.server.ts`.

Chapter membership is exposed to RPs only under the dedicated
`https://gdgs.jp/scopes/chapters` scope, which adds `https://gdgs.jp/claims/chapters` and
`https://gdgs.jp/claims/is_admin` to the ID token / UserInfo response, read fresh from D1 at
token-mint time.

Beyond the IdP role, this app also owns:

- **Chapter/membership administration** — `chapters` and `memberships` tables, `admin/chapters`,
  `admin/users`, `admin/requests` routes.
- **Google Workspace linking** — an incremental-consent OAuth flow independent of Better Auth
  (`app/lib/google-workspace.server.ts`) that stores encrypted Workspace refresh tokens and vends
  short-lived tokens to the `agents` service via `api/agents/google-workspace-token`.

## Directory structure

```
app/routes/           admin.*, oauth.*, developers.apps.*, well-known.*, device.tsx, api.*
app/lib/               auth.server.ts (Better Auth config), oauth-clients.server.ts,
                        seed-clients.server.ts, device-authorization.server.ts,
                        google-workspace.server.ts, permissions.ts, db.ts
migrations/            D1 migrations (schema.sql is generated — do not hand-edit)
openapi/               OpenAPI spec for the OAuth/OIDC + admin surface (redocly-bundled)
workers/app.ts          Worker entrypoint
e2e/                    Playwright tests
```

## Cloudflare bindings

| Binding | Type | Notes |
| --- | --- | --- |
| `DB` | D1 (`gdgjp-accounts-db`) | Better Auth core tables, OAuth clients/tokens/consents, JWKS, plus domain `user`, `chapters`, `memberships` |
| `ASSETS` | Static assets | Serves `./build/client` |

There is no KV, R2, or Queues binding — state lives entirely in D1.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in secrets. Required:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_SECRET` | Google sign-in (client ID is a public var in `wrangler.toml`) |
| `BETTER_AUTH_SECRET` | Better Auth signing/encryption key |
| `GOOGLE_WORKSPACE_ENCRYPTION_KEY` | AES-256 key encrypting stored Workspace refresh tokens |
| `TINYURL_CLIENT_SECRET`, `WIKI_CLIENT_SECRET`, `IMG_CLIENT_SECRET`, `SCHEDULER_CLIENT_SECRET`, `SNS_CLIENT_SECRET`, `AGENTS_CLIENT_SECRET`, `PAY_CLIENT_SECRET` | One per trusted RP, written into D1 by `/admin/seed-clients` |
| `RESEND_API_KEY` | Transactional email |
| `APP_URL`, `*_REDIRECT_URLS` | Overridden to `localhost` origins/ports so OIDC callbacks resolve locally instead of to prod hostnames |

```sh
pnpm --filter @gdgjp/accounts dev
```

## Commands

```sh
pnpm --filter @gdgjp/accounts dev              # react-router dev
pnpm --filter @gdgjp/accounts build            # react-router build
pnpm --filter @gdgjp/accounts deploy           # wrangler deploy
pnpm --filter @gdgjp/accounts typecheck        # wrangler types && react-router typegen && tsc --noEmit
pnpm --filter @gdgjp/accounts test             # vitest run
pnpm --filter @gdgjp/accounts test:e2e         # playwright test
pnpm --filter @gdgjp/accounts migrate:local    # wrangler d1 migrations apply --local, then dump schema.sql
pnpm --filter @gdgjp/accounts migrate:remote   # wrangler d1 migrations apply --remote, then dump schema.sql
pnpm --filter @gdgjp/accounts cf-typegen       # wrangler types only
```

`typecheck` reads `Env` var types generated from `wrangler.toml`, so it needs a `.dev.vars` file
present even though none of its values are read at type-check time; CI seeds one from
`.dev.vars.example` before running this app's typecheck step.

## Seeding trusted OAuth clients

`/admin/seed-clients` (admin-only, POST) upserts each configured `<APP>_CLIENT_ID` /
`<APP>_CLIENT_SECRET` / `<APP>_REDIRECT_URLS` triple into D1's `oauthClient` table via
`app/lib/seed-clients.server.ts`. It's idempotent — safe to re-run — and stores only a SHA-256
hash of the client secret; the plaintext lives solely as a Wrangler secret on this Worker and on
the RP.

Run it (deploy first, so the new vars are live) whenever a trusted RP's client ID, client secret,
or redirect/post-logout URI changes:

1. Update the `<APP>_CLIENT_ID` / `<APP>_REDIRECT_URLS` vars in `wrangler.toml` if needed.
2. `wrangler secret put <APP>_CLIENT_SECRET` on this Worker (and set the matching
   `IDP_CLIENT_SECRET` on the RP).
3. `pnpm --filter @gdgjp/accounts deploy`.
4. Sign in as an admin and submit the form at `/admin/seed-clients`.

## Testing

Unit tests (Vitest) sit beside the code they cover as `app/**/*.test.ts` — auth config, device
authorization, Google Workspace linking, client seeding, permissions, and most routes each have
one. `e2e/home.spec.ts` covers the sign-in page with Playwright. Run the narrowest relevant test
during development, then `pnpm lint`, `pnpm typecheck`, and `pnpm test` from the repo root.
