# Access, chapters, and sign-out

Every SNS screen requires a signed-in user who may post for the selected chapter.
Signed-out visitors go to Accounts, users without access see the no-chapter page,
and users with several chapters switch between them from the account menu.

## Sub-features

- `sns-access-signed-out` sends an anonymous visitor from a protected page to
  Accounts sign-in with an SNS authorization request.
- `sns-access-roles` admits organizers, contributors, and super admins, sends a plain
  member to `/no-chapter`, and hides organizer-only settings from other roles.
- `sns-chapter-switch` changes the selected chapter and every list that depends on it.
- `sns-signout` ends the SNS session.

## How to get to it (user POV)

- Open any page, for example `http://localhost:6165/posts`. `/` redirects to `/posts`.
- The header shows `SNS Manager`, a theme toggle (`テーマを切り替え`), the app launcher
  (`アプリ一覧`), and the account menu button labelled
  `チャプターを選択: GDG <Chapter>`. The menu lists chapters under `Chapter`, then
  `Manage your account` and `Sign out`.
- The bottom navigation has `Posts`, `Schedule`, and `Settings`.

## Driving it with Orca Browser

Preconditions: the helper is ready and the seed is applied. Use one fresh profile per
identity. HTTP checks create a cookie jar from the same dev-login URL:
`curl -s -c <jar> -o /dev/null "<dev-login URL>"`.

- **Signed out (`sns-access-signed-out`).** Requires `--platform <verify-platform ready.json>`. In a fresh profile,
  start network capture and navigate to `http://localhost:6165/posts`. Require the
  hops `/signin?return_to=%2Fposts` and `/api/auth/signin?return_to=%2Fposts` on SNS,
  then a final URL with origin `http://localhost:6173` and path `/signin`. Require
  `client_id=sns`, `redirect_uri=http://localhost:6165/api/auth/callback/gdgjp`, a
  `scope` containing `openid`, a nonempty `state`, and a nonempty `code_challenge`.
  Independent check: `curl -s -D - -o /dev/null http://localhost:6165/posts` returns
  `302` with `Location: /signin?return_to=%2Fposts`. Evidence: sanitized URL list and
  a snapshot of the Accounts sign-in page. Do not continue to Google.
- **Member without access (`sns-access-roles`).** Navigate to the Member URL. Require
  the final path `/no-chapter`, the heading `SNS Manager へのアクセス権がありません`, and
  the text that asks for Organizer or SNS Contributor rights. Independent check: with
  the member jar, `curl -s -D - -o /dev/null -b <jar> http://localhost:6165/settings`
  returns `302` to `/no-chapter`.
- **Contributor (`sns-access-roles`).** Navigate to the Contributor URL. Require the
  `Posts` heading, `Verify fixture failed post` in the list, and the account menu
  button `チャプターを選択: GDG Dev Chapter`. Open `Settings`. Require the `X accounts`
  heading and `@verify_chapter_one`, and require that no `Contributors` or
  `Google Photos album` heading exists. Independent checks with the contributor jar:
  `POST /settings/contributors` with `email=x@verify.invalid` returns `403`;
  `POST /settings/google-photos` with `albumUrl=https://photos.google.com/share/verify`
  returns `403`; `GET /api/contributor-candidates?q=a` returns `403`.
- **Guest contributor (`sns-access-roles`).** Navigate to the Guest URL. Require the
  account menu button `チャプターを選択: GDG Chapter 1` and the same chapter 1 post list.
  The chapter has no membership, so the label comes from the fallback slug `chapter-1`.
- **Super admin (`sns-access-roles`).** Navigate to the Super admin URL. Require the
  `Contributors` heading with `verify-sns-contributor@dev.local` and
  `verify-sns-guest@dev.local`, and no `Google Photos album` heading. Independent check:
  `POST /settings/google-photos` with the admin jar returns `403`, because that action
  requires the `organizer` role.
- **Chapter switch (`sns-chapter-switch`).** In the switcher profile, navigate to the
  Switcher URL. Require `チャプターを選択: GDG Dev Chapter` and the chapter 1 posts.
  Open that menu and choose `GDG Empty Chapter`. Require the same `/posts` path, the
  button label `チャプターを選択: GDG Empty Chapter`, and `予約投稿はまだありません。`.
  Read the profile's cookies and require `sns-chapter=3`. Independent check: with a
  switcher jar, `curl -s -o /dev/null -w '%{http_code}' -b <jar> -X POST -d chapterId=2
  http://localhost:6165/api/chapter` prints `403`.
- **Sign-out (`sns-signout`).** Run last in the organizer profile. Open the account
  menu and choose `Sign out`. Require navigation through `/auth/signout` to `/signin`.
  Then evaluate `fetch('/api/auth/me').then(r => r.json())` in the page and require
  `{"user":null}`. Navigate to `/posts` and require a redirect to
  `/signin?return_to=%2Fposts`. With `--platform <verify-platform ready.json>` the chain ends on Accounts sign-in;
  without it, record the SNS hops and the failed Accounts hop.

Evidence for each role: a snapshot of `/posts` or `/no-chapter`, a snapshot of
`/settings`, and the HTTP status lines.

## Gotchas

- `/dev/login` exists only when `APP_URL` is loopback. A `404` there means the helper
  wrote the wrong `APP_URL`.
- `chapter=none` yields no memberships. The guest reaches chapter 1 only through the
  seeded `sns_contributors` row for `verify-sns-guest@dev.local`.
- `sns-chapter` is set with `Secure` on plain HTTP. Chrome accepts it on `localhost`;
  a client that rejects it keeps showing chapter 1 after the switch.
- The chapter cookie persists for 30 days in the profile, so it changes every later
  journey run in that profile. Keep the switcher in its own profile.
- Forbidden pages render React Router's default error output because the root module
  exports no `ErrorBoundary`. Assert the HTTP status, then record the visible text.
- Contributors and super admins can open `Xを認可` and the `解除` dialog. The source
  gates both only by `requireSnsAccess`, not by the organizer role.
- The signed-out chain needs Accounts. Without `--platform <verify-platform ready.json>`, `/api/auth/signin` cannot
  load the issuer metadata and the journey fails at that hop.
