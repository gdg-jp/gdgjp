# CLAUDE.md — `@gdgjp/gdg-lib`

Repo-wide conventions in `../CLAUDE.md`. This file = lib-specific only.

Shared RP building blocks for the four downstream apps (`tinyurl`, `img`, `scheduler`, `wiki`), plus signed-cookie primitives used by both sides. **The IdP (`accounts/`) does NOT consume this lib** — it's built directly on `@cloudflare/workers-oauth-provider`. Do not add IdP-side handlers here.

No build step: source TS exported directly (`"main": "./src/index.ts"`), bundled by each consumer. No `lint`/`build`/`dev` scripts here — those run at root via Turborepo + Biome.

```
pnpm --filter @gdgjp/gdg-lib typecheck
pnpm --filter @gdgjp/gdg-lib test
pnpm --filter @gdgjp/gdg-lib exec vitest run src/auth/cookie.test.ts   # single file
```

## Architecture (from `src/index.ts`)

- `src/auth/cookie.ts` — `signPayload` / `verifyPayload` (HMAC-SHA256 + JSON + base64url) plus cookie I/O (`serializeCookie`, `parseCookies`, `readCookie`, `clearedCookie`). Pure WebCrypto, no Node deps. Used by both this RP factory and by `accounts/`.
- `src/auth/rp.ts` — `initializeRpAuth(config)` factory returning the instance every RP wires under `/api/auth/*` and `/auth/signout*`. Bulk of the package.
- `src/auth/index.ts` — shared types `AuthUser`, `UserClaims`, `UserChapter`, `ChapterRole`; `ClaimsUnavailableError`; `SSO_PROVIDER_ID = "gdgjp"`; generic `getSessionUser` / `requireUser` for any `{ api: { getSession } }`-shaped auth (legacy better-auth callsites).

## RP factory — load-bearing invariants (`rp.ts`)

- **Runtime is Cloudflare Workers, not Node.** Vitest env is `"node"` but deploy target is Workers — use `crypto.subtle`, `D1Database`, `fetch`. Avoid Node-only APIs.
- **`idTokenExpected: false`.** accounts IdP (workers-oauth-provider) is OAuth 2.1, no `id_token`. Identity from `/userinfo`. `oidc.authorizationCodeGrant` MUST pass `idTokenExpected: false`. `nonce` isn't validated against id_token — only round-tripped for parity.
- **Local `user.id` is RP-minted, not the IdP's `sub`.** `upsertUser` looks up by email and mints a UUID for new users so IDs survive resets. Consequence: `/userinfo` is fetched via `oidc.fetchProtectedResource` (no sub-equality check), **not** `oidc.fetchUserInfo` (which would reject because `session.userId` ≠ IdP `sub`).
- **Cookies are the only session store.** No `session` table on the RP. Signed session cookie carries `accessToken`/`refreshToken`/`accessTokenExpiresAt`/`chapters`. RP only needs a `"user"` table (id, email, name, image, is_admin, created_at, updated_at).
- **Two cookies**: `{cookiePrefix}-session` (30d) and `{cookiePrefix}-oidc-tx` (10m, PKCE verifier + state + nonce + return_to). Prefix is per-app, isolating cookies on the same parent domain.
- **`secure` flips on `appUrl`**: `isLocalAppUrl` strips `Secure` for `localhost`/`127.0.0.1` so `wrangler dev` works over HTTP. Prod stays HTTPS-only.
- **HTTP discovery only for localhost.** `getIssuerConfig` passes `oidc.allowInsecureRequests` only when IdP issuer URL is `http:`. Don't widen.
- **Module-level caches.** `issuerCache` (per issuer URL) and `inflightClaims` (per userId; dedupes concurrent `/userinfo` within one isolate). Discovery promise evicted on rejection so transient failures don't poison the isolate.
- **`getFreshClaims` cannot write cookies.** Runs in loaders with no response access — refreshed access token is in-memory only, not persisted. The cached `accessTokenExpiresAt` in the session drives refresh.
- **`safeReturnTo`** enforces same-origin redirect targets. Route new redirect entry points through it.
- **`handleSignOutIframe`** is called from the IdP's federated sign-out page inside an iframe. CSP `frame-ancestors` is locked to IdP origin — don't weaken.

## Types are an API contract

Changing `AuthUser` / `UserClaims` / `UserChapter` / `ChapterRole` in `src/auth/index.ts` ripples into every RP via `workspace:*`. Run repo-root `pnpm typecheck` and update the IdP `/userinfo` response in `accounts/` in lockstep — `parseClaims` in `rp.ts` bridges the two.

Commit scope: `gdg-lib`.
