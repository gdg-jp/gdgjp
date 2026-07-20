# CLAUDE.md — `@gdgjp/gdg-lib`

Repo-wide conventions in `../CLAUDE.md`. This file = lib-specific only.

Shared RP building blocks for the four downstream apps (`tinyurl`, `img`, `scheduler`, `wiki`), plus signed-cookie primitives. The IdP (`accounts/`) uses Better Auth's OAuth Provider plugin and only consumes shared types from this package; do not add IdP-side handlers here.

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
- **ID Tokens are mandatory.** Authorization uses PKCE S256, state, and nonce; callback validation passes `idTokenExpected: true` and `expectedNonce`. UserInfo is fetched with the validated ID Token `sub` as `expectedSubject`.
- **Local `user.id` is RP-minted.** Stable external identity is `(oidc_issuer, oidc_subject)`. Verified email is permitted only for a one-time link of legacy rows and conflicts fail closed.
- **Tokens are server-side.** The signed session cookie carries only a random session ID and display identity. Access, refresh, and ID tokens live in D1 `oidc_session`; refresh-token rotation is persisted with a compare-and-swap update.
- **Two cookies**: `{cookiePrefix}-session` (30d) and `{cookiePrefix}-oidc-tx` (10m, PKCE verifier + state + nonce + return_to). Prefix is per-app, isolating cookies on the same parent domain.
- **`secure` flips on `appUrl`**: `isLocalAppUrl` strips `Secure` for `localhost`/`127.0.0.1` so `wrangler dev` works over HTTP. Prod stays HTTPS-only.
- **HTTP discovery only for localhost.** `getIssuerConfig` passes `oidc.allowInsecureRequests` only when IdP issuer URL is `http:`. Don't widen.
- **Module-level caches.** `issuerCache` (per issuer/client) and `inflightClaims` (per session ID; dedupes concurrent UserInfo work within one isolate). Discovery promise evicted on rejection so transient failures don't poison the isolate.
- **`getFreshClaims` persists rotation in D1.** Concurrent isolates recover by re-reading the winning token row.
- **`safeReturnTo`** enforces same-origin redirect targets. Route new redirect entry points through it.
- **Logout follows RP-Initiated Logout.** Use discovery's `end_session_endpoint`, an `id_token_hint`, and an allowlisted same-origin post-logout redirect.

## Types are an API contract

Changing `AuthUser` / `UserClaims` / `UserChapter` / `ChapterRole` in `src/auth/index.ts` ripples into every RP via `workspace:*`. Run repo-root `pnpm typecheck` and update the IdP `/userinfo` response in `accounts/` in lockstep — `parseClaims` in `rp.ts` bridges the two.

Commit scope: `gdg-lib`.
