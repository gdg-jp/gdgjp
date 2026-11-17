# SSO migration: better-auth → workers-oauth-provider + openid-client

Date: 2026-05-18
Status: landed (#58, #59 merged; one follow-up fix on `main`)

## TL;DR

We rewrote the SSO stack across all five workspaces. The IdP (`accounts/`)
moved off `better-auth`'s `oidcProvider` plugin onto
`@cloudflare/workers-oauth-provider` + a thin OIDC layer. The four RPs
(`tinyurl/`, `wiki/`, `img/`, `scheduler/`) moved off `better-auth`'s
`genericOAuth` plugin onto `openid-client` v6 via a new shared factory
(`initializeRpAuth`) in `gdg-lib/`. `better-auth`, `kysely`, and
`kysely-d1` are fully uninstalled from the repo.

End state:

| | before | after |
| --- | --- | --- |
| IdP library | `better-auth` `oidcProvider` | `@cloudflare/workers-oauth-provider` 0.6 |
| RP library | `better-auth` `genericOAuth` | `openid-client` v6 |
| OAuth-state storage (IdP) | D1 (`oauthApplication`, `oauthAccessToken`, `oauthConsent`) | KV (`OAUTH_KV`) |
| RP session | D1 `session` table | HMAC-signed cookie (`gdgjp-<app>-session`) |
| RP user shape | better-auth's 8-col table | `id, email, name, image, is_admin, created_at, updated_at` |
| IdP login session | better-auth-managed | HMAC-signed cookie (`gdgjp-accounts-session`) |
| id_token | issued | **not issued** — RPs use OAuth 2.1 + `/userinfo` |

## Why we did this

1. We wanted libraries we control more directly and that map cleanly to
   the OIDC spec. `better-auth` was a moving target (1.x) with conventions
   that bled into our schema (camelCase columns, ISO-string timestamps,
   internal session table) and made the IdP code hard to reason about.
2. We wanted to delete a lot of incidental auth schema — every workspace
   carried `user/session/account/verification` (+ on the IdP,
   `oauthApplication/oauthAccessToken/oauthConsent`) even though most of
   those tables only existed to satisfy better-auth's plugin assumptions.
3. The end state lets each app keep only the persistent state it
   genuinely owns: a tiny `user` table for attribution and (on the IdP)
   the domain tables (`chapters`, `memberships`). Sessions are signed
   cookies; OAuth grants/tokens are in KV under the library's control.

## Constraints we hit (and how they shaped the design)

- **`oidc-provider` doesn't run on Workers.** The original request was to
  use `panva/node-oidc-provider`. It depends on Koa, which is a Node-only
  HTTP framework — it cannot run on workerd. We picked
  `@cloudflare/workers-oauth-provider` (Cloudflare's official, workerd-
  native OAuth 2.1 server) instead.
- **`workers-oauth-provider` is OAuth 2.1, not OIDC.** It does not issue
  `id_token`s, has no JWKS, no `/.well-known/openid-configuration`. We
  added a thin OIDC layer on top (~150 LOC): our own discovery document,
  `/userinfo`, and we configure `openid-client` to skip the `id_token`
  expectation (`idTokenExpected: false`). RPs call `/userinfo` to get user
  attributes — there is no `id_token` in this system.
- **Storage split**: the library only supports KV (not D1). OAuth state
  (grants, tokens, clients) lives in `OAUTH_KV`. The user/chapter/
  membership domain data stays in D1.
- **`openid-client` v6 rejects HTTP discovery URLs by default.** For
  localhost dev we gate `{ execute: [oidc.allowInsecureRequests] }` in
  `gdg-lib/src/auth/rp.ts`.
- **D1 wraps every migration in a transaction**, and `PRAGMA
  foreign_keys` is a no-op inside one. This bit us hard (see "Things that
  broke" below) and forced the schema-change migrations to use in-place
  `ALTER TABLE` rather than the classic create-new/drop-old pattern.

## Architecture

### IdP — `accounts/`

```
                ┌──────────────────────────────────────────────────────┐
Request flow →  │  Worker entry (workers/app.ts)                       │
                │    └─ OAuthProvider({ apiRoute, defaultHandler })    │
                │         ├─ defaultHandler  → React Router app        │
                │         │      ├─ /signin, /authorize                │
                │         │      ├─ /oauth/google/start                │
                │         │      ├─ /oauth/google/callback             │
                │         │      ├─ /signout                           │
                │         │      ├─ /.well-known/openid-configuration  │  ← OIDC layer
                │         │      └─ /admin/seed-clients                │
                │         ├─ apiRoute=/userinfo → apiHandler           │  ← OIDC layer
                │         └─ tokenEndpoint=/oauth/token (library)      │
                └──────────────────────────────────────────────────────┘
```

- `OAuthProvider` owns `/authorize`, `/oauth/token`, PKCE,
  refresh-token rotation, client lookup, and the KV-backed grant/token
  storage.
- The OIDC layer (`accounts/app/lib/oauth-provider.server.ts` +
  `accounts/app/routes/well-known.openid-configuration.ts` + the
  `userinfo` apiHandler) layers OIDC on top: discovery doc and a
  `/userinfo` endpoint that re-reads the user row from D1 on every call
  and overlays live chapter membership.
- Google upstream sign-in is implemented directly on `openid-client`
  v6 in `accounts/app/lib/google.server.ts` (the only place we actually
  use an `id_token`, since Google does issue them).
- IdP login session is a 14-day signed cookie (`gdgjp-accounts-session`)
  signed with `IDP_SESSION_SECRET`. No DB-side session storage.
- Authorize-time bootstrap: on first `/authorize` after a fresh
  `OAUTH_KV` (or after a client's redirect URL changes), the route
  catches "Invalid client" / "Invalid redirect URI" and calls
  `seedClients(env)` once before retrying. Removes the chicken-and-egg of
  needing admin auth to register clients before any sign-in works.

### RP — `tinyurl`, `wiki`, `img`, `scheduler`

`openid-client` v6 in standard OIDC code-flow + PKCE mode (with
`idTokenExpected: false`), via `initializeRpAuth` from
`gdg-lib/src/auth/rp.ts`. Returns an object with:

- `getSessionUser(request)` / `requireUser(request)` — read the signed
  session cookie
- `handleAuthRequest(request)` — dispatcher for `/api/auth/signin |
  callback | signout | me`
- `handleSignOutRedirect(request, opts?)` — 302 to the IdP's federated
  sign-out
- `handleSignOutIframe(request)` — clear the RP session from an iframe
  embedded by the IdP's federated sign-out page (CSP-locked to the IdP
  origin)
- `getFreshClaims(request)` — call `/userinfo` with the access token
  from the cookie; refresh the access token via the stored refresh token
  if expired

Session cookie payload (signed HMAC-SHA256, 30-day max age):

```ts
{ userId, email, name, picture, isAdmin,
  accessToken, refreshToken, accessTokenExpiresAt,
  chapters, claimsCacheUntil }
```

Identity model: `upsertUser` looks up the local row **by email** and
mints a fresh UUID for new sign-ins. The IdP's `sub` is **never** used as
the RP user id — existing user UUIDs are preserved on first sign-in
through the new flow, so historical row ownership (e.g. `images.user_id`)
stays valid without data migration.

## Migration sequence

| PR | Branch | What |
| --- | --- | --- |
| #58 | `migrate/sso-pr1-rp-openid-client` | RP-side prep behind `USE_OIDC_CLIENT` flag. New factory shipped, no behaviour change at default. |
| #59 | `migrate/sso-pr2-idp-cutover` | Atomic IdP+RP cutover (endpoint paths change together). Flag removed; better-auth uninstalled; schema migrations land. |
| (main) | direct | Post-merge fixes: cascade-delete bug in migrations, three review-flagged P1s, e2e setup rewrite, lint. |

## Schema changes (per app)

All migrations use **in-place `ALTER TABLE`** to mutate the `user` table.
The original plan used the SQLite "create-new / insert / drop-old /
rename" pattern, which cascade-deleted child rows under D1. See "Things
that broke" below for the full story.

Common to every RP and the IdP:

- Drop `session`, `account`, `verification` (and on the IdP also
  `oauthApplication`, `oauthAccessToken`, `oauthConsent`). These are
  *children* of `user`, so the drop doesn't cascade upward — safe under
  any FK regime.
- Reshape `user` to `{ id, email, name, image, is_admin, created_at,
  updated_at }`:
  - drop `emailVerified`
  - `isAdmin INTEGER` (nullable) → `is_admin INTEGER NOT NULL DEFAULT 0`
  - `createdAt`/`updatedAt` `TEXT` (ISO-8601) → `created_at`/`updated_at`
    `INTEGER` (epoch seconds)

Wiki is slightly different: its starting shape already had INTEGER
timestamps and `isAdmin NOT NULL DEFAULT 0`, so the migration is a
straight rename + column drop. The wiki-specific fields
(`preferredUiLanguage`, `preferredContentLanguage`, `discord_id`) split
out into a new `user_preferences` table (`wiki/migrations/0020`).
Consumers (`discord-reminders`, `fcm`, `settings`, `api.set-{ui,content}-lang`,
`api.discord.ingest`) updated to JOIN `user_preferences`.

### Migration files

| app | migration | does |
| --- | --- | --- |
| accounts | `0011_drop_better_auth.sql` | drop session/account/verification/oauth* + their indexes |
| accounts | `0012_simplify_user.sql` | ALTER user in place |
| tinyurl | `0014_drop_better_auth.sql` | drop session/account/verification |
| tinyurl | `0015_simplify_user.sql` | ALTER user in place |
| img | `0008_drop_better_auth.sql` | drop session/account/verification |
| img | `0009_simplify_user.sql` | ALTER user in place |
| scheduler | `0008_drop_better_auth.sql` | drop session/account/verification |
| scheduler | `0009_simplify_user.sql` | ALTER user in place |
| wiki | `0020_user_preferences.sql` | new table + backfill from user |
| wiki | `0021_drop_better_auth.sql` | drop session/account/verification |
| wiki | `0022_simplify_user.sql` | ALTER user in place (rename + drop only) |

## Secret rename: `BETTER_AUTH_SECRET` → `RP_SESSION_SECRET`

The historical `BETTER_AUTH_SECRET` was repurposed as the cookie HMAC
key for the new RP factory; the name was misleading. Renamed to
`RP_SESSION_SECRET` (mirrors `IDP_SESSION_SECRET` on the IdP side).

Considered (and rejected) integrating into `IDP_CLIENT_SECRET`:

- Rotating an OAuth client secret is routine ops — if it doubled as the
  cookie HMAC, every rotation would forcibly sign out every active RP
  session.
- A leaked client secret would also disclose the cookie HMAC key (and
  vice versa). The two have different audiences: the client secret is
  shared with the IdP, the HMAC key never leaves the RP.

## Required ops to deploy

For each RP (`tinyurl`, `wiki`, `img`, `scheduler`):

```sh
wrangler secret put RP_SESSION_SECRET   # copy the existing BETTER_AUTH_SECRET value
# … deploy …
wrangler secret delete BETTER_AUTH_SECRET   # after the new code is healthy
```

For `accounts`:

```sh
wrangler kv namespace create gdgjp-accounts-oauth
#   → paste the returned id into accounts/wrangler.toml's [[kv_namespaces]] block
wrangler secret put IDP_SESSION_SECRET                  # openssl rand -base64 48
wrangler secret put WIKI_CLIENT_SECRET                  # if not already set
wrangler secret put SCHEDULER_CLIENT_SECRET             # if not already set
# … deploy …
```

Run `pnpm --filter @gdgjp/<app> migrate:remote` for all five apps.

After the IdP is up: sign in as a super-admin and `POST
/admin/seed-clients` (admin-only) to register the four trusted RP
clients in `OAUTH_KV`. The route is idempotent and also auto-fires on
the first `/authorize` request when a client is missing — manual call
is mostly for explicit re-seeds after rotating a client secret.

## Things that broke (and how)

### 1. Cascade-deleted memberships on the IdP

**Symptom:** every row in `accounts.memberships` disappeared after
`migrate:remote` applied `0012_simplify_user.sql`.

**Cause:** the original `0012` used the SQLite "create-new / insert /
drop-old / rename" pattern with `PRAGMA foreign_keys = OFF` at the top.
Per SQLite spec, `PRAGMA foreign_keys` is a **no-op inside a
transaction** — and D1 wraps every migration in one. So FKs stayed
enabled, and `DROP TABLE "user"` cascade-deleted every row in
`memberships` (which has `user_id ... ON DELETE CASCADE`).

**Fix:** rewrote all five `simplify_user` migrations to use in-place
`ALTER TABLE` (ADD/DROP/RENAME COLUMN). Verified by replaying each
migration against synthetic SQLite DBs with `PRAGMA foreign_keys = ON`
and a seeded cascading child — every child row survives.

Other RPs that would have been bitten if migrated before the fix:

- `img.images.user_id` → CASCADE
- `wiki.user_preferences.user_id` → CASCADE (plus
  `notifications`/`fcmTokens`/`googleDriveTokens`/`comments`/`taskAssignees`)
- `tinyurl`, `scheduler` had no cascading FKs.

**Recovery:** restore the affected DB from a pre-migration snapshot. The
restored snapshot brings back the original `user` shape *and* a
`d1_migrations` tracker without 0011/0012, so re-running `migrate:remote`
will apply the new (safe) migrations on a clean slate.

### 2. `openid-client` v6 rejected our dev IdP URL

**Symptom:** every callback failed with `OAUTH_HTTP_REQUEST_FORBIDDEN:
only requests to HTTPS are allowed`, blocking sign-in on every RP in
dev.

**Cause:** openid-client v6 enforces HTTPS for discovery by default.
The dev IdP is at `http://localhost:5173`.

**Fix:** in `gdg-lib/src/auth/rp.ts`'s `getIssuerConfig`, detect HTTP
issuer URLs and pass `{ execute: [oidc.allowInsecureRequests] }` to
`oidc.discovery(...)`. Prod is HTTPS-only; the local override only
kicks in when `issuerUrl.protocol === "http:"`.

### 3. `cloudflare:workers` import broke the accounts dev server

**Symptom:** every request to `accounts` in dev returned a 500 with
`Only URLs with a scheme in: file, data, and node are supported by the
default ESM loader. Received protocol 'cloudflare:'`.

**Cause:** `@cloudflare/workers-oauth-provider`'s runtime entry imports
`cloudflare:workers`. The old `cloudflareDevProxy` runs the worker in
Node, which can't resolve that scheme.

**Fix:** switched `accounts/` to `@cloudflare/vite-plugin` (the same
setup `wiki/` already uses). Bumped `wrangler` to v4 to satisfy the peer
dep; pinned `react-router` to `~7.13.0` to match `wiki/`'s stable
`AppLoadContext` shape (v7.14 flipped the default to
`RouterContextProvider` and requires a class instance); disabled
`v8_middleware` in `react-router.config.ts`; deleted
`workers/context.ts` and moved the `AppLoadContext` augmentation into
`types/env.d.ts`.

### 4. Three P1 correctness/security bugs flagged in code review

All in the RP factory + the IdP's Google-callback path:

- **id_token expected from a non-OIDC provider.** `handleCallback` was
  calling `authorizationCodeGrant(..., { idTokenExpected: true })` and
  reading `tokens.claims()`. `workers-oauth-provider` never issues
  id_tokens, so every callback failed with `Authentication failed`. Fix:
  `idTokenExpected: false`, drop `expectedNonce`, fetch user attributes
  via `oidc.fetchProtectedResource` against `/userinfo`.
- **Wrong subject in `fetchUserClaims`.** `session.userId` is the
  RP-local UUID; the IdP keys `/userinfo` by its own internal sub.
  Passing `session.userId` to `openid-client`'s `fetchUserInfo` (which
  validates `expectedSub === response.sub`) rejected every refresh as
  soon as the two ids differed. Fix: use `fetchProtectedResource` (no
  sub validation) for both callback and refresh. The bearer token alone
  authorises the call against a trusted IdP.
- **`PRAGMA foreign_keys = OFF` no-op** — see "Things that broke" #1.

### 5. Stale `isAdmin` in `getSessionUser` (and `/userinfo`)

**Symptom:** demoted admins kept super-admin powers for up to 14 days
(IdP session cookie max age) or 30 days (OAuth grant TTL on `/userinfo`).

**Fix:** `getSessionUser` and the `/userinfo` apiHandler now re-read the
user row from D1 on every call. The session cookie / grant props are
used only for identity (`userId` / `sub`); `is_admin` and the other
columns come from the row. Returns 401 if the user row was deleted.

### 6. Open redirect on `/oauth/google/start`

**Symptom:** `return_to` query param was passed straight into the signed
tx cookie and used as the post-sign-in 302 target. A crafted
`/oauth/google/start?return_to=https://evil.example` would deliver the
victim to evil.example with a fresh IdP session attached.

**Fix:** wrap the input with `safeReturnTo(...)` from
`~/lib/auth-redirect` — same contract `signin.tsx` already uses
(relative paths + trusted `*.gdgs.jp` absolute URLs only).

### 7. Google id_token missing email accepted as empty string

**Symptom:** `email: typeof claims.email === "string" ? claims.email :
""` would accept missing emails (and `typeof "" === "string"` also lets
empty strings through). The first such user would upsert successfully;
the second would fail on `user.email NOT NULL UNIQUE`.

**Fix:** explicit `typeof === "string" && length > 0` guard in
`google.server.ts`; throw if missing or empty.

### 8. E2E suites needed rewrites

- **tinyurl/e2e/home.spec.ts** asserted `/signin?return_to=…%2Flinks`,
  matching the old single-app sign-in flow. After the cutover the
  redirect chain ends on the IdP's `/signin` (localhost:5173) with
  `return_to=%2Fauthorize…`. Updated the regex to anchor on the IdP
  origin.
- **wiki/tests/e2e/global-setup.ts** was inserting users with the old
  schema (`emailVerified`, camelCase timestamps) and seeding sessions
  into the dropped `session` table, then writing a `gdgjp-wiki.session_token`
  cookie that better-auth used to validate. Rewritten to insert into
  the new snake_case `user` shape and write an HMAC-signed
  `gdgjp-wiki-session` cookie signed with `RP_SESSION_SECRET` from
  `.dev.vars`. Node's `crypto.createHmac("sha256", secret)` produces an
  identical signature to the WebCrypto path the dev server verifies
  with.
- **CI matrix** still excludes `wiki` from e2e (its tests pre-existed
  with strict-mode selector violations + state-contamination across
  tests; tracked separately).

## Files of interest

### gdg-lib

- `src/auth/cookie.ts` — HMAC-SHA256 sign/verify + cookie serialisation
- `src/auth/rp.ts` — `initializeRpAuth` (PKCE authorize, callback,
  refresh, federated sign-out iframe)
- `src/auth/index.ts` — shared types (`AuthUser`, `UserClaims`,
  `ClaimsUnavailableError`)
- (removed) `src/auth/server.ts`, `src/auth/client.ts` — better-auth
  factories

### accounts

- `app/lib/oauth-provider.server.ts` — `OAuthProvider` config +
  `getOAuthHelpers` accessor + `userinfo` apiHandler
- `app/lib/idp-session.server.ts` — signed-cookie IdP login session
- `app/lib/google.server.ts` — Google upstream via `openid-client`
- `app/lib/seed-clients.server.ts` — KV client seeder (called by the
  admin route and as a fallback from `authorize.tsx`)
- `app/lib/federated-signout.server.ts` — federated sign-out HTML
- `app/routes/authorize.tsx`, `oauth.google.start.ts`,
  `oauth.google.callback.ts`, `well-known.openid-configuration.ts`,
  `admin.seed-clients.tsx`
- `workers/app.ts` — wraps RR7 with `OAuthProvider.fetch`

### Each RP

- `app/lib/auth.server.ts` — calls `initializeRpAuth`
- `app/routes/api.auth.$.ts` — catch-all → `handleAuthRequest`
- `app/routes/auth.signout.ts` — `handleSignOutRedirect`
- `app/routes/auth.signout-iframe.ts` — `handleSignOutIframe`
- `app/routes/signin.tsx` — server-redirect to `/api/auth/signin`

## Open / deferred

- The remaining 5 wiki e2e tests are flaky on UI assertions (strict-mode
  selector violations, state contamination across tests). The auth
  machinery is sound; these are app-level test brittleness.
- CI's e2e matrix still excludes `wiki` (see
  `.github/workflows/ci.yml`).
- The `accounts` `BETTER_AUTH_SECRET` wrangler secret can be deleted
  post-deploy (the IdP no longer reads it; renamed/repurposed for the
  RPs).
- Schema dumps for the user table are slightly less tidy after the
  rewrite — SQLite's `.schema` appends `ALTER TABLE ADD COLUMN` results
  inline rather than reformatting. The semantics (NOT NULL, defaults,
  types) are preserved; cosmetic only.
