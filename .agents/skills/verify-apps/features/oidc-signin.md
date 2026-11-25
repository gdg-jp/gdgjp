# Real Accounts sign-in

Each relying-party app signs in through the local Accounts of the platform stack, the same
OIDC path production uses. Journey IDs are `<app>-oidc-signin` for screen, ost, mc, deck,
roulette, img, meet, roster and live-checkin.

## Sub-features

- `/signin` → `/api/auth/signin` → Accounts `/api/auth/oauth2/authorize` with the app's
  `client_id`, S256 PKCE, and the app's E2E callback.
- The callback `/api/auth/callback/gdgjp` creates the app's own session from the Accounts session.
- The platform fixture user `platform-oidc-user` belongs to no chapter, so chapter-gated apps
  end on `/no-chapter`; meet's `/` uses `requireUser` and renders the home page.

## How to get to it (user POV)

Open any app's sign-in while already signed in to Accounts.

## Driving it with Orca Browser

Preconditions: ports 6173 and 6177 are free (another verifier may hold them; wait instead of
starting a second Accounts). Start `node scripts/verification/verify-platform.mjs --serve`,
then `verify-apps.mjs --app <names> --accounts <platform ready.json> --serve`. Readiness
then requires each gated app's `/signin` to reach the local authorize endpoint
(`ready.json.checks.<app>.oidc`).

- Create one isolated profile, open `http://localhost:6173/signin`, and set only the Accounts
  cookie `gdgjp-accounts.session_token` from the platform `ready.json.authFixtures.accounts`.
  `eval` `fetch('http://localhost:6173/api/auth/get-session',{credentials:'include'})` and
  require `platform-oidc-user`.
- For each app: start capture, `goto http://localhost:<port>/signin?return_to=%2F`. Require
  in `orca network` the authorize request naming the app's callback and a callback 302, then
  the final path (`/no-chapter`, or `/` for meet). `eval` `fetch('/api/auth/me')` and require
  email `platform-oidc@test.local`.
- live-checkin: click **GDG Accounts でログイン** on `/`; the chapterless fixture user ends on
  `/forbidden`. `eval` `fetch('/api/auth/session')` and require `user.email`
  `platform-oidc@test.local` and `user.name` `Platform OIDC Admin` (Auth.js reads them from the
  UserInfo endpoint); never record `accessToken`.

Evidence: sanitized network rows (codes, states, PKCE values replaced), final paths, and the
`/api/auth/me` email.

## Gotchas

`orca capture start` does not clear earlier entries; filter by the app's port. Accounts seeds no
live-checkin client, so `--accounts` with `live-checkin` inserts a local `oauthClient` row
(client `live-checkin`, the test secret, callback `/api/auth/callback/gdg-accounts`) into the
platform Accounts D1; without it Accounts answers `invalid_client`. The fixture user has no chapter, so these journeys prove sign-in, not chapter
access; chapter access is covered by the `/dev/login` identities.
