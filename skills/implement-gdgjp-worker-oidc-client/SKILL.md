---
name: implement-gdgjp-worker-oidc-client
description: Implement, migrate, or review GDG Japan OIDC authentication in a Cloudflare Worker or React Router v7 app in this monorepo using @gdgjp/gdg-lib. Use when wiring accounts.gdgs.jp sign-in, auth routes, Wrangler bindings and secrets, D1 OIDC session tables, app-local users, fresh chapter claims, service-binding transport, or RP-Initiated Logout. Do not use this repo-only pattern for an unrelated third-party codebase that cannot import the private workspace package.
---

# Implement a GDG Japan Worker OIDC client

Use the shared `initializeRpAuth` factory. Do not add Better Auth, duplicate OpenID Client handlers,
or place IdP-side handlers in `gdg-lib`.

## Workflow

1. Inspect the target package's `package.json`, `wrangler.toml`, environment types, route registry,
   user schema, auth helpers, protected loaders/actions, and tests.
2. Read [worker-pattern.md](references/worker-pattern.md) before editing. Compare with `tinyurl/` for
   service-binding transport and `wiki/` for auth helper and live-claim authorization patterns.
3. Add `@gdgjp/gdg-lib: workspace:*` if absent. Reuse the existing `openid-client` dependency through
   the shared package; do not implement protocol primitives in the app.
4. Configure `APP_URL`, `IDP_URL`, and `IDP_CLIENT_ID` as non-secret Worker vars. Configure
   `RP_SESSION_SECRET` and `IDP_CLIENT_SECRET` as Wrangler secrets and declare them in `Env`.
5. Add an app-unique cookie prefix and initialize one cached RP instance per Worker environment.
   Pass an `ACCOUNTS` service-binding fetch transport when the binding exists.
6. Register `${APP_URL}/api/auth/callback/gdgjp` and the intended logout return URL at
   `https://accounts.gdgs.jp/developers/apps`. Keep local loopback URLs as separate registrations
   when needed. Use the accounts trusted-client seed workflow only when the product owner explicitly
   classifies the app as a platform-owned first-party client.
7. Add the app-local `user` identity columns/index and `oidc_session` table in a new forward-only D1
   migration. Preserve domain foreign keys and existing user IDs.
8. Mount a catch-all route under `/api/auth/*` for both loader and action. Add an app-facing sign-out
   route that calls `handleSignOutRedirect`.
9. Replace route-local password or Better Auth logic with `getSessionUser`/`requireUser`. Use
   `getFreshClaims` for live chapter authorization and redirect to sign-in when claims are
   unavailable.
10. Run the package's narrow unit tests, typecheck, and migration checks; then run repository-wide
    tests and typecheck when the package is stable.

## Preserve these invariants

- Keep stable external identity as `(oidc_issuer, oidc_subject)` and local `user.id` app-owned.
- Keep access, refresh, and ID tokens in D1; signed cookies contain only session/display identity.
- Preserve mandatory ID tokens, state, nonce, PKCE S256, subject-bound UserInfo, refresh rotation,
  same-origin return URLs, per-app cookie names, 10-second OIDC HTTP bounds, and HTTPS outside local
  development.
- Treat cached session identity as display/session data. Fetch live claims before membership or
  administrator authorization that must reflect revocation promptly.
- Keep secrets out of `wrangler.toml`, `.dev.vars.example` values, logs, loader data, and browser
  bundles.

## Validation

- Test `/api/auth/signin`, callback success/failure, `/api/auth/me`, local sign-out, and IdP logout.
- Test missing, expired, and tampered transaction/session cookies.
- Test initial user creation, verified-email legacy linking, identity collision, and repeat sign-in.
- Test access-token refresh, rotated refresh persistence, concurrent refresh, IdP timeout, and
  unavailable UserInfo.
- Confirm migration foreign keys and indexes, then run the narrow package test and typecheck commands
  described by its `CLAUDE.md`/`package.json`.

## Source of truth

Use `gdg-lib/src/auth/rp.ts` for RP behavior, `gdg-lib/src/auth/index.ts` for claims, and
`accounts/app/lib/auth.server.ts` for issuer settings. Update shared behavior and all consumers in
lockstep when the contract changes.
