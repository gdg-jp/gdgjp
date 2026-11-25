# Scanner screen, settings modal, and API proxy

A Kwansai staff member opens `/checkin`, chooses the event in **受付設定**, and scans QR codes.
Locally the connpass proxy is unreachable, so the modal shows its fetch-failure state, and only
the scanner shell is observable once an event id is already stored in the browser.

## Sub-features

- `live-checkin-settings`: with no stored settings the modal opens by itself: dialog **受付設定**,
  受付を行うイベントを以下から選択して下さい。, legend イベント（直近のものから順に表示）,
  イベントを取得中... (not dismissible while loading) then イベントの取得に失敗しました with the
  API's error text (locally サーバー間リクエストでエラーが発生しました) and **再読み込み**; **保存**
  disabled. Because no event can be chosen, **閉じる**, **キャンセル**, Escape and a backdrop click
  close it and leave the scanner screen with no event; **受付設定** reopens it. When the list has
  events the first-run modal stays blocking (no close controls) until one is saved.
- `live-checkin-scanner-shell`: with `localStorage["checkin:settings"]` holding a fresh event id,
  the page shows h1 **connpass 連続受付システム**, GDG Japan Connpass API Mode, button **受付設定**,
  the idle overlay QRコードをフレーム内にかざしてください, button **カメラを切り替え**, 出席確認済み with
  `---` and 未対応, the 人参加予定 number input and progress bar, link **イベントページの管理** to
  `https://connpass.com/event/<id>/`, and 連続受付アクティブ. Reopening **受付設定** gives a closable
  modal (**閉じる**, **キャンセル**, Escape, backdrop).
- `live-checkin-api-proxy`: `/api/events` and `/api/checkin` return 401
  `認証が必要です。ログインし直してください。` without a session, 403
  `このチャプターのメンバーのみ利用できます。` for another chapter, and, for `kwansai`, 500
  `サーバー間リクエストでエラーが発生しました` because the connpass fetch to `127.0.0.1:9` fails.
  `/api/checkin` first checks the URL against the connpass reception QR
  (`https://connpass.com/event/<n>/qr_checkin/<n>/<n>/`) and Luma ticket
  (`https://luma.com/check-in/evt-…?pk=g-…`) shapes and answers 400
  `受付対象外のチェックインURLです。` for anything else without contacting connpass.

## How to get to it (user POV)

Sign in as a Kwansai member; Auth.js returns to `/checkin`. The settings modal appears until an
event is chosen. Afterwards **受付設定** in the header reopens it.

## Driving it with Orca Browser

Identity: `kwansai`, cookie set on a fresh isolated profile before the first navigation (see the
[README](README.md)). Grant no camera permission.

- First-run modal. Start `orca capture`, `goto http://localhost:6194/checkin`. Wait for text
  **受付設定** in a dialog (`wait --text 受付設定`). Require the dialog texts above, then
  `wait --text イベントの取得に失敗しました`. Require the text
  サーバー間リクエストでエラーが発生しました in the dialog, button **再読み込み**, button **保存**
  disabled, and buttons **閉じる** and **キャンセル**. In the network capture require
  `GET /api/events` with status 500 and body error `サーバー間リクエストでエラーが発生しました`, and
  no browser request to any connpass host. Screenshot.
- Reload. Click **再読み込み**. Require a second `GET /api/events` (500) and the failure text again.
- Close without an event. Click **閉じる**; require the dialog gone and h1 **connpass 連続受付システム**
  with the idle overlay. Click **受付設定**; require the dialog with the failure text. Press Escape
  (`orca press Escape` or the equivalent key command); require it gone. Reopen and click outside
  the dialog; require it gone. Require `localStorage['checkin:settings']` still absent.
- Stored event. Precondition only: on the same page run
  `orca eval "localStorage.setItem('checkin:settings', JSON.stringify({groupId: 'gdgkwansai', eventId: '123456', savedAt: Date.now()}))"`
  and record that receipt, then `orca reload`. Require no dialog, h1 **connpass 連続受付システム**,
  the idle overlay text, **カメラを切り替え**, 出席確認済み `---` 未対応, 連続受付アクティブ, and link
  **イベントページの管理** with `href` `https://connpass.com/event/123456/`. Record the console line
  `Camera initialization failed:` if the browser has no camera; the overlay must still render.
- Expected count. Fill the number input next to 人参加予定 with `40`. Require its value `40` and the
  progress bar width `0%`
  (`document.querySelector('.bg-red-600.h-full').style.width`), since no check-in happened.
- Reopen settings. Click **受付設定**. Require the dialog with **閉じる** and **キャンセル**, the
  fetch failure text, and **保存** disabled. Press Escape; require the dialog gone. Reopen and click
  **キャンセル**; require it gone. Reopen and click **閉じる**; require it gone. Require
  `localStorage['checkin:settings']` still to contain `123456`.
- Camera toggle. Click **カメラを切り替え**; require no navigation and the idle overlay still shown.
  Do not assert a video stream.

Independent check (HTTP, cookie headers from the fixture files, never printed):

- `GET /api/events` anonymous: 401, JSON error `認証が必要です。ログインし直してください。`.
- `GET /api/events` as `outsider`: 403, `このチャプターのメンバーのみ利用できます。`.
- `GET /api/events` as `kwansai`: 500, `サーバー間リクエストでエラーが発生しました`.
- `POST /api/checkin` as `kwansai` with JSON
  `{"url":"https://connpass.com/event/123456/qr_checkin/1/2"}`: 500 with the same error; anonymous:
  401; `outsider`: 403.
- `POST /api/checkin` as `kwansai` with JSON `{"url":"https://connpass.com@evil.example/"}`, then
  `{"url":"https://connpass.com.evil.example/event/123456/qr_checkin/1/2/"}`: each 400
  `受付対象外のチェックインURLです。`, and `server.log` gains no `[checkin] Proxy Error` line for them.
- `server.log` in the evidence directory contains `[events] Proxy Error` and
  `[checkin] Proxy Error` lines whose cause is a refused connection to `127.0.0.1:9`, proving the
  proxy tried only the configured unreachable upstream.

Evidence: screenshots of the first-run failure modal, the scanner shell, and the reopened modal;
the sanitized `/api/events` network entries; the HTTP status table above.

## Gotchas

The localStorage write is a precondition standing in for a successful **保存**, which needs a
connpass event list; it is not evidence that event selection works. Settings expire after 24 hours
(`savedAt`), so write a fresh timestamp. The SSR HTML of `/checkin` only contains `Loading...`;
assert UI after the client session request (`/api/auth/session`) completes. The page fetches
`/api/events` only when the session has a `gdg-kwansai` chapter id. There is no field for the
group id or a manual event id, and no manual QR/URL entry, so the scan result overlays
(受付完了！, 既に受付済みです, 対象外のQRコードです, APIエラー：…) cannot be driven without a camera.
出席確認済み is hard-coded to `---` with the 未対応 badge; a stuck `---` is current behaviour, not a
failure.
