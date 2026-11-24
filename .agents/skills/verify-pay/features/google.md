# Google connection

Event managers see a **Google連携** card on the event page. It shows whether the event
is connected, which Google account is connected, and whether the template and shared
folder are set. Connecting, picking files, and syncing all talk to Google; this map
covers the card's states and the local guards in front of those calls.

## Sub-features

- `pay-google-card-states` shows the not-connected, connected-by-me, and connected-by-someone-else card states, and hides the card from non-managers.
- `pay-google-connect-redirect` starts the OAuth flow with a PKCE redirect to Google and a stored transaction, checked over HTTP without following the redirect.
- `pay-google-callback-errors` rejects callbacks with missing or unknown state before any token exchange.
- `pay-google-settings-guards` refuses settings requests from non-managers and non-connecting managers, and rejects malformed template and folder requests before any Google call.

## How to get to it (user POV)

Open an event as its owner or as an organizer of its chapters. The card **Google連携**
shows `まだGoogle連携されていません。` with **自分のGoogleアカウントで連携する**; or, when connected
by the viewer, `連携アカウント: <email>`, `テンプレートへのアクセス: 許可済み|未許可`, a link
**テンプレートを開いて確認する**, a template picker button, `共有フォルダ: <name>|未設定`, and a
folder picker button; or, when connected by another manager, `連携アカウント: <email>` with
**自分で連携し直す**.

## Driving it with Orca Browser

Preconditions: the helper is ready with the seed applied. `Verify Google Seed Event`
(`evt_0000000000000000000000SEE2`) is connected by `dev-user-organizer` with the fake
account `verify-organizer@example.invalid`, template granted, and folder
`Verify Fixture Folder`. Curl steps use a cookie jar per identity (see the README).

- Not connected (`pay-google-card-states`). As `organizer`
  (`/dev/login?as=organizer&chapter=1:gdg-tokyo:organizer&return_to=/`), open
  `/events/evt_0000000000000000000000SEE1`. Require **Google連携**, `まだGoogle連携されていません。`,
  and a link **自分のGoogleアカウントで連携する** whose `href` is
  `/google/connect?event_id=evt_0000000000000000000000SEE1`. Do not choose it.
- Connected by me (`pay-google-card-states`). As `organizer`, open
  `/events/evt_0000000000000000000000SEE2`. Require `連携アカウント: verify-organizer@example.invalid`,
  `テンプレートへのアクセス: 許可済み`, buttons **テンプレートを選び直す** and **フォルダを選び直す**,
  and `共有フォルダ: Verify Fixture Folder`. Do not choose the buttons or the template link.
- Connected by someone else (`pay-google-card-states`). As `coorganizer`
  (`/dev/login?as=coorganizer&chapter=1:gdg-tokyo:organizer&return_to=/`), open the same
  event. Require `連携アカウント: verify-organizer@example.invalid`, the text
  `テンプレート・フォルダの設定は連携した本人のみ変更できます。自分に切り替えるには再連携してください。`,
  and **自分で連携し直す**; require no picker buttons.
- Hidden (`pay-google-card-states`). As `member`
  (`/dev/login?as=member&chapter=1:gdg-tokyo:member&return_to=/`), open both events and
  require no **Google連携** card. Evidence for the four states: snapshot and screenshot each.
- Connect redirect (`pay-google-connect-redirect`). With the `organizer` jar:
  `curl -s -o /dev/null -b "$JAR" -w '%{http_code} %{redirect_url}\n' 'http://localhost:6164/google/connect?event_id=evt_0000000000000000000000SEE1'`.
  Require `302` and a location starting `https://accounts.google.com/o/oauth2/v2/auth?`
  with `redirect_uri=http%3A%2F%2Flocalhost%3A6164%2Fgoogle%2Fcallback`, `access_type=offline`,
  `prompt=consent`, a nonempty `state`, and `code_challenge_method=S256`. Do not request
  that location. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT user_id, event_id, return_to, expires_at > unixepoch() AS live FROM oauth_transactions"`
  shows a row for `dev-user-organizer`, the event, `/events/evt_0000000000000000000000SEE1`,
  and `live = 1`. With the `member` jar the same request returns `403`; with
  `event_id=bogus` it returns `404`. Evidence: curl outputs with `state` and
  `code_challenge` values replaced by their lengths.
- Callback errors (`pay-google-callback-errors`). With the `organizer` jar, request
  `/google/callback` and require `400` with body `Missing Google OAuth response`; request
  `/google/callback?state=verify-unknown-state&code=verify-fake-code` and require `400`
  with body `Invalid or expired Google OAuth transaction`. Require
  `SELECT google_admin_user_id FROM events WHERE id = 'evt_0000000000000000000000SEE1'`
  still `NULL`.
- Settings guards (`pay-google-settings-guards`). POST form data to
  `/events/evt_0000000000000000000000SEE2/google`:
  as `member` with `intent=set-folder` requires `403` and body `Forbidden`; as `coorganizer`
  with `intent=set-folder` requires `403` and JSON error `自分が連携したイベントのみ操作できます`;
  as `organizer` with `intent=unknown` requires `400` and `不明な操作です`; as `organizer`
  with `intent=grant-template&fileId=not-the-template` requires `400` and
  `指定されたテンプレートを選択してください`; as `organizer` with `intent=set-folder` and an
  empty `folderId` requires `400` and `フォルダを選択してください`. Independent check: the E2
  row still has folder `Verify Fixture Folder`. Example:
  `curl -s -b "$JAR" -w '\n%{http_code}\n' --data-urlencode intent=unknown http://localhost:6164/events/evt_0000000000000000000000SEE2/google`.

## Gotchas

- Outside the map: completing Google consent, the token exchange in `/google/callback`
  with a real state, the **テンプレートを選択** and **フォルダを選択** pickers (they load
  `apis.google.com` and request an access token), the `access-token` intent, a valid
  `grant-template` or `set-folder` request, and any sync on a connected event. Each of
  these calls Google with stored tokens. The seeded tokens are fake strings; using them
  sends requests to Google with garbage credentials.
- Never choose **自分のGoogleアカウントで連携する**, **自分で連携し直す**, or
  **テンプレートを開いて確認する** in the browser; each navigates to a Google host.
- Each `/google/connect` request adds an `oauth_transactions` row; count rows rather than
  expecting exactly one. A callback with an unknown state changes nothing. A callback
  carrying another user's real state deletes that transaction before rejecting it.
- The coorganizer guard returns JSON with a 403, but the member guard returns plain text
  `Forbidden`. Assert each body as listed.
- Do not open the header **GDG アプリ** menu during this feature; it loads app icons from
  production hosts.
