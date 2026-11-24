# mc access and sign-out

The controller is reachable only with a session that carries a chapter. Any chapter is enough.
The player page and uploaded media are public; their sockets and writes are gated separately.

## Sub-features

- `mc-access` covers the anonymous redirect, the chapterless page, an other-chapter member
  reaching the controller, and the 401 on clip writes without a session.
- `mc-signout` clears the session through `/auth/signout`.

## How to get to it (user POV)

An operator opens `http://localhost:6187/`. Without a session the app sends them to sign in.
A signed-in user without a chapter lands on **GDG チャプターへの参加が必要です**. A member sees the
track tabs `A` `B` `C`. Sign-out has no button; the operator opens `/auth/signout`.

## Driving it with Orca Browser

Preconditions: the helper's `ready.json` shows `mc` ready. Create one isolated Orca profile per
identity (`mc-anon`, `mc-operator`, `mc-outsider`, `mc-nochapter`) and pin each tab's page ID.

- Anonymous gate. HTTP first: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'
  http://localhost:6187/` must print `302 http://localhost:6187/signin?return_to=%2F`. In the
  `mc-anon` profile, start capture and `goto` `http://localhost:6187/`. Require the network log
  to show `/` 302 then `/signin?return_to=%2F` 302 then `/api/auth/signin?return_to=%2F`.
  Stop there. Without `--accounts`, `/api/auth/signin` answers the 503 page **サインインサービスに接続できませんでした** because OIDC discovery against `localhost:6173` fails; assert only the `/` 302 and `/signin` 302 hops.
  Evidence: sanitized network list (drop `state`, `code_challenge`, `nonce`).
- Clip writes without a session. `curl -s -X POST -H 'content-type: application/json' -d '{}'
  http://localhost:6187/api/clips` must return 401 `{"error":"unauthorized"}`. Repeat for
  `-X DELETE http://localhost:6187/api/clips/U-0000000000`. Record the status lines.
- Chapterless. In `mc-nochapter`, `goto`
  `http://localhost:6187/dev/login?as=verify-mc-nochapter&chapter=0:none&return_to=/`. Require
  the final URL `/no-chapter`, the text **GDG チャプターへの参加が必要です**, and a link
  **accounts.gdgs.jp** whose `href` ends in `/onboarding` (`snapshot --urls`). Reload; the same
  page must render. Screenshot.
- Member. In `mc-operator`, `goto` the `operator` fixture login URL. Require the tablist
  **トラック** with tab `A` selected (`aria-selected=true`), the first card file `01_0930`, the
  lamp named **司会PC 接続中**, and the button **音声を追加**. `goto /no-chapter` must land back on
  `/`. Read `/api/auth/me` with `orca eval --expression "fetch('/api/auth/me').then(r=>r.json())"`
  and require `user.id` `dev-user-verify-mc`. Screenshot the controller.
- Other chapter. In `mc-outsider`, sign in with
  `/dev/login?as=verify-mc-outsider&chapter=2:other-chapter&return_to=/`. Require the same
  controller (tab `A`, **音声を追加**). This is the current product behavior: mc checks only that a
  chapter exists. Record it as an observation, not a failure.
- Sign-out (`mc-signout`, last). In `mc-operator`, start capture and `goto
  http://localhost:6187/auth/signout`. Require a 302 to `/signin` and then
  `/api/auth/signin?return_to=%2F`; stop before Accounts. Independent check: in the same profile,
  `goto http://localhost:6187/api/auth/me` and require `{"user":null}`; `curl` of `/` with no
  cookie still returns 302.

## Gotchas

`/dev/login` sessions bypass Accounts, so these journeys do not test OIDC. The sign-out redirect
chain ends at the Accounts origin; a connection error there is expected and is not a failure.
Do not record cookie values. Signing an identity in inside another identity's profile replaces
that profile's `gdgjp-mc` session cookie; keep one profile per identity. After `mc-signout`, the
`mc-operator` profile has no session; sign in again before any later journey.
