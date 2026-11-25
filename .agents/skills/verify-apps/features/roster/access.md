# Access boundaries

Who reaches the admin screens: anonymous visitors are sent to sign-in, signed-in users without a
chapter see the chapter notice, members of another chapter get 403 on this chapter's events, and
sign-out ends the session.

## Sub-features

- `roster-access` anonymous gate: `/` and any `/e/...` route answer 302 to `/signin?return_to=<path>`.
- `roster-access` chapter gate: a signed-in user with no chapter lands on `/no-chapter`.
- `roster-access` cross-chapter: an event of chapter 1 answers 403 to a chapter 2 member.
- `roster-access` sign-out: `/auth/signout` clears the session; `/` gates again.

## How to get to it (user POV)

Open `http://localhost:6186/` without signing in. Sign in as a user with no chapter and open `/`.
Sign in as a member of a different chapter and open an event link someone shared. Use
**ログアウト** in the account menu (it goes to `/auth/signout`).

## Driving it with Orca Browser

Preconditions: the verify-apps stack is ready. The cross-chapter step needs one chapter 1 event
id; create it with [event-design.md](event-design.md) first, or skip that step and record it as
not run.

- Anonymous gate. In a fresh profile, HTTP `GET /` with `redirect: manual`. Require 302 and
  `Location: /signin?return_to=%2F`. Repeat for `/events/new` and require
  `return_to=%2Fevents%2Fnew`. In Orca, `goto http://localhost:6186/` and record the final URL
  from `orca eval "location.href"`: it stops at `/api/auth/signin?return_to=%2F` with the
  HTTP 503 page **サインインサービスに接続できませんでした** and a **もう一度サインイン** link, because
  OIDC discovery against `localhost:6173` fails without `--accounts`. Expect that page, not a
  roster screen.
- Chapter gate. `goto /dev/login?as=verify-roster-nochapter&chapter=0:none&return_to=/`. Require
  the URL `/no-chapter`, heading **GDG チャプターへの参加が必要です**, and link
  **チャプターに参加する** whose `href` ends in `/onboarding`. Screenshot.
- Cross-chapter. `goto /dev/login?as=verify-roster-outsider&chapter=2:other-chapter&return_to=/`.
  Require heading **イベント** and **最初のイベントを作成** (chapter 2 has no events). Then
  HTTP `GET /e/<chapter-1-event-id>` with the outsider's cookie (mint it with `curl -c` against
  the same `/dev/login` URL) and require 403. In Orca, `goto /e/<id>` and require that the event
  name does not appear in the snapshot.
- Sign-out. As `owner` (`/dev/login?as=verify-roster&chapter=1:dev-chapter&return_to=/`), open the
  account menu (**アカウントメニュー**) and choose **ログアウト**, or `goto /auth/signout`. With
  `orca network` capture on, require the sign-out response to be a 302 to `/signin` that sets an
  expired session cookie. Then `goto /` and require that the **イベント** heading does not
  render and the URL has left `/` for `/api/auth/signin`.

Independent check: the HTTP status codes above, taken outside the browser.
Evidence: final URLs, status codes, one screenshot each of `/no-chapter` and the outsider's empty
list.

## Gotchas

`/signin` never renders a page; it always redirects into OIDC. A roster-only stack cannot finish a
real sign-in, so do not treat the Accounts connection error as a roster failure. Omitting `chapter`
from `/dev/login` signs in to `1:dev-chapter`, the owner's chapter, not a chapterless user. The
`:member` role suffix does not restrict anything: the permission model is flat by design.
