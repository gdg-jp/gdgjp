# auth

Relying-party auth for accounts.gdgs.jp (OAuth client `wiki`). No local password store.

- `auth.server.ts` — `createAuth(env)` / `initializeRpAuth`; session cookie `gdgjp-wiki-session`.
- `utils.server.ts` — request-time helpers: `getAccessIdentity`, fresh-claims lookups, chapter-claim cache.
- `redirect.ts` — `buildSignInRedirect` / `safeReturnTo` (pure, client-safe).

Caveat: `is_admin` on the `user` row is the value at last sign-in — use `getFreshClaims()` for authz.
