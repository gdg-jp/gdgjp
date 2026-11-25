# CLAUDE.md — `@gdgjp/gdg-lib`

Repo-wide conventions in `../../CLAUDE.md`. This file = lib-specific only.

Shared RP building blocks for every first-party relying party, plus signed-cookie primitives. The IdP (`accounts/`) uses Better Auth's OAuth Provider plugin and only consumes shared types from this package; do not add IdP-side handlers here.

No build step for workspace consumption: source TS exported directly, bundled by each consumer.

## `pnpm build` — the one exception (external publish only)

`pnpm --filter @gdgjp/gdg-lib build` compiles **only `src/acl/**`** (not the rest of the
package) to `packages/gdg-lib/dist/`, via `scripts/build-publish-package.mjs`. This is not used by
anything inside this monorepo — every in-repo consumer keeps
importing `@gdgjp/gdg-lib/acl/agent` as workspace TS source, unaffected by this build.

It exists solely so `packages/gdg-lib/dist/` can be `npm publish`-ed to GitHub Packages as
**`@gdg-jp/gdg-lib`** (a different, org-scoped name — GitHub Packages requires the scope to
match the owning org) for `xangi`, an external repo that cannot resolve a `file:../gdgjp/gdg-lib`
sibling checkout. See `docs/plans/agents-local-refactoring/13-xangi-packaging.md` and ADR-031.

Do not widen what `build` compiles or what its generated `dist/package.json` exports — it is
deliberately narrower than this package's real `exports` map (`./acl/agent` only,
nothing Workers/React-coupled). `pnpm --filter @gdgjp/gdg-lib test` covers the shape of the
generated manifest (`scripts/build-publish-package.test.ts`); keep it passing when you touch
either script.

## Architecture (from `src/index.ts`)

- `src/auth/cookie.ts` — `signPayload` / `verifyPayload` (HMAC-SHA256 + JSON + base64url) plus cookie I/O (`serializeCookie`, `parseCookies`, `readCookie`, `clearedCookie`). Pure WebCrypto, no Node deps. Used by both this RP factory and by `accounts/`.
- `src/auth/rp.ts` — `initializeRpAuth(config)` factory returning the instance every RP wires under `/api/auth/*` and `/auth/signout*`. Bulk of the package.
- `src/auth/return-to.ts` (`@gdgjp/gdg-lib/auth/return-to`) — `safeReturnTo(value, appUrl)`, the one return-target check for the RP factory and Accounts: it resolves the value against `appUrl` with the URL parser, requires the same origin, and returns the path, query and fragment, or `null`.
- `src/auth/index.ts` — shared types `AuthUser`, `UserClaims`, `UserChapter`, `ChapterRole`; `ClaimsUnavailableError`; `SSO_PROVIDER_ID = "gdgjp"`; generic `getSessionUser` / `requireUser` for any `{ api: { getSession } }`-shaped auth (legacy better-auth callsites).
- `src/auth/bearer.ts` — Bearer-token identity lookups for non-browser (CLI/agent) callers, both backed by Accounts. `getBearerIdentity` is the compatibility path (any valid OAuth client token, resolved via OIDC `/userinfo`, malformed chapter rows dropped individually) — used by connpass and wiki, which predate the CLI scope and must keep their current `/userinfo` semantics. `getCliIdentity` is the strict path (only a `gdg-cli` token carrying the `https://gdgs.jp/scopes/cli` scope, resolved via Accounts' `/api/cli/v1/identity`, whole response rejected on any malformed field) — used by new CLI mutation APIs (tinyurl/img/sns). Both return `client` (`{ id, firstParty }`, from Accounts' `https://gdgs.jp/claims/client` UserInfo claim; `null` when absent or malformed, and `gdg-cli` first-party for the strict path), so a resource server can refuse writes from developer-owned apps (connpass and wiki do). Do not swap connpass/wiki onto the strict helper as a "compatible" refactor; it is a narrower authorization boundary, not a drop-in.
- `src/staging-snapshot.ts` — Durable Object storage snapshot types and helpers behind each app's `StagingSnapshot` entrypoint (`scripts/staging/durable-objects.mjs`). `restoreDurableObject` refuses to run unless `STAGING_SLOT` is set. `src/testing/durable-object.ts` is a test-only `node:sqlite` fake of Durable Object storage (`pnpm check:apps` keeps it out of Worker code).

## RP factory — load-bearing invariants (`rp.ts`)

- **Runtime is Cloudflare Workers, not Node.** `pnpm check:apps` rejects `node:` imports outside tests and `src/testing/`.
- **ID Tokens are mandatory.** Authorization uses PKCE S256, state, and nonce; callback validation passes `idTokenExpected: true` and `expectedNonce`. UserInfo is fetched with the validated ID Token `sub` as `expectedSubject`.
- **Local `user.id` is RP-minted.** Stable external identity is `(oidc_issuer, oidc_subject)`. Verified email is permitted only for a one-time link of legacy rows and conflicts fail closed.
- **The IdP is the only source of truth for who is signed in.** The signed v4 session cookie carries only the RP session ID, local user ID, issuer/subject, the IdP session ID (`sid` from the ID Token) and an expiry — no display or role claims. On every request `getSessionUser` / `requireUser` / `getFreshClaims` (memoized per `Request`) first require the Accounts-issued `gdg_sid` parent-domain cookie to equal `sid` (no network: catches sign-out and account switching), then `POST {idp}/api/rp/v1/session` with client credentials for live claims (catches revocation and role/membership/profile changes). An unreachable IdP throws a 503 `Response` (fail closed). Do not add caches across requests.
- **`idp.fetch` is required** and should be the `ACCOUNTS` service binding: the session check is on every authenticated request.
- **The callback refuses to loop.** It requires a `sid` in the ID Token and the browser to present a matching `gdg_sid`; otherwise it renders an error page instead of restarting sign-in.
- **The local `user` row is an identity link plus a display cache.** `name`/`image` are synced from live claims (only when changed, per-isolate memo). Authorization never reads it, and it has no admin flag.
- **Tokens are server-side.** Access, refresh, and ID tokens live in D1 `oidc_session` and are used only for `getAccessToken` (server-to-server) and logout; refresh-token rotation is persisted with a compare-and-swap update. The IdP deletes them when its session ends.
- **Dev sessions are loopback-only.** `handleDevLogin` (`/dev/login?as=&chapter=<id>:<slug>[:role]&admin=1&return_to=`) mints a v4 cookie carrying its own claims; it 404s and such cookies are ignored unless `appUrl` is localhost/127.0.0.1.
- **Two cookies**: `{cookiePrefix}-session` (30d) and `{cookiePrefix}-oidc-tx` (10m, PKCE verifier + state + nonce + return_to). Prefix is per-app, isolating cookies on the same parent domain.
- **`secure` flips on `appUrl`**: `isLocalAppUrl` strips `Secure` for `localhost`/`127.0.0.1` so `wrangler dev` works over HTTP. Prod stays HTTPS-only.
- **HTTP discovery only for localhost.** `getIssuerConfig` passes `oidc.allowInsecureRequests` only when IdP issuer URL is `http:`. Don't widen.
- **Module-level caches.** Only `issuerCache` (per issuer/client; evicted on rejection) and the display-profile write memo. OIDC HTTP calls have a 10-second bound; the session check has a 3-second bound.
- **An unreachable IdP is a page, not a crash.** When discovery fails (network error, non-2xx, or a body that is not discovery metadata), `/api/auth/signin` and the callback answer 503 with an HTML page that links back to `/api/auth/signin` with the same `return_to`, and clear the transaction cookie.
- **`safeReturnTo`** (`return-to.ts`) enforces same-origin redirect targets. Route new redirect entry points through it; do not write prefix checks such as `startsWith("/")`, which the URL parser defeats (`/<TAB>/host`, `/\host`, `/.//host`).
- **Logout follows RP-Initiated Logout.** Use discovery's `end_session_endpoint`, an `id_token_hint`, and an allowlisted same-origin post-logout redirect.

## Types are an API contract

Changing `AuthUser` / `UserClaims` / `UserChapter` / `ChapterRole` in `src/auth/index.ts` ripples into every RP via `workspace:*`. Run repo-root `pnpm typecheck` and update the IdP `/userinfo` response in `accounts/` in lockstep — `parseClaims` in `rp.ts` bridges the two.

Commit scope: `gdg-lib`.
