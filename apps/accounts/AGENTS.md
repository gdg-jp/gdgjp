# CLAUDE.md — `@gdgjp/accounts`

OIDC identity provider at accounts.gdgs.jp. Repo-wide conventions are in `../../CLAUDE.md`.

## Authentication architecture

React Router mounts Better Auth at `/api/auth/*`. `app/features/auth/auth.server.ts` is the single source of
truth for Google sign-in, sessions, OAuth/OIDC endpoints, token lifetimes, scopes, and claims. The
provider is the current `@better-auth/oauth-provider`, not Better Auth's deprecated
`oidcProvider` plugin.

The issuer is the `APP_URL` origin. Discovery advertises:

- `/.well-known/openid-configuration`
- `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token`, `/api/auth/oauth2/userinfo`
- `/api/auth/jwks` (RS256) and `/api/auth/oauth2/end-session`

Only authorization-code + refresh-token grants are enabled. PKCE S256 is required. Dynamic client
registration is disabled. First-party clients have `skipConsent` and `enableEndSession` set by the
admin-only `/admin/seed-clients` route.

Active chapter members can create individually owned confidential web clients through
`/developers/apps`. `app/features/developer-apps/oauth-clients.server.ts` is the authorization and validation boundary:
it fixes clients to `client_secret_basic`, authorization code + refresh token, PKCE, and the allowed
scope set. Client secrets are returned only by create/rotate responses, which must retain
`Cache-Control: no-store`.

A developer-owned client (non-NULL `oauthClient.userId`) follows the per-app grant model: it is
created with `skipConsent = 0`, Better Auth asks for consent at `/oauth/consent` and stores it in
`oauthConsent`, and the grant survives sign-out and session expiry. Users list and remove these
grants at `/settings/connected-apps` (`features/oauth/connected-apps.server.ts`), which deletes that
user's pending authorization codes, consent, access tokens, and refresh tokens for the client in one
batch. Seeded first-party clients keep skipping consent and lose their tokens with the session.

The `oauthConsent` row is the grant, and migration 0025 keeps that rule in D1:

- `BEFORE INSERT` triggers abort a developer-owned client's access or refresh token when the token's
  user has no consent row for the client (message `developer client token without consent`), and
  abort any such refresh token that names a resource. A code exchange or refresh rotation that
  straddles a removal fails there. `runAuthHandler` answers that abort at the token endpoint with
  400 `invalid_grant` ("grant revoked during token issuance"); Better Auth is configured with
  `onAPIError.throw` so that the error reaches it, and every other unexpected error stays a bare 500.
- A grant is also bound to the consent it was issued under. An `AFTER INSERT` trigger on
  `verification` records each developer-client authorization code issued while the user's consent
  exists, and stores no resource, in `developerClientGrantCode` (keyed by Better Auth's hashed code
  identifier, which it copies into `authorizationCodeId` through refresh rotations). The token
  triggers also abort a token whose `authorizationCodeId` has no record for its user and client.
  Removing the last consent deletes the records, so a code or refresh token read before a removal
  cannot mint tokens even when the user approves the app again in between.
- An `AFTER DELETE` trigger on `oauthConsent` deletes the user's access tokens, refresh tokens and
  pending authorization codes (and their grant-code records) for a developer-owned client when the
  last consent row for that user and client goes, whichever path deletes it (connected apps, Better Auth's `oauth2/delete-consent`,
  admin revocation). Duplicate consent rows keep the grant until the last one goes. A user deletion
  cascades through it; a client deletion cascades the tokens by foreign key and leaves its pending
  codes, which no longer name a client.
- The migration deletes every existing developer-client token and pending authorization code, with
  or without a consent row, because all of them predate this model, and keeps consent rows. Users
  without consent see the consent page at their next sign-in through the app.

Scope coverage is deliberately not enforced on token inserts: Better Auth replaces a consent's scopes
when the user approves a request for scopes it does not cover, so an app that asks for different
scope sets at different times legitimately holds tokens wider than its current consent row.

Admin revocation (`revokeUserSessions`) deletes the user's developer-client consent rows in its batch
as well as every token and session. `setUserAdmin` deletes tokens and sessions so claims are minted
afresh but keeps consent: changing the admin flag is not the user withdrawing a grant.

Developer clients must only ever get opaque, row-backed access tokens. `runAuthHandler`
(`features/oauth/developer-client-resource.server.ts`) refuses a `resource` parameter at the
authorization and token endpoints with `invalid_target` unless the request identifies exactly one
first-party client the way Better Auth does: a POST authorization request from its form body, a GET
from its query, and a token request from Better Auth's own Basic-credential decoder, refusing an
undecodable or non-Basic Authorization header, client assertions, and conflicting client IDs. It
also refuses a developer client's authorization-code exchange when the stored code carries a
resource, which Better Auth would otherwise inherit and answer with a JWT.
Because a JWT could still exist (issued before this change, or from a code or signed authorization
query that stored a resource), `features/oauth/developer-client-tokens.server.ts` also answers a
developer client's JWT (by its `azp`) with 401 `invalid_token` at UserInfo and `{"active": false}` at
introspection. Other apps accept Accounts access tokens only through UserInfo
(`packages/gdg-lib/src/auth/bearer.ts`), so this covers them too.

Deploy the code before applying migration 0025. Between the two, the new Worker still issues
developer-client tokens without consent (existing clients keep `skipConsent = 1`); the migration
then deletes them. Applying the migration first is not fully closed: the old Worker has no resource
gate and no JWT refusal, so it can still issue a developer client a JWT access token that reads
UserInfo until it expires (one hour) or the new Worker is deployed, whichever comes first, and a
client that the old console creates in between keeps `skipConsent = 1`, so its users are never asked
and the triggers refuse its tokens until `skipConsent` is set to 0.

## Single sign-on state for `*.gdgs.jp`

Relying parties never trust their own cookie alone. `workers/app.ts` runs
`features/auth/sso-cookie.server.ts` on every response to keep a `gdg_sid` cookie
(`Domain=gdgs.jp`, HttpOnly; host-only on localhost) equal to the browser's live Better Auth
session ID, and ends a session that a new sign-in replaced. Each first-party RP compares it with
the `sid` its session was bound to and calls `POST /api/rp/v1/session`
(`features/oauth/rp-session.server.ts`; first-party client credentials + `{ sid, sub }`) for live
claims on every authenticated request. The `session_end_revokes_oauth_tokens` trigger (migration
0023, replaced by 0025) deletes a session's OAuth tokens when the session row is deleted, except for
device-grant (CLI) clients and developer-owned clients. Admin revocation (`revokeUserSessions`,
`setUserAdmin`) still deletes every token of the user explicitly; `revokeUserSessions` also deletes
the user's developer-client consents.

UserInfo always returns `https://gdgs.jp/claims/client` (`CLIENT_CLAIM`): `{ id, first_party }` for
the client the access token was issued to, so resource servers can tell a first-party app from a
developer-owned one. ID tokens do not carry it.

Chapter authorization uses the dedicated `https://gdgs.jp/scopes/chapters` scope. UserInfo and ID
tokens include `https://gdgs.jp/claims/chapters` and `https://gdgs.jp/claims/is_admin` only when that
scope was granted. Memberships are read fresh from D1 when claims are minted.

## Storage and schema

D1 contains Better Auth's core session/social-account tables, OAuth clients/tokens/consents, JWKS,
and the domain-owned `user`, `chapters`, and `memberships` tables. Trusted client secrets are stored
as SHA-256 hashes in `oauthClient`; source secrets remain Wrangler secrets.

Migration history is non-trivial: Better Auth was added in 0002, removed in 0011, and restored with
the current provider in 0013. Migration 0014 installs membership triggers that disable individually
owned clients and revoke their tokens when their owner loses their final active membership. The
`user` table must only be changed in place: dropping/recreating it can cascade-delete `memberships`
under D1's migration transaction behavior.

## Bindings and secrets

- `DB`: D1 `gdgjp-accounts-db`
- `ASSETS`: static assets from `./build/client`
- Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, and one
  `<APP>_CLIENT_SECRET` per trusted RP

After changing a client ID, secret, redirect URI, or post-logout URI, deploy and run
`/admin/seed-clients` again.

## Commands

```sh
pnpm --filter @gdgjp/accounts dev
pnpm --filter @gdgjp/accounts test
pnpm --filter @gdgjp/accounts typecheck
pnpm --filter @gdgjp/accounts migrate:local
pnpm --filter @gdgjp/accounts migrate:remote
```
