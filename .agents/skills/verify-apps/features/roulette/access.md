# Access boundaries and sign-out

The organizer pages admit only members of the project's chapter. Anonymous users are sent to
sign-in, users without a chapter to `/no-chapter`, and members of other chapters get 403.

## Sub-features

- `roulette-access`: anonymous redirects for `/`, `/admin/<slug>` and the CSV; the 403 page
  for another chapter; the `member` role's full access; the no-chapter page.
- `roulette-signout`: 「ログアウト」 in the account menu ends the dev session.

## How to get to it (user POV)

A user opens `http://localhost:6190/` or a shared admin link. Signed in, the sidebar shows
「GDG Roulette」 and 「プロジェクト」; the footer holds the account menu (sign-out label
「ログアウト」) and 「テーマを切り替える」. Without a chapter the page reads
「GDG チャプターへの参加が必要です」 with the link 「チャプターに参加する」.

## Driving it with Orca Browser

Preconditions: projects `verify-spin` (chapter 1) exists. Use a fresh isolated profile per
identity so one login never replaces another.

`roulette-access`:

1. Anonymous, HTTP: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n'` on `/`,
   `/admin/verify-spin`, `/admin/verify-spin/draws.csv`. Require `302` to
   `/signin?return_to=%2F`, `/signin?return_to=%2Fadmin%2Fverify-spin`, and
   `/signin?return_to=%2Fadmin%2Fverify-spin%2Fdraws.csv`. `GET /api/auth/me` returns
   `{"user":null}`.
2. Outsider: open
   `/dev/login?as=verify-roulette-outsider&chapter=2:other-chapter&return_to=/admin/verify-spin`.
   Require 「403」, 「アクセスできません」, 「このプロジェクトを管理する権限がありません。」.
   `goto` `/`; require 「プロジェクトがありません」 (or only other-chapter projects; never
   `Verify 抽選`). Independent check: the same login in a curl jar, then the CSV URL returns
   `403` with body `Forbidden`.
3. Member role: open
   `/dev/login?as=verify-roulette-member&chapter=1:dev-chapter:member&return_to=/admin/verify-spin`.
   Require heading `Verify 抽選` and an enabled 「変更を保存」. The app does not distinguish
   organizer from member; record this as observed behavior.
4. No chapter: open `/dev/login?as=verify-roulette-none&chapter=0&return_to=/`. Require the
   URL `/no-chapter`, heading 「GDG チャプターへの参加が必要です」, and link
   「チャプターに参加する」 to `http://localhost:6173/onboarding` (read its `href`; do not follow
   it, Accounts is not running). An organizer who opens `/no-chapter` is redirected to `/`.

`roulette-signout` (run last for the `organizer` profile):

1. On `/`, open the account menu in the sidebar footer and choose 「ログアウト」. Below about 768 px the sidebar is the 「ナビゲーション」 drawer, where Orca's element `click` on 「Account menu」 does not open it, while a real pointer click
(`orca tab switch`, then `orca mouse move/down/up` on the button's centre) or focus plus Enter
does. This is an Orca click effect, not a product defect. Start
   `orca capture start` first. Require a request to `/auth/signout` answered `302` to
   `/signin`, and a `Set-Cookie` that clears `gdgjp-roulette-session`.
2. The browser then follows `/signin` → `/api/auth/signin`, which fails without Accounts.
   That failure is expected; do not report it.
3. Independent check: `goto` `/api/auth/me`; require `{"user":null}`. `goto` `/`; require a
   redirect toward `/signin?return_to=%2F`. A visitor profile's `/verify-spin` still works.

Evidence: curl status lines, the 403 and no-chapter screenshots, the member admin snapshot,
the sign-out network rows, and the `/api/auth/me` body.

## Gotchas

- `chapter=0` parses to no chapters; omitting `chapter` gives the default organizer of
  `1:dev-chapter`, which is not the same thing.
- Dev sessions are honored only while `APP_URL` is loopback; no IdP session check runs, so
  sign-out only clears the local cookie.
- Sign-out redirects to `/signin`, which cannot complete locally. Record the 302 and the
  cleared cookie, not the final page.
