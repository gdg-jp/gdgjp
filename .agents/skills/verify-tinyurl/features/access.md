# Sign-in gate, chapter gate, and sign-out

Every dashboard screen requires a signed-in chapter member. Anonymous visitors are sent into
Accounts sign-in with their path preserved, signed-in users without a chapter see a join notice,
and sign-out ends the TinyURL session. Short links themselves stay public.

## Sub-features

- `tinyurl-access` anonymous gate: `/` redirects to `/links`; `/links`, `/campaigns`, and every
  other dashboard route answer 302 to `/signin?return_to=<path>`.
- `tinyurl-access` sign-in entry: `/signin` answers 302 to `/api/auth/signin?return_to=<path>`.
- `tinyurl-access` chapter gate: a signed-in user with no chapter lands on `/no-chapter`.
- `tinyurl-access` member on `/no-chapter`: a chaptered user should return to the dashboard.
- `tinyurl-access` session read-back and sign-out: `/api/auth/me` before and after
  `/auth/signout`.
- `tinyurl-access` CLI envelope: `/api/cli/v1/links` without a bearer token answers 401 JSON.
- `tinyurl-accounts-continuation` the browser leaves TinyURL for Accounts with an OIDC
  authorization request for client `tinyurl` (needs `--platform <verify-platform ready.json>`).

## How to get to it (user POV)

Open `http://localhost:6169/` or `http://localhost:6169/campaigns` without signing in. Sign in
as a user with no chapter and open `/links`. Use the account menu (**アカウントメニュー**) and choose
**ログアウト**. Run `gdg` CLI commands without signing in to the CLI.

## Driving it with Orca Browser

Preconditions: the helper is ready. The anonymous steps use a fresh Orca profile with no TinyURL
cookie. `tinyurl-accounts-continuation` needs the helper started with `--platform <verify-platform ready.json>`
(Accounts at `http://localhost:6173`); without it, record that journey as not run.

- Anonymous gate (HTTP). `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:6169/`
  must print `302 http://localhost:6169/links`. Repeat for `/links` and require 302 with
  `Location` `/signin?return_to=%2Flinks`; for `/campaigns` require
  `/signin?return_to=%2Fcampaigns`; for `/folders/1` require `/signin?return_to=%2Ffolders%2F1`.
  Then `/signin?return_to=%2Flinks` must answer 302 to `/api/auth/signin?return_to=%2Flinks`.
  A `return_to` of `//evil.example` must fall back to `/api/auth/signin?return_to=%2Flinks`.
- Accounts continuation. With `--platform <verify-platform ready.json>`, start Orca network capture and `goto
  http://localhost:6169/`. Require the final URL on `http://localhost:6173/signin` and, from the
  captured authorization request or the final query, `client_id=tinyurl`, `response_type=code`,
  `redirect_uri=http://localhost:6169/api/auth/callback/gdgjp`, a `scope` containing `openid`,
  and nonempty `state`, `nonce`, and `code_challenge`. Repeat from `/campaigns`. Record boolean
  checks and sanitized URLs, never the state or challenge values.
- Chapter gate. `goto` the `nochapter` sign-in URL from the README. Require the URL
  `http://localhost:6169/no-chapter`, the heading **Join a GDG to continue**, and the link
  **Join a chapter** whose `href` is `http://localhost:6173/onboarding`. Then `goto /tags` and
  `/campaigns` and require `/no-chapter` again. Screenshot.
- Member on `/no-chapter`. `goto` the `owner` sign-in URL, then `goto
  http://localhost:6169/no-chapter`. Expected: the Links dashboard (heading **Links**). The
  loader redirects to `/dashboard`, which is not a route and answers 404; record the observed
  status and URL. Current source fails this step (see Gotchas).
- Session read-back. As `owner`, `curl -s -b "$EVIDENCE/owner.jar" http://localhost:6169/api/auth/me`
  must return JSON whose `user.email` is `owner@dev.local`.
- Sign-out. In Orca as `owner`, open **アカウントメニュー** and choose **ログアウト** (or `goto
  /auth/signout`). With network capture on, require the `/auth/signout` response to be 302 to
  `/signin` with an expired `gdgjp-tinyurl-session` cookie. Then `goto /links` and require that
  the **Links** heading does not render. Independently, run the same sign-out over HTTP with the
  owner jar: `curl -s -o /dev/null -b "$EVIDENCE/owner.jar" -c "$EVIDENCE/owner.jar" http://localhost:6169/auth/signout`,
  then `curl -s -b "$EVIDENCE/owner.jar" http://localhost:6169/api/auth/me` must return
  `{"user":null}`. Mint the jar again before any later HTTP step that needs `owner`.
- CLI envelope. `curl -s -w '\n%{http_code}\n' http://localhost:6169/api/cli/v1/links` must print
  `{"error":"invalid_token"}` and `401`.

Evidence: HTTP status lines and `Location` values, the sanitized authorization URL checks, a
screenshot of `/no-chapter`, the `/api/auth/me` JSON before and after sign-out.

## Gotchas

`/signin` never renders a page. Without `--platform <verify-platform ready.json>`, the anonymous browser path ends on a
connection error at `localhost:6173` or a 5xx from `/api/auth/signin` (issuer discovery fails);
that is not a TinyURL failure, and the HTTP steps above are the gate evidence.
`chapter=0:none` produces a chapterless user; omitting `chapter` does not.
`/no-chapter` sends chaptered users to `/dashboard`, which has no route: on the local apex it
falls into the `:slug` resolver and answers 404, and in production `url.gdgs.jp/dashboard` also
answers 404. The intended target is `/links`.
Sign-out of a dev session never contacts Accounts. After sign-out the `/signin` redirect chain
cannot finish without Accounts; record the redirect, do not sign in again through Google.
