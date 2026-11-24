# Live check-in feature map

Live check-in (`apps/live-checkin`, Next.js App Router + Auth.js) is the reception desk for
connpass (and Luma) events: a staff member signs in with GDG Accounts, picks one of the
chapter's upcoming connpass events, and scans attendees' QR codes with the device camera; each
scan is proxied to `connpass.gdgs.jp` with the staff member's access token. Only members of the
`gdg-kwansai` chapter may use `/checkin`.

Drive these journeys in the stack started by [verify-apps](../../scripts/verify-apps.mjs) at
`http://localhost:6194` (`next dev`, `AUTH_SECRET` from `identities.mjs`,
`GDG_CLIENT_ID=live-checkin`, `ACCOUNTS_URL=http://localhost:6173`, which is normally absent, and
`CONNPASS_URL=http://127.0.0.1:9`, deliberately unreachable). Every journey starts as
`NOT VERIFIED`; a recipe here is not execution evidence.

Local limits: no real sign-in can finish (Accounts absent), no connpass call can succeed (every
proxy request fails to connect), and QR scanning needs a camera. What remains observable is the
access gate, the forbidden page and its sign-out, the scanner shell, the settings modal's
failure state, and the proxy's error responses.

## Identities

Identities are Auth.js JWT session cookies minted by `identities.mjs` with the helper's
`AUTH_SECRET` and the salt `authjs.session-token`. Read the value from the storage-state file
named in `ready.json` (`applications["live-checkin"].cookieFixtures.<identity>`) and set it on an
isolated Orca profile as cookie `authjs.session-token`, domain `localhost`, path `/`, HttpOnly,
SameSite Lax. Do not print the value.

| Identity | Claims | Reaches |
| --- | --- | --- |
| Anonymous | none | `/`, `/forbidden`; `/checkin` redirects to `/`; APIs answer 401 |
| `kwansai` | `sub` `verify-kwansai`, chapter 7 `gdg-kwansai` organizer, access token `verify-kwansai-access-token` | `/checkin`; APIs pass the gate and then fail upstream |
| `outsider` | `sub` `verify-outsider`, chapter 1 `dev-chapter` member | `/checkin` redirects to `/forbidden`; APIs answer 403 |

The minted tokens are stateless: signing out deletes the browser cookie but the same value can
be set again in a new profile.

## Routes

| Route | Who can reach it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | Anyone (signed-in users are not redirected) | **GDG Accounts でログイン** (Auth.js `signIn("gdg-accounts")`, callback `/checkin`) | h1 **GDG 受付システム**, GDG Japan Connpass・Luma API Mode, 連続受付を開始するには GDG Accounts でのログインが必要です。 |
| `/checkin` | `kwansai` only; anonymous 307 to `/`, other chapters 307 to `/forbidden` (`proxy.ts`) | **受付設定** (opens modal), **カメラを切り替え**, 人参加予定 number input, **イベントページの管理** (connpass link), **次に進む** after a scan | `Loading...` until the session loads; h1 **connpass 連続受付システム**; idle overlay QRコードをフレーム内にかざしてください; 出席確認済み `---` 未対応; 連続受付アクティブ; result overlays 受付完了！ / 既に受付済みです / errors |
| Settings modal (on `/checkin`) | `kwansai` | event radio list, **保存**, **キャンセル** / **閉じる** / Escape (only once an event is configured), **再読み込み** | dialog **受付設定**; イベントを取得中...; イベントの取得に失敗しました; 選択可能なイベントがありません |
| `/forbidden` | Anyone | **ログアウト** (server action `signOut({ redirectTo: "/" })`) | h1 **利用できません**, この受付システムは GDG Greater Kwansai 所属メンバー専用です。… |
| `/api/auth/*` | Auth.js plumbing (`session`, `csrf`, `providers`, `signin/gdg-accounts`, `callback/gdg-accounts`, `signout`, `error`) | none | `/api/auth/error?error=Configuration` renders Auth.js **Server error** |
| `/api/events` (GET) | `kwansai` | none | 401 / 403 / upstream result; locally 500 |
| `/api/checkin` (POST `{ url }`) | `kwansai` | none | 401 / 403 / upstream result; locally 500 |

## Journeys

| Journey ID | Feature | Identity | Recipe | Status |
| --- | --- | --- | --- | --- |
| `live-checkin-login-page` | Login page content | Anonymous | [access.md](access.md) | In map |
| `live-checkin-signin-start` | **GDG Accounts でログイン** starts Auth.js sign-in; locally it ends on the Configuration error | Anonymous | [access.md](access.md) | In map |
| `live-checkin-gate` | `/checkin` gate: anonymous to `/`, other chapter to `/forbidden`, `gdg-kwansai` allowed | Anonymous, `outsider`, `kwansai` | [access.md](access.md) | In map |
| `live-checkin-forbidden-signout` | Forbidden page and its **ログアウト** | `outsider` | [access.md](access.md) | In map |
| `live-checkin-settings` | Blocking settings modal when events cannot be fetched, **再読み込み** | `kwansai` | [checkin.md](checkin.md) | In map |
| `live-checkin-scanner-shell` | Scanner screen with a stored event: idle overlay, reopen and close settings, expected-count progress, event link | `kwansai` | [checkin.md](checkin.md) | In map |
| `live-checkin-api-proxy` | `/api/events` and `/api/checkin` auth gate and unreachable-upstream error | Anonymous, `outsider`, `kwansai` (HTTP) | [checkin.md](checkin.md) | In map |
| `live-checkin-event-select` | Choosing an event from the connpass list and **保存** | `kwansai` | none | Outside: the list comes from connpass (`/api/groups/gdgkwansai/events`), which is unreachable by design; **保存** stays disabled without a listed event |
| `live-checkin-qr-scan` | Camera QR decode, QR validation, check-in result overlays, promo code, sound | `kwansai` | none | Outside: needs a camera stream and a live connpass check-in; the page has no manual URL entry, so `validateCheckInURL` (対象外のQRコードです) is reachable only through a decoded QR |
| `live-checkin-oidc-signin` | Completing sign-in through GDG Accounts and chapter claims | Accounts session | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
