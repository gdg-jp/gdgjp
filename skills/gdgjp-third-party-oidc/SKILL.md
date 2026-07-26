---
name: gdgjp-third-party-oidc
description: Integrate a third-party application with GDG Japan Accounts using OpenID Connect. Use when adding GDG Japan Accounts sign-in, registering an OIDC client with the GDG CLI, implementing OIDC login callbacks, validating identity tokens and UserInfo, or adding application-local logout.
---

# GDG Japan Third-Party OIDC

Integrate only through the published OIDC protocol and the GDG CLI. Do not depend on GDG Japan internal source code or non-public implementation details.

## Register the client

Determine the public application URL and exact HTTPS callback URI before registering. Use a separate registration for each independently deployed application.

Run the GDG CLI:

```sh
gdg accounts oidc-client create \
  --name "Example application" \
  --app-url "https://app.example.com" \
  --redirect-uri "https://app.example.com/auth/callback" \
  --post-logout-redirect-uri "https://app.example.com/"
```

Store the returned client secret only in the application's secret configuration. Never commit it, emit it in logs, or expose it to a browser. A client ID is not secret.

## Implement sign-in

1. Obtain endpoints and signing-key metadata through OIDC discovery for `https://accounts.gdgs.jp`; do not hard-code endpoint paths or signing keys.
2. Start Authorization Code flow with PKCE `S256`, a high-entropy state value, and a nonce. Request `openid` and only the additional scopes the application needs.
3. Store the PKCE verifier, state, nonce, and a short expiration in an authenticated, browser-bound transaction. Use the registered callback URI exactly.
4. On the callback, reject missing or expired transactions, provider errors, state mismatch, nonce mismatch, and code-exchange failures. Consume the transaction whether the callback succeeds or fails.
5. Validate the ID token signature and claims, including issuer, audience, expiration, nonce, and subject. Retrieve UserInfo with the access token and require its subject to match the ID token subject.
6. Create an application-local session containing only the claims required by the application. Keep tokens and session material out of page markup and logs.

## Implement logout

Make normal application logout local: delete the application's session and return to an application-controlled URL. Do not send an end-session request; GDG Japan Accounts remains signed in. A later sign-in may therefore complete through the existing GDG Japan Accounts session.

Use RP-Initiated Logout only when the product explicitly requires ending the GDG Japan Accounts session. In that case, follow the published OIDC specification and use only the registered post-logout redirect URI.

## Verify the integration

- Confirm the authorization request has `response_type=code`, PKCE `S256`, state, nonce, requested scopes, and the registered callback URI.
- Test callback rejection for a missing or expired transaction, state or nonce mismatch, provider error, invalid ID token, and UserInfo subject mismatch.
- Confirm client secrets and tokens never appear in logs, HTML, or source control.
- Confirm normal logout removes only the application's session and leaves the GDG Japan Accounts session intact.
