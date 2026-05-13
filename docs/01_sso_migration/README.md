# SSO Migration

A staged migration to align the gdgjp SSO setup with OIDC/OAuth2 standards and strip the better-auth tables/columns that the RPs do not use.

## Context

The IdP is `accounts/` (better-auth `oidcProvider`); the RPs are `tinyurl/`, `img/`, `scheduler/` (better-auth `genericOAuth`). `wiki/` has no auth wiring yet and is out of scope.

An SSO audit (see prior session) identified 10 non-conformances. They fall into four milestones, executed in separate PRs.

## Library constraints (better-auth 1.6.9)

| Concern | Status |
|---|---|
| `oidcProvider` exposes `/api/auth/oauth2/endsession` with `id_token_hint`, `client_id`, `post_logout_redirect_uri` validation | ✅ |
| `oidcProvider` Back-Channel Logout (`logout_token` POSTs) | ❌ not implemented |
| `genericOAuth` requires the `account` table (writes a row at every callback) | ❌ can't drop the table |
| `verification` table is only written by email-verify/magic-link plugins (we don't load those at RPs) | ✅ safe to drop |
| `genericOAuth` user linking key | email (not `sub`); but `account.accountId` already holds the IdP `sub` |
| `storeClientSecret: "hashed"` (SHA-256) | ✅ supported; no built-in rotation |

## Confirmed decisions

- **Logout strategy:** OIDC RP-Initiated Logout (top-level redirect chain). The iframe-cookie federated logout is decommissioned in M3.
- **`account` table at RPs:** strip unused columns only. Drop `password`. Keep `idToken` (used for `id_token_hint`), `accessToken`/`refreshToken`/expiry (used by `getFreshClaims` and img's `accountId` lookup).
- **First implementation slice:** M1 only.

## Milestones

| ID | Title | Audit items | Status |
|---|---|---|---|
| [M1](./M1.md) | P0 bugs + low-risk schema cleanup | #1, #2, #9, slice of #10 | shipped (#48) |
| [M2](./M2.md) | Claim modeling | #4, #5 (#6 deferred) | shipped (#49) |
| [M3](./M3.md) | RP-Initiated Logout (replace iframes) | #3 | this PR |
| [M4](./M4.md) | Userinfo cache + secret hashing | #7, #8 | deferred |

## Out of scope

- Wiki app's auth wiring.
- Rekeying existing FK rows (`links.owner_user_id`, etc.) onto IdP `sub`.
- Replacing better-auth.
- Back-Channel Logout.
