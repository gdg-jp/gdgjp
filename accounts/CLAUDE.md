# CLAUDE.md — `@gdgjp/accounts`

OIDC IdP at accounts.gdgs.jp. Repo-wide conventions in `../CLAUDE.md`.

## Architecture — IdP, not a normal RR7 app

`workers/app.ts` does NOT mount RR directly. It wraps RR in `@cloudflare/workers-oauth-provider`:

```
request → OAuthProvider.fetch
  ├─ /oauth/token, /oauth/register  → handled by the lib
  ├─ /userinfo                      → apiHandler (validates bearer, calls our handler)
  └─ everything else                → defaultHandler = RR7 SSR
```

Provider built once per `env.APP_URL` (cached on module) so env changes between deploys take effect. `buildOAuthOptions` in `app/lib/oauth-provider.server.ts` is the single source of truth for endpoint paths, TTLs, scopes — read by both `workers/app.ts` and route loaders (via `getOAuthHelpers(env)`).

Two credential systems side-by-side — don't conflate:

| | IdP login session | OAuth grants & tokens |
|---|---|---|
| What | Who's signed into accounts.gdgs.jp | RP access to the IdP |
| Mechanism | Signed cookie (`idp-session.server.ts`, HMAC `IDP_SESSION_SECRET`) | `@cloudflare/workers-oauth-provider` |
| Storage | Cookie only, no server row | `OAUTH_KV` |
| Used by | RR loaders (`getSessionUser`/`requireUser` in `app/lib/auth.server.ts`) | `/authorize`, `/oauth/token`, `/userinfo` |

`getSessionUser` reads `is_admin` (and name/image) **fresh from D1 on every call** — the cookie is identity-only. Otherwise a 14d cookie would let demoted admins keep super-admin powers. `/userinfo` does the same: `props` is grant-time snapshot, can be up to `refreshTokenTTL` (30d) stale → re-fetch row per call.

## OAuth flow

1. RP redirects user to `/authorize?...` → `routes/authorize.tsx`.
2. No IdP session: redirect to `/signin` → `/oauth/google/start` → Google → `/oauth/google/callback`. These are **Google-as-upstream**, NOT OAuthProvider endpoints.
3. Callback creates/updates `user` in D1, sets signed IdP-session cookie, bounces back to `/authorize`.
4. `/authorize` calls `oauthHelpers.completeAuthorization({ props: GrantProps, userId: sub, ... })`. `GrantProps` (`sub`, `email`, `name`, `picture`, `isAdmin`) becomes `ctx.props` on every later `/userinfo`.
5. RP exchanges code at `/oauth/token` (lib-handled), calls `/userinfo` with bearer.

`scopes_supported = openid email profile offline_access`. `allowImplicitFlow` + `allowPlainPKCE` both off. **Dynamic client registration is intentionally disabled** — `clientRegistrationEndpoint` omitted because RPs are pre-seeded.

## Trusted clients are seeded, not registered

Four RPs pre-registered in `OAUTH_KV` by `app/lib/seed-clients.server.ts`, invoked via `/admin/seed-clients` route (super-admin gated). Reading the client list at request time is the lib's job — our code never touches KV directly for clients.

Client IDs + redirect URLs in `wrangler.toml [vars]` as `<APP>_CLIENT_ID` / `<APP>_REDIRECT_URLS`. Client secrets in `.dev.vars` (local) / `wrangler secret put` (prod). **After changing any of these, run `/admin/seed-clients`** — change doesn't take effect until KV re-seeded.

Adding a new RP: add `<APP>_CLIENT_ID` + `<APP>_REDIRECT_URLS` to `wrangler.toml [vars]`, `<APP>_CLIENT_SECRET` to `.dev.vars.example` + local `.dev.vars` (+ `wrangler secret put` for prod), extend `seed-clients.server.ts`, re-run `pnpm cf-typegen`, hit `/admin/seed-clients` after deploy.

## Schema (D1 `gdgjp-accounts-db`)

Only three tables (see `schema.sql`):

- `user` — id (text, Google `sub`), email, name, image, `is_admin`, timestamps.
- `chapters` — GDG/GDGoC, `kind ∈ {gdg, gdgoc}`, unique `slug`.
- `memberships` — `(user_id, chapter_id)` composite PK, `role ∈ {organizer, member}`, `status ∈ {pending, active}`. Multi-chapter per user allowed (migration 0006).

Migration history is non-trivial: better-auth added (0002) and removed (0011); `user` was simplified **in place via ALTER** (0012, commit `1f5590c`) because dropping it would cascade-delete memberships. **Don't add a migration that recreates `user`** — keep using ALTER.

## Bindings & secrets

- `DB` — D1 `gdgjp-accounts-db`
- `OAUTH_KV` — KV for OAuth grants/tokens/clients (id `31a011bcae0944b483e8919f339fdbe3`)
- `ASSETS` — static assets from `./build/client`

Secrets (`wrangler secret put` / `.dev.vars`): `GOOGLE_CLIENT_SECRET`, `IDP_SESSION_SECRET` (HMAC; `openssl rand -base64 48`), `RESEND_API_KEY`, one `<APP>_CLIENT_SECRET` per RP.

## Commands

```
pnpm --filter @gdgjp/accounts dev / test / test:e2e
pnpm --filter @gdgjp/accounts migrate:local    # also regenerates schema.sql
pnpm --filter @gdgjp/accounts migrate:remote
pnpm --filter @gdgjp/accounts cf-typegen       # after wrangler.toml binding/var changes
```

Single test: `pnpm --filter @gdgjp/accounts exec vitest run <path>` / `exec playwright test <spec>`.
