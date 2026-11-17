# Accounts sign-in and local OIDC

A user reaches sign-in, returns to Wiki through Accounts, and loses the shared
session after signing out.

## Sub-features

- `accounts-signin` shows the anonymous sign-in page and local issuer metadata.
- `accounts-continuation` preserves the Wiki authorization request at sign-in.
- `accounts-oidc` completes local authorization using a real Accounts session.
- `accounts-signout` ends that session and prevents reuse of the Wiki session.

## How to get to it (user POV)

Open `http://localhost:6173/` while anonymous. Open the Wiki creation
page at `http://localhost:6177/s/gdg-jp/wiki/new` and choose **Sign in** to start
cross-app sign-in. The creation form itself is public; publishing requires authentication.
Use Accounts `/auth/signout` to end the session.

## Driving it with Orca Browser

Preconditions: the platform helper is ready. The anonymous and OIDC journeys use
a new isolated profile. Never set a Wiki fixture cookie in that profile.

- Anonymous sign-in. Navigate to Accounts `/`. Read the snapshot and require
  `/signin`, the **Sign in** heading, and **Continue with Google**. Read
  `/.well-known/openid-configuration` through HTTP. Require issuer
  `http://localhost:6173` and authorization endpoint
  `http://localhost:6173/api/auth/oauth2/authorize`.
- Continuation. Start Orca network capture. Navigate to Wiki `/signin?return_to=%2Fs%2Fgdg-jp%2Fwiki%2Fnew`, the same sign-in entry used by the page header. Require Accounts sign-in. Inspect the actual
  authorization request for `client_id=wiki`, response type `code`, callback
  `http://localhost:6177/api/auth/callback/gdgjp`, nonempty state, and S256 PKCE.
  Require the resulting sign-in continuation to contain a signature and an
  unexpired expiry. Record boolean checks and sanitized URLs instead of secrets.
- Local OIDC. In the fresh OIDC profile, set only the Accounts fixture cookie from
  `ready.json.authFixtures.accounts`. Verify `/api/auth/get-session` identifies
  `platform-oidc-user`. Start capture, then navigate to
  `/signin?return_to=%2Fs%2Fgdg-jp%2Fwiki%2Fnew` on Wiki.
  Follow the product's consent controls if shown. Require the actual Accounts
  authorize request and Wiki callback, then the Wiki title field and body editor.
  Check that a Wiki RP cookie was created without recording its value. Reload
  and require the editing page again. Do not replace the flow with a Wiki fixture.
- Sign-out. Keep that same OIDC profile. Navigate to
  `http://localhost:6173/auth/signout`. Require sign-in and a null Accounts session
  from `/api/auth/get-session`. Open Wiki `/settings`, whose loader requires authentication. Require
  Accounts sign-in and a null user from Wiki `/api/auth/me`. Preserve the action receipts and the
  sanitized HTTP and network outcomes.

## Gotchas

The local Accounts fixture supplies an authenticated user before OIDC starts.
This journey tests local authorization, token exchange, callback, and session
handling. It does not test Google's identity check or a real Google account.
Never click through to a live Google login merely to complete this local map.
The public new-page editor can still render after sign-out. An authenticated
settings page or non-null Wiki user after sign-out is a failed journey. Do not
clear cookies manually and report success. Sign-out invalidates the fixture session;
repeat this journey with a newly launched stack when necessary.
