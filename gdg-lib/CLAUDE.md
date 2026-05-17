# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repo-wide conventions live in `../CLAUDE.md` (monorepo layout, Biome rules, Conventional Commits, Turborepo commands). This file only covers what is specific to `@gdgjp/gdg-lib`.

## What this package is

The shared **Relying Party (RP)** building blocks for the four downstream apps (`tinyurl`, `img`, `scheduler`, `wiki`) that delegate sign-in to the `accounts/` IdP. Plus the signed-cookie primitives used by both sides.

**The IdP itself does not consume this lib.** `accounts/` is built directly on `@cloudflare/workers-oauth-provider`. Code here should serve the RP factory and the shared cookie helpers — do not add IdP-side handlers here.

## Commands

This package has no build step. Source `.ts` files are exported directly (`"main": "./src/index.ts"`) and bundled by each consuming app.

```
pnpm --filter @gdgjp/gdg-lib typecheck     # tsc --noEmit
pnpm --filter @gdgjp/gdg-lib test          # vitest run (node env)
pnpm --filter @gdgjp/gdg-lib test:watch    # vitest

# Single test file
pnpm --filter @gdgjp/gdg-lib exec vitest run src/auth/cookie.test.ts
```

There is no `lint` / `build` / `dev` script on this package — those run at the monorepo root via Turborepo, and Biome runs across all workspaces.

## Architecture

Two concerns, exported from `src/index.ts`:

1. **`src/auth/cookie.ts`** — `signPayload` / `verifyPayload` (HMAC-SHA256 over JSON, base64url) plus cookie I/O (`serializeCookie`, `parseCookies`, `readCookie`, `clearedCookie`). Pure WebCrypto, no Node deps. Used by both the RP factory here *and* by the IdP in `accounts/`.

2. **`src/auth/rp.ts`** — `initializeRpAuth(config)` factory returning the RP instance every consuming app wires under `/api/auth/*` and `/auth/signout*`. This is the bulk of the package.

3. **`src/auth/index.ts`** — shared types (`AuthUser`, `UserClaims`, `UserChapter`, `ChapterRole`), `ClaimsUnavailableError`, `SSO_PROVIDER_ID = "gdgjp"`, and a generic `getSessionUser` / `requireUser` helper that takes any `{ api: { getSession } }`-shaped auth (kept for legacy `better-auth` callsites).

### RP factory — load-bearing invariants

When editing `rp.ts`, several non-obvious things must hold:

- **Runtime is Cloudflare Workers, not Node.** Use `crypto.subtle`, `D1Database`, `fetch`. The vitest env is `"node"` but the actual deploy target is Workers — avoid Node-only APIs.
- **`idTokenExpected: false`.** The accounts IdP (workers-oauth-provider) is OAuth 2.1 and does not issue `id_token`s. Identity comes from `/userinfo`, not from a JWT. If you call `oidc.authorizationCodeGrant` you must pass `idTokenExpected: false`, and `nonce` cannot be validated against an id_token (it's only round-tripped for parity).
- **Local `user.id` is RP-minted, not the IdP's `sub`.** `upsertUser` looks up by email and mints a UUID for new users so existing IDs stay stable across resets. As a consequence, `/userinfo` is fetched with `oidc.fetchProtectedResource` (no sub-equality check), **not** `oidc.fetchUserInfo` (which would reject because our `session.userId` ≠ IdP `sub`).
- **Cookies are the only session store.** No `session` table on the RP. The signed session cookie carries `accessToken`/`refreshToken`/`accessTokenExpiresAt`/`chapters`. The only auth-related table the RP needs is `"user"` (id, email, name, image, is_admin, created_at, updated_at).
- **Two cookies**: `{cookiePrefix}-session` (30d) and `{cookiePrefix}-oidc-tx` (10m, PKCE verifier + state + nonce + return_to). The prefix is per-app and isolates cookies between apps on the same parent domain.
- **`secure` flag flips on `appUrl`**: `isLocalAppUrl` strips `Secure` for `localhost`/`127.0.0.1` so `wrangler dev` works over HTTP. Production stays HTTPS-only.
- **HTTP discovery is allowed only for localhost.** `getIssuerConfig` passes `oidc.allowInsecureRequests` only when the IdP issuer URL is `http:`. Don't widen this.
- **Module-level caches.** `issuerCache` (per issuer URL) and `inflightClaims` (per userId, dedupes concurrent `/userinfo` calls within one isolate). The discovery promise is evicted on rejection so a transient failure doesn't poison the isolate.
- **`getFreshClaims` cannot write cookies.** It runs in loaders without access to a response, so a refreshed access token is used in-memory only — it isn't persisted back to the session cookie. The cached `accessTokenExpiresAt` in the session drives whether to refresh.
- **`safeReturnTo`** enforces same-origin redirect targets. If you add new redirect entry points, route them through it.
- **`handleSignOutIframe`** is called from the IdP's federated sign-out page inside an iframe. Its CSP `frame-ancestors` is locked to the IdP origin — don't weaken it.

### Types are an API contract

Changing `AuthUser`, `UserClaims`, `UserChapter`, or `ChapterRole` in `src/auth/index.ts` ripples into every RP app via `workspace:*`. Run `pnpm typecheck` at the repo root (or against each consumer) when touching these shapes, and update the IdP's `/userinfo` response in `accounts/` in lockstep — `parseClaims` in `rp.ts` is what bridges the two.

## Conventional Commits scope

Use `gdg-lib` as the scope for changes here: `feat(gdg-lib): …`, `fix(gdg-lib): …`.
