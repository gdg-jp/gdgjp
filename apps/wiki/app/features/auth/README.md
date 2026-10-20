# auth

Relying-party auth for accounts.gdgs.jp (OAuth client `wiki`). No local password store.

- `auth.server.ts` — `createAuth(env)` / `initializeRpAuth`; session cookie `gdgjp-wiki-session`.
- `utils.server.ts` — request-time helpers: `getAccessIdentity` and live-claims lookups (gdg-lib checks the accounts session once per request).
- `redirect.ts` — `buildSignInRedirect` / `safeReturnTo` (pure, client-safe).

The `user` row is only an identity link and display cache: `is_admin` there is no longer maintained — authorize with `user.isAdmin` / `getFreshClaims()`, which are live.
