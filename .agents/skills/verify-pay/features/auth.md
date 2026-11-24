# Sign-in, membership gate, and sign-out

An anonymous visitor sees the public home page and is sent to sign-in for every
other page. A signed-in user without a chapter membership is refused. A signed-in
member can sign out from the account menu.

## Sub-features

- `pay-anon-home` shows the anonymous home page and redirects protected pages to `/signin` with a preserved `return_to`.
- `pay-signin-continuation` follows `/signin` through `/api/auth/signin` to the local Accounts authorization endpoint (requires `--platform <verify-platform ready.json>`).
- `pay-no-membership` refuses a signed-in user whose session has no chapter.
- `pay-signout` clears the Pay session from the header account menu.

## How to get to it (user POV)

Open `http://localhost:6164/` without a session. The page header shows a **Sign in**
link, and the page body shows a **サインイン** button. Opening any other page, such as
`/profile` or `/events/new`, while anonymous sends the browser to `/signin`.
Signed-in users open the avatar button labeled **アカウント** in the header and choose
**サインアウト**.

## Driving it with Orca Browser

Preconditions: the helper is ready at `http://localhost:6164`. Anonymous journeys use
a new browser profile with no Pay cookie. `pay-signin-continuation` additionally needs
the helper started with `--platform <verify-platform ready.json>` so that `http://localhost:6173` answers.

- Anonymous home (`pay-anon-home`). Navigate to `/`. Require heading **GDG Japan Pay**,
  the region named **利用案内** containing `イベント登録と経費申請ができます`, a
  **サインイン** link, and a header **Sign in** link. Require no region named
  **イベント一覧** and no **口座情報** link. Independent check:
  `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:6164/profile`
  prints `302 http://localhost:6164/signin?return_to=%2Fprofile`, and
  `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://localhost:6164/signin?return_to=%2Fprofile'`
  prints `302` with a location ending `/api/auth/signin?return_to=%2Fprofile`.
  Repeat the first request for `/events/new` and require `return_to=%2Fevents%2Fnew`.
  Evidence: snapshot and screenshot of `/`, both curl outputs.
- Open-redirect guard (`pay-anon-home`). Request
  `curl -s -o /dev/null -w '%{redirect_url}\n' 'http://localhost:6164/signin?return_to=%2F%2Fevil.example'`.
  Require the location to end `/api/auth/signin?return_to=%2F`. Evidence: curl output.
- Continuation (`pay-signin-continuation`). Start Orca network capture in the anonymous
  profile and navigate to `/profile`. Require the request chain `/profile` (302),
  `/signin?return_to=%2Fprofile` (302), `/api/auth/signin?return_to=%2Fprofile` (302), then
  a request to `http://localhost:6173/api/auth/oauth2/authorize` with `client_id=pay`,
  `response_type=code`, `redirect_uri=http://localhost:6164/api/auth/callback/gdgjp`,
  a nonempty `state`, and `code_challenge_method=S256`. Require the Accounts sign-in page.
  Do not choose **Continue with Google** or any Google control. Evidence: sanitized
  network list (no state or verifier values), Accounts snapshot.
- Missing membership (`pay-no-membership`). In a fresh profile navigate to
  `/dev/login?as=nochapter&chapter=0:none:member&return_to=/`. Require HTTP 403 for `/`
  and a page whose level-1 heading starts with `403`. Navigate to `/profile` and
  `/events/new` and require 403 for each. Independent check with a curl cookie jar
  (see the README) for the same identity: `GET /` returns `403`. Evidence: network
  status for each navigation, screenshot of one 403 page.
- Sign-out (`pay-signout`, run last). Sign in as
  `/dev/login?as=member&chapter=1:gdg-tokyo:member&return_to=/`. Require the region
  **イベント一覧**. Choose **アカウント**, require the menu label `member (dev)` and
  `member@dev.local`, then choose **サインアウト**. Require a 302 from `/auth/signout`
  to `http://localhost:6164/signin` whose `Set-Cookie` clears the `gdgjp-pay` session
  cookie (record the cookie name and expiry, not a value). Without `--platform <verify-platform ready.json>` the
  following `/api/auth/signin` hop may fail; that is not a Pay sign-out failure. Then
  navigate to `/` and require the anonymous **利用案内** region, and navigate to
  `/profile` and require a redirect to `/signin?return_to=%2Fprofile`.
  Independent check: navigate the same tab to `/api/auth/me` and require the body
  `{"user":null}`; before sign-out the same URL returned a user with id
  `dev-user-member`. Evidence: network list, snapshot before and after, both
  `/api/auth/me` bodies.

## Gotchas

- The dev login exists only because `APP_URL` is a localhost URL. A 404 from
  `/dev/login` means the scratch `.dev.vars` points `APP_URL` elsewhere; stop and report.
- The dev session never calls Accounts, so `pay-no-membership` and every member
  journey work without `--platform <verify-platform ready.json>`. The real OIDC callback and token refresh are not
  covered by this map.
- `chapter=0:none:member` parses to an empty chapter list. Omitting `chapter` gives a
  default organizer of chapter `1:dev-chapter`, which is not a missing-membership case.
- The application has no error boundary. Thrown 403 and 404 responses render React
  Router's fallback page (title `Unhandled Thrown Response!`, heading `403` or `404`).
  The Japanese body `チャプターのメンバーシップが必要です` is never shown to the user;
  assert the HTTP status and the heading, and report the missing message as a product
  observation rather than a journey failure.
- The header link says **Sign in** in English while the page button says **サインイン**.
  Quote both exactly.
- Never follow the Accounts page into Google sign-in.
- Dev sessions are stateless signed cookies. Sign-out removes the cookie from the
  browser; a copy saved in a curl jar before sign-out still authenticates. Prove
  sign-out from the browser's state, not by replaying an old jar.
