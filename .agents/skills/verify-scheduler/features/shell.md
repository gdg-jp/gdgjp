# Header, theme, viewport, and sign-in

Every Scheduler page shares one header: the `Scheduler` home link, a `Theme`
menu, and either a `Sign in` link (anonymous) or `My events`, an app launcher, and an
account menu (signed in). The theme choice persists per browser. The create form and
event pages must fit a 390 px phone width without horizontal page scroll.

## Sub-features

- `scheduler-shell-theme` switches between light, dark, and system themes from the
  `Theme` menu and keeps the choice after reload.
- `scheduler-shell-viewport` renders the create form and an event page at 390 px and
  1280 px in both themes without horizontal page scroll, with keyboard focus moving
  from `Theme` to `Sign in`.
- `scheduler-signin-redirect` sends an anonymous user from `Sign in` through
  `/signin` to the local Accounts authorization endpoint for client `scheduler`.
- `scheduler-signout` ends a signed-in session from the account menu.

## How to get to it (user POV)

- Open any page, for example `http://localhost:6168/`.
- Choose the `Theme` button in the header, then `ライト`, `ダーク`, or `システム`.
- Choose `Sign in` in the header while anonymous. A gated page such as `/events` or
  `/e/<id>/edit` also redirects an anonymous user to `/signin?return_to=<path>`.
- While signed in, choose `Account menu`, then `Sign out`.

## Driving it with Orca Browser

Preconditions: the helper is ready. Theme and viewport use a new anonymous profile.
`scheduler-signin-redirect` and `scheduler-signout` require the helper's `--platform <verify-platform ready.json>`
option, which serves local Accounts at `http://localhost:6173`.

- **Theme.** Navigate to `http://localhost:6168/`. Choose the button `Theme`, then the
  menu item radio `ダーク`. Read the `html` element's class through `eval`: it contains
  `dark`. Reload. The class still contains `dark`, and `localStorage["gdg-apps-theme"]`
  reads `dark`. Repeat with `ライト` and require `light`. Finish with `システム` so later
  journeys follow the system theme. Screenshot each theme.
- **Viewport.** For widths 390 and 1280 at height 900, in light and then dark, load `/`.
  Require the heading `Schedule a meeting`. Fill the textbox `Title` with
  `日本語の長いタイトル：チームのスケジュールを相談する定例会議`. Choose the combobox
  `Meeting length`, then the option `30 min`. Require the text `30 slots (30 min each)`.
  Choose `Add time range for Sat`; a combobox `Sat start time` appears. Choose
  `Remove time range for Sat`; it disappears. Focus `Theme` and press Tab; the focused
  element is the link `Sign in`. Through `eval`, require
  `document.documentElement.scrollWidth <= window.innerWidth`. Repeat the scroll-width
  check on `/e/evt_0VERFYSCHEDXFRGN0000000001`. Save a full-page screenshot per
  width and theme.
- **Sign-in redirect.** Start network capture. Choose the link `Sign in` on `/`. Require
  the chain `/signin` (302 to `/api/auth/signin?return_to=%2Fevents`), then a 302 to
  `http://localhost:6173/api/auth/oauth2/authorize`. Its query must contain
  `client_id=scheduler`, `response_type=code`,
  `redirect_uri=http%3A%2F%2Flocalhost%3A6168%2Fapi%2Fauth%2Fcallback%2Fgdgjp`,
  `code_challenge_method=S256`, and a nonempty `state`. The Accounts sign-in page
  shows the heading `Sign in`. Record booleans and sanitized URLs only. Independent
  read: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' 'http://localhost:6168/signin?return_to=%2Fe%2Fevt_0VERFYSCHEDXFRGN0000000001'`
  returns `302` with `return_to=%2Fe%2Fevt_0VERFYSCHEDXFRGN0000000001` preserved, and
  `return_to=%2F%2Fevil.example` falls back to `return_to=%2Fevents`.
- **Sign-out.** In a new profile, navigate to the `verify-owner` login URL. On
  `/events`, choose the button `Account menu`. The menu label shows
  `verify-owner (dev)` and `verify-owner@dev.local`, and `Manage your account` links
  to `http://localhost:6173/dashboard`. Choose `Sign out`. Require a 302 from
  `/auth/signout` to `http://localhost:6168/signin`, whose response clears
  `gdgjp-scheduler-session`, and then the Accounts sign-in page. Independent read in
  the same tab: navigate to `http://localhost:6168/api/auth/me` and require
  `{"user":null}`. Navigate to `/events` and require a redirect to Accounts sign-in,
  not the `My events` heading.

## Gotchas

- The theme menu items are Japanese (`ライト`, `ダーク`, `システム`) while the rest of
  the UI is English. Use those exact names.
- The `Theme` button is disabled until hydration. Wait for it to become enabled
  before clicking or tabbing.
- The header `Sign in` link carries no `return_to`, so after sign-in the user lands on
  `/events`, not the page they were reading. Gated pages do preserve their path.
- Without `--platform <verify-platform ready.json>`, `/api/auth/signin` cannot discover the issuer and the browser
  ends on a server error. Mark both sign-in journeys unreachable instead of
  substituting the development login.
- Development sessions never call Accounts. They prove local session handling only,
  not OIDC.
- Sign-out invalidates the profile's session. Run it last, or sign in again with the
  login URL before another journey in the same profile.
- The app launcher (`Open app launcher`) lists production hosts. Do not follow those
  links during verification.
