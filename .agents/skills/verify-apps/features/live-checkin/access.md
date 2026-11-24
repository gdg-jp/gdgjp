# Login page, chapter gate, and forbidden page

A visitor sees the login card and starts GDG Accounts sign-in. Only `gdg-kwansai` members reach
the scanner; a signed-in member of another chapter is sent to the forbidden page, where they can
sign out and try another account.

## Sub-features

- `live-checkin-login-page`: `/` renders h1 **GDG 受付システム**, GDG Japan Connpass・Luma API Mode,
  連続受付を開始するには GDG Accounts でのログインが必要です。, and button **GDG Accounts でログイン**.
- `live-checkin-signin-start`: the button posts to `/api/auth/signin/gdg-accounts` with a CSRF
  token and Auth.js redirects to `ACCOUNTS_URL`'s authorize endpoint. With no Accounts on 6173
  discovery fails and the browser lands on `/api/auth/error?error=Configuration`; when any local
  Accounts listens there, the outcome is that Accounts' answer (`invalid_client` unless the
  client is registered, as `--accounts` does).
- `live-checkin-gate`: `proxy.ts` (matcher `/checkin`, `/checkin/:path*`) answers 307 to `/` for
  no session and 307 to `/forbidden` for a session without `gdg-kwansai`; `kwansai` passes.
- `live-checkin-forbidden-signout`: `/forbidden` shows h1 **利用できません** and
  この受付システムは GDG Greater Kwansai 所属メンバー専用です。 所属チャプターをご確認のうえ、別のアカウントでログインしてください。;
  **ログアウト** clears `authjs.session-token` and lands on `/`.

## How to get to it (user POV)

Open `http://localhost:6194/` and click **GDG Accounts でログイン**. After a real sign-in Auth.js
returns to `/checkin`; a non-Kwansai account is redirected to `/forbidden`.

## Driving it with Orca Browser

Preconditions: the helper is ready for `live-checkin`; `ready.json` lists the cookie fixture
files. Use one isolated profile per identity.

- Login page. Anonymous profile, `goto http://localhost:6194/`. Require h1 **GDG 受付システム**, the
  two texts above, button **GDG Accounts でログイン**, and `document.title` = `GDG 受付システム`.
  Screenshot.
- Sign-in start. Start `orca capture`, click **GDG Accounts でログイン**. Require requests to
  `/api/auth/providers` or `/api/auth/csrf` and a POST to `/api/auth/signin/gdg-accounts`, then
  the final URL `http://localhost:6194/api/auth/error?error=Configuration` with heading
  **Server error** and text There is a problem with the server configuration. Require no
  navigation to an Accounts or Google host. Record the sanitized network list.
- Anonymous gate. Same profile, `goto /checkin`. Require final URL `/` and the login card.
  HTTP `GET /checkin` with `redirect: manual`; require 307 and a `Location` ending in `/`.
- Outsider gate. New profile; set the `outsider` cookie (see the [README](README.md)) before any
  navigation, then `goto /checkin`. Require final URL `/forbidden`, h1 **利用できません**, the
  GDG Greater Kwansai message, and button **ログアウト**. HTTP `GET /checkin` with the outsider
  cookie header and `redirect: manual`; require 307 and `Location` ending in `/forbidden`.
- Forbidden sign-out. In the outsider profile on `/forbidden`, start `orca capture` and click
  **ログアウト**. Require a POST to `/forbidden` (server action) followed by navigation to `/`, the
  login card, and `orca eval "fetch('/api/auth/session').then(r => r.json())"` returning `null`.
  `goto /checkin`; require it now lands on `/`, not `/forbidden`.
- Allowed. New profile with the `kwansai` cookie, `goto /checkin`. Require the URL stays
  `/checkin` and `document.title` = `checkin | GDG受付システム`. Continue in [checkin.md](checkin.md).
  `fetch('/api/auth/session')` via `orca eval` must return `user.chapters` containing
  `chapterSlug` `gdg-kwansai`; record only that boolean and the `user.email`
  `kwansai@verify.local`, never `accessToken`.

Independent check: HTTP `GET /` returns 200 containing `GDG Accounts でログイン`; `GET /forbidden`
without cookies returns 200 containing `利用できません`; `GET /checkin` returns 307 to `/`
anonymously, 307 to `/forbidden` as `outsider`, and 200 containing `checkin | GDG受付システム` as
`kwansai`.
Evidence: screenshots of the login card, the Configuration error page, the forbidden page, and
the post-sign-out login card; the sanitized sign-in and sign-out network entries.

## Gotchas

`/forbidden` is not gated: anonymous visitors see it too, so the outsider journey must prove the
redirect, not just the page. If the helper ran with `--accounts`, the sign-in step instead
leaves for `http://localhost:6173`; the `live-checkin` client then still needs to exist in
Accounts, so treat anything past the Accounts authorize request as outside this map. The minted
cookies are not tied to server state: sign-out only deletes the browser cookie. Auth.js logs the
discovery failure as a server error in `server.log`; that log line is expected.
