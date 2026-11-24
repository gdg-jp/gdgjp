# Access boundaries

Anonymous visitors are sent to sign-in, signed-in users without a chapter see the chapter notice
and cannot open the create form, chapter members are bounced off the notice, non-admins get 403
on the Google connection page, and sign-out ends the session.

## Sub-features

- `meet-access` anonymous gate: `/`, `/meetings/new`, `/meetings/<id>` answer 302 to
  `/signin?return_to=<path>`; `/api/auth/me` answers `{"user":null}`.
- `meet-access` chapter gate: a chapterless user reaches `/` without **新しい会議**, sees
  `/no-chapter`, and is redirected from `/meetings/new` to `/no-chapter`. A chapter member who
  opens `/no-chapter` is redirected to `/`.
- `meet-access` sign-out: **ログアウト** goes to `/auth/signout`, which clears
  `gdgjp-meet-session`; `/api/auth/me` then returns a null user.
- `meet-admin-gate`: `/admin/google` and `/admin/google/callback` answer 403 to a non-admin and
  render the root error page **アクセスできません**.

## How to get to it (user POV)

Open `http://localhost:6193/` without signing in. Sign in as a user without a chapter and open
`/`, then try `/meetings/new`. As a chapter member, open the account menu (**Account menu**) in the
sidebar footer and choose **ログアウト**. Type `/admin/google` as a non-admin.

## Driving it with Orca Browser

Preconditions: the verify-apps stack is ready for `meet`. Use a fresh isolated profile per
identity. No seed rows are needed.

- Anonymous gate. HTTP `GET /` with `redirect: manual`; require 302 and
  `Location: /signin?return_to=%2F`. Repeat for `/meetings/new` (`return_to=%2Fmeetings%2Fnew`)
  and `/meetings/does-not-exist` (`return_to=%2Fmeetings%2Fdoes-not-exist`). HTTP
  `GET /api/auth/me`; require 200 and body `{"user":null}`. In Orca, `goto http://localhost:6193/`
  and record the final URL with `orca eval "location.href"`: it leaves for `/signin`, then
  `/api/auth/signin`. Without `--accounts` that request fails OIDC discovery through the
  missing `ACCOUNTS` binding and ends on a server error, not a Meet screen.
- Chapter gate. `goto /dev/login?as=verify-meet-nochapter&chapter=none&return_to=/`. Require
  URL `/`, heading **GDG Japan Meet**, **まだ会議がありません**, and no link **新しい会議** in
  `orca snapshot --interactive`. `goto /meetings/new`; require the URL to end in `/no-chapter`,
  heading **GDG チャプターへの参加が必要です**, and link **チャプターに参加する** whose `href` is
  `http://localhost:6173/onboarding`. Screenshot.
- Member bounce. In a new profile,
  `goto /dev/login?as=verify-meet&chapter=1:dev-chapter&return_to=/no-chapter`. Require the final
  URL `/` and heading **GDG Japan Meet**.
- Admin gate. Same `member` profile, `goto /admin/google`. Require text `403`, heading
  **アクセスできません**, and **このページにアクセスする権限がありません。** Confirm the sidebar
  has no **Google 接続設定** link on `/`. Independently, mint a member cookie with
  `curl -c jar -s -o /dev/null "http://localhost:6193/dev/login?as=verify-meet&chapter=1:dev-chapter&return_to=/"`
  and require `GET /admin/google` and `GET /admin/google/callback` with that jar to return 403.
- Sign-out. Same `member` profile on `/`: start `orca capture`, click **Account menu**, then the
  menu item **ログアウト**. Require a request to `/auth/signout` answering 302 to `/signin` with a
  `Set-Cookie` that expires `gdgjp-meet-session` (record the attribute, not any value). Then
  `orca eval "fetch('/api/auth/me').then(r => r.text())"` and require `{"user":null}`. `goto /`
  and require that **GDG Japan Meet** does not render as the page heading.

Independent check: the HTTP status codes and `Location` headers above, taken outside the browser.
Evidence: final URLs, status codes, the sign-out network entry (sanitized), screenshots of
`/no-chapter` and the 403 page.

## Gotchas

`/signin` never renders a page; it always redirects into OIDC. In a Meet-only stack the sign-in
redirect ends in a server error because Accounts is absent: record it, it is not a Meet defect.
Dev sessions skip the IdP session check, so sign-out of a dev session never calls the Accounts
end-session endpoint. `/` uses `requireUser`, not the chapter guard: a chapterless user sees the
list (for meetings they were invited to) by design; only creation is chapter-gated.
`chapter=none` must be passed explicitly; omitting `chapter` produces a `1:dev-chapter` organizer.
