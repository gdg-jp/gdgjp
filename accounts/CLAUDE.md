# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repo-wide conventions (monorepo layout, Biome, Conventional Commits, CI matrix) live in `../CLAUDE.md`. This file covers what's specific to `@gdgjp/accounts` — the OIDC IdP at accounts.gdgs.jp.

## Architecture: IdP, not a normal RR7 app

The Worker entry (`workers/app.ts`) does **not** mount React Router directly. It wraps it in `@cloudflare/workers-oauth-provider`:

```
request → OAuthProvider.fetch
            ├─ /oauth/token, /oauth/register  → handled internally by the lib
            ├─ /userinfo                      → apiHandler (validates bearer, calls our handler)
            └─ everything else                → defaultHandler = React Router (RR7 framework SSR)
```

The provider is built once per `env.APP_URL` (cached on the module) so secrets/env changes between deploys take effect. `buildOAuthOptions` (`app/lib/oauth-provider.server.ts`) is the single source of truth for endpoint paths, TTLs, and scopes — both `workers/app.ts` (server-side OAuthProvider) and route loaders (via `getOAuthHelpers(env)`) read it.

Two distinct credential systems live side by side; don't conflate them:

| Concept | Mechanism | Storage | Used by |
|---|---|---|---|
| **IdP login session** (who is signed into accounts.gdgs.jp) | Signed cookie via `idp-session.server.ts`, HMAC'd with `IDP_SESSION_SECRET` | Cookie only — no server row | RR7 loaders (`getSessionUser`/`requireUser` in `app/lib/auth.server.ts`) |
| **OAuth grants & tokens** (RP access to the IdP) | `@cloudflare/workers-oauth-provider` | `OAUTH_KV` namespace | `/authorize`, `/oauth/token`, `/userinfo` |

`getSessionUser` reads `is_admin` (and name/image) fresh from D1 on every call — the cookie is identity-only — because a 14-day cookie would otherwise let demoted admins keep super-admin powers. The `/userinfo` handler does the same: `props` is a snapshot from grant time and can be up to `refreshTokenTTL` (30 days) stale, so the row is re-fetched per call.

## OAuth flow (end-to-end)

1. RP (e.g. tinyurl) redirects user to `/authorize?...` — handled by `routes/authorize.tsx`.
2. If no IdP session: redirect to `/signin` → `/oauth/google/start` → Google → `/oauth/google/callback` (these are NOT OAuthProvider endpoints; they're Google-as-upstream-IdP for accounts' own login).
3. Callback creates/updates the `user` row in D1, sets the signed IdP-session cookie, and bounces back to `/authorize`.
4. `/authorize` calls `oauthHelpers.completeAuthorization({ props: GrantProps, userId: sub, ... })`. `GrantProps` (`sub`, `email`, `name`, `picture`, `isAdmin`) becomes `ctx.props` on every later `/userinfo` call.
5. RP exchanges code at `/oauth/token` (handled by the lib), then calls `/userinfo` with the bearer.

`scopes_supported` advertises `openid email profile offline_access`. `allowImplicitFlow` and `allowPlainPKCE` are both off. **Dynamic client registration is intentionally disabled** — `clientRegistrationEndpoint` is omitted because RPs are pre-seeded.

## Trusted clients are seeded, not registered

The four RP apps (tinyurl, wiki, img, scheduler) are pre-registered in `OAUTH_KV` by `app/lib/seed-clients.server.ts`, invoked via the `/admin/seed-clients` route (super-admin gated). Reading the client list at request time is the lib's job — our code never touches KV directly for client lookups.

Client IDs and redirect URLs live in `wrangler.toml` under `[vars]` as `<APP>_CLIENT_ID` / `<APP>_REDIRECT_URLS`. Client **secrets** live in `.dev.vars` (local) and `wrangler secret put` (prod). After changing any of these, **run the `/admin/seed-clients` admin route** — the change does NOT take effect until you re-seed KV.

When adding a new RP app: add `<APP>_CLIENT_ID`, `<APP>_REDIRECT_URLS` to `wrangler.toml [vars]`, `<APP>_CLIENT_SECRET` to `.dev.vars.example` and your local `.dev.vars` (+ `wrangler secret put` for prod), extend `seed-clients.server.ts`, re-run `pnpm cf-typegen`, and hit `/admin/seed-clients` after deploy.

## Schema (D1: `gdgjp-accounts-db`)

Only three tables (see `schema.sql`, regenerated from migrations):

- `user` — id (text, comes from Google `sub`), email, name, image, `is_admin`, timestamps.
- `chapters` — GDG / GDGoC chapters, `kind ∈ {gdg, gdgoc}`, `slug` unique.
- `memberships` — `(user_id, chapter_id)` composite PK, `role ∈ {organizer, member}`, `status ∈ {pending, active}`. Multi-chapter per user is allowed (migration 0006).

Migration history is non-trivial: better-auth tables were added (0002) and later removed (0011), and the `user` schema was simplified in place via ALTER (0012, see commit `1f5590c`) rather than recreated, because dropping it would cascade-delete memberships. **Don't add a migration that recreates `user`** — keep using ALTER.

## Bindings cheat sheet

- `DB` — D1, `gdgjp-accounts-db`
- `OAUTH_KV` — KV namespace for OAuth grants/tokens/clients (id `31a011bcae0944b483e8919f339fdbe3`)
- `ASSETS` — static assets from `./build/client`

Secrets (`wrangler secret put` in prod, `.dev.vars` locally): `GOOGLE_CLIENT_SECRET`, `IDP_SESSION_SECRET` (HMAC key for the login cookie — generate with `openssl rand -base64 48`), `RESEND_API_KEY`, and one `<APP>_CLIENT_SECRET` per RP.

## App-local commands

Run from repo root or `accounts/`:

```
pnpm --filter @gdgjp/accounts dev
pnpm --filter @gdgjp/accounts test
pnpm --filter @gdgjp/accounts test:e2e
pnpm --filter @gdgjp/accounts migrate:local     # also regenerates schema.sql
pnpm --filter @gdgjp/accounts migrate:remote
pnpm --filter @gdgjp/accounts cf-typegen        # after wrangler.toml binding/var changes
```

Single Vitest: `pnpm --filter @gdgjp/accounts exec vitest run app/lib/permissions.test.ts`.
Single Playwright: `pnpm --filter @gdgjp/accounts exec playwright test e2e/home.spec.ts`.
