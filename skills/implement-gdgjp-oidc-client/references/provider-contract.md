# GDG Japan accounts OIDC contract

This reference summarizes the implementation in `accounts/` as of the repository version that
contains this skill. Prefer issuer discovery at runtime and the current source when editing this
repository.

## Issuer and endpoints

- Production issuer: `https://accounts.gdgs.jp` without a trailing slash.
- Discovery: `/.well-known/openid-configuration`.
- Current endpoints: `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token`,
  `/api/auth/oauth2/userinfo`, `/api/auth/jwks`, and `/api/auth/oauth2/end-session`.
- ID tokens use asymmetric RS256 keys. Resolve keys and algorithms through discovery/JWKS rather
  than pinning a copied key.
- Access tokens expire after 1 hour; refresh tokens expire after 30 days. Treat discovery and token
  responses as authoritative if settings change.

## Client profile

The self-service developer portal issues confidential web clients with fixed settings:

- token endpoint authentication: `client_secret_basic`
- grant types: `authorization_code`, `refresh_token`
- response type: `code`
- PKCE: required; use `S256`
- subject type: `public`
- end-session support: enabled
- dynamic client registration: disabled

An active chapter member creates and manages individually owned clients at `/developers/apps`.
Client management API routes are authenticated account-management endpoints, not RFC dynamic
registration endpoints and not something a relying party calls during sign-in. A client secret is
returned only on creation or rotation. Rotating it invalidates the previous deployment secret;
changing scopes, disabling a client, or loss of developer eligibility can revoke tokens.

Redirect and post-logout URI rules:

- Use HTTPS, except HTTP is accepted for `localhost`, `127.0.0.1`, and `[::1]` development URLs.
- Do not include URL credentials or fragments.
- Register exact URLs, including scheme, host, port, path, and relevant trailing slash.
- Register 1–10 callback URLs and at most 10 post-logout URLs.

## Scopes and claims

Allowed scopes:

| Scope | Purpose |
| --- | --- |
| `openid` | Required OIDC identity scope; accounts adds it if omitted at registration. |
| `email` | Email and email-verification claims. |
| `profile` | Name and picture claims. |
| `offline_access` | Refresh-token access when an app session must outlive the access token. |
| `https://gdgs.jp/scopes/chapters` | Live GDG chapter and administrator claims. |

With the chapter scope, ID Token and UserInfo may include:

- `https://gdgs.jp/claims/chapters`: array of
  `{ chapterId: number, chapterSlug: string, role: "organizer" | "member" }`.
- `https://gdgs.jp/claims/is_admin`: boolean platform-administrator flag.

Membership data is read when claims are minted. Always tolerate an empty chapter array. Use
`(iss, sub)` as the stable external identity. Email, name, picture, membership, and admin state are
mutable attributes, not identity keys.

Request `offline_access` only when the app needs refresh tokens for durable sessions. It is not
required merely to receive chapter claims; an app with a short session can reauthenticate after its
access token expires.

## Protocol invariants

- Generate a fresh state, nonce, PKCE verifier, and S256 challenge for each authorization request.
- Bind transaction state to the initiating browser and expire it quickly.
- Require an ID token and validate it with the library's full OIDC checks.
- Call UserInfo with the access token and bind its `sub` to the validated ID-token `sub`.
- Authenticate token and refresh requests with HTTP Basic through the OIDC library.
- Store OAuth tokens only on the server and handle refresh-token rotation as a compare-and-swap or
  otherwise serialized update.
- Use discovery's end-session endpoint with `id_token_hint`; clear the local session even if remote
  logout is unavailable.
