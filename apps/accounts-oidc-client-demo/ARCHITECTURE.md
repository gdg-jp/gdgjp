# OIDC client demo architecture

This demo remains an independent relying party with no workspace library or
service-binding dependencies. `src/index.ts` routes requests and composes the
home response from configuration, session reading and the page renderer.

- `auth/config.ts` defines required client configuration.
- `auth/oidc.ts` owns discovery caching, PKCE/nonce/state transactions, callback
  verification and local logout. `auth/session.ts` validates issuer and expiry.
- `platform/cookies.ts` is the domain-free AES-GCM cookie primitive;
  `platform/http.ts` handles HTML and redirect response headers.
- `components/document.ts` is domain-free HTML escaping and document layout.
- `widgets/identity.ts` renders OIDC configuration and identity claims.
- `pages/demo.ts` composes widgets into home and sign-in failure responses.

Presentation only receives session data; it never discovers an issuer, exchanges
an authorization code or reads a cookie. Widgets can import auth types, but no
runtime auth modules. Auth handlers may render pages; session validation and
cookie primitives do not depend on presentation or the Worker entrypoint.

Route paths, page HTML, scopes, eight-hour session expiry, ten-minute transaction
expiry and HttpOnly/SameSite/Secure cookie behavior are unchanged. Existing
Worker tests cover login, callback and logout; boundary tests cover encryption,
issuer/expiry validation, escaping and import direction/runtime cycles.
