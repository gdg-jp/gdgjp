---
name: implement-gdgjp-oidc-client
description: Implement or review a server-side OpenID Connect relying party for the GDG Japan accounts provider at accounts.gdgs.jp. Use for third-party web apps that need GDG Japan sign-in, OIDC client registration, callback and logout routes, token/session storage, refresh handling, standard profile claims, or GDG chapter membership authorization. Use the Worker-specific companion skill instead for apps in this monorepo that can consume @gdgjp/gdg-lib.
---

# Implement a GDG Japan OIDC client

Build a confidential server-side web client with a maintained OIDC library. Preserve the provider's
security contract instead of hand-writing OAuth or JWT processing.

## Workflow

1. Inspect the target framework, deployment origin, callback route, logout return route, session
   store, secret store, and existing user model.
2. Read [provider-contract.md](references/provider-contract.md) before choosing scopes or changing
   authentication code.
3. Register the app at `https://accounts.gdgs.jp/developers/apps`. Use the exact production callback
   and post-logout URLs. Capture the issued secret immediately and place it in the deployment's
   secret manager; never commit or expose it to browser code.
4. Configure the OIDC library from issuer discovery. Use authorization code flow, PKCE S256, state,
   nonce, and `client_secret_basic`. Request only the registered scopes the app needs.
5. Implement a sign-in route that creates a short-lived, browser-bound transaction containing the
   PKCE verifier, state, nonce, and a validated same-origin return path.
6. Implement the callback with exact redirect-URI matching. Require and validate the ID token,
   including issuer, audience, signature, expiry, nonce, and subject. Fetch UserInfo with the access
   token and require its `sub` to equal the validated ID-token subject.
7. Key external identity by `(issuer, sub)`, not email. Permit email-based linking only as an
   explicit, one-time migration with verified email and fail closed on conflicts.
8. Keep access, refresh, and ID tokens server-side. Put only an opaque session identifier in a
   `Secure`, `HttpOnly`, `SameSite=Lax` cookie. Persist refresh-token rotation atomically.
9. Implement local logout plus RP-Initiated Logout from discovery. Send an ID-token hint and only a
   pre-registered, same-origin post-logout return URI.
10. Test the success path and every trust boundary in the checklist below.

## Authorization

Treat authentication and authorization separately. Request the chapter scope only when the app
needs live GDG chapter roles. Read its namespaced claims from validated ID tokens or UserInfo, and
refresh UserInfo before security-sensitive authorization decisions. Do not authorize from email,
display name, or an indefinitely cached claim.

## Required tests

- Reject state, nonce, issuer, audience, signature, expiry, and `sub` mismatches.
- Reject unregistered callbacks and open redirects in sign-in and logout return parameters.
- Verify PKCE S256 and `client_secret_basic`; never place the secret in an authorization URL.
- Exercise access-token expiry, refresh success, refresh rotation, refresh failure, and revocation.
- Verify concurrent refreshes cannot overwrite a newly rotated refresh token.
- Verify cookies are isolated per app and no OAuth token reaches browser storage or logs.
- Verify chapter access disappears when fresh claims no longer contain the required membership.

## Repository sources

When this repository is available, resolve uncertainty from `accounts/app/lib/auth.server.ts` and
`accounts/app/lib/oauth-clients.server.ts`. Update this skill if those contracts change; do not infer
new provider behavior from stale examples.
