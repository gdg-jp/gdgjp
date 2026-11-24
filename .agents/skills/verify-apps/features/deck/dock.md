# deck OBS dock

The dock page runs inside OBS as a custom browser dock. Its URL token is its only credential.
It connects to obs-websocket on the same PC (settings stay in that browser's localStorage) and
to the deck's room, relays presses to OBS, and reports OBS state back.

## Sub-features

- `deck-dock-connect`: **デッキのメニュー** → **OBS のドック URL** shows **ドックの URL** and **コピー**;
  the first dock load opens the settings form; **保存して接続** with the fake OBS URL shows
  `OBS` `接続 (32.2.2)`; the editor's OBS chip reads `OBS 32.2.2 ・ シーン 3`; the home chip turns
  **接続中**; settings survive a dock reload.
- `deck-dock-token`: a wrong token shows **この URL は使えません。…**; **URL を再発行** →
  **ドックの URL を再発行しますか？** → **再発行** disconnects the open dock with
  **この URL は再発行されました。新しい URL をドックに設定してください。**; a second dock with the same URL
  replaces the first, which shows **別のドックが接続したため切断しました。** and
  **このドックで接続し直す**.
- `deck-dock-obs-offline`: an obs-websocket URL with nothing listening shows `OBS` **未接続** and
  the help text; the editor chip reads **OBS 未接続** and the phone keys disable.

## How to get to it (user POV)

In the editor, open **デッキのメニュー** (the **…** button) → **OBS のドック URL**. Paste the URL into
OBS (here: a browser tab). In the dock, **設定** opens **obs-websocket の URL**, **パスワード**,
**スクリーンショットの保存先フォルダ**, and **保存して接続**.

## Driving it with Orca Browser

Preconditions: `DECK` exists and has at least one saved key; `member` on `/decks/$DECK/edit`
in `deck-member`. The fake OBS listens on `ws://127.0.0.1:4467` (no password). Use a
session-less isolated profile `deck-dock` for the dock, as OBS has no deck session.

- Dock URL. Open **デッキのメニュー**, choose **OBS のドック URL**. Require the dialog **OBS のドック** and
  the field **ドックの URL** matching `^http://localhost:6189/dock/$DECK\?t=[A-Za-z0-9_-]{32}$`
  (read with `eval` on `input[aria-label="ドックの URL"]`; keep the value in a shell variable,
  not in evidence). Click **コピー**; require the toast **コピーしました**. Press Escape.
- First run. `orca tab create --profile <deck-dock id> --url <dock URL> --split right`. Require
  the header with the deck name, `deck.gdgs.jp` **接続**, the settings form open with
  **obs-websocket の URL** `ws://127.0.0.1:4455`, and within a few seconds `OBS` **未接続** plus
  **OBS の「ツール」→「WebSocket サーバー設定」でサーバーを有効にし、ポートとパスワードを設定に入れてください。**.
  The editor's chip now reads **OBS 未接続**.
- Connect. Fill **obs-websocket の URL** with `ws://127.0.0.1:4467`, leave **パスワード** empty, click
  **保存して接続**. Require the form closed and `OBS` `接続 (32.2.2)`. In the editor require
  `OBS 32.2.2 ・ シーン 3` and **OBS を読み直す** enabled; click it and require no error. On `/`,
  within 5 s the row chip is **接続中**. Independent checks: dock
  `JSON.parse(localStorage.getItem('deck-dock:$DECK')).obsUrl` is `ws://127.0.0.1:4467`; reload
  the dock and require `接続 (32.2.2)` again with the form closed.
- Press relay. After a phone press (see [phone.md](phone.md)), the dock region **操作ログ** lists
  `<key title> — verify-deck (dev)` and the editor **操作ログ** shows the same row with **成功**.
- Replace. Open a second dock tab in `deck-dock` with the same URL. Require the first dock to show
  **別のドックが接続したため切断しました。** and **このドックで接続し直す**, while the second reads
  `接続 (32.2.2)`. Click **このドックで接続し直す** in the first; it reconnects and the second shows
  the replaced message. Close the second.
- OBS offline. In the dock, **設定**, set **obs-websocket の URL** to `ws://127.0.0.1:4466`,
  **保存して接続**. Require `OBS` **未接続** with the help text, the editor chip **OBS 未接続**, and on
  an open phone the keys with `data-disabled` and the chip **OBS 未接続**. Set the URL back to
  `ws://127.0.0.1:4467` and require `接続 (32.2.2)`.
- Wrong token. `goto /dock/$DECK?t=wrong` in `deck-dock`: the page shows
  **この URL は使えません。デッキの編集画面から新しいドックの URL をコピーしてください。**.
- Reissue. In the editor dialog **OBS のドック**, click **URL を再発行**. Require
  **ドックの URL を再発行しますか？** with **本番中は再発行しないでください。**; click **やめる** first and
  require no change; then **URL を再発行** → **再発行**. Require the open dock to show
  **この URL は再発行されました。新しい URL をドックに設定してください。**, the editor chip
  **ドック未接続**, and the dialog field to hold a different token (reopen the dialog after the
  revalidation; compare without printing). Reload the old dock URL: **この URL は使えません。…**.
  Open the new URL in `deck-dock`: it connects with the saved settings (localStorage is per
  deck, not per token).
- Evidence: dock and editor snapshots per state, the dock settings readout, the home chip
  snapshot, dialog receipts, screenshots of the replaced and revoked docks.

## Gotchas

The fake OBS has no password, so any password connects and **パスワードが違います** is not
reachable. The dock talks to `ws://127.0.0.1:4467` from the browser itself; Orca's engine must
allow a page on `http://localhost:6189` to open that socket (it is plain `ws`, no mixed
content). Keep only one dock connected while running phone journeys, or the replaced one stops
relaying. After reissue every earlier copy of the dock URL is dead; keep the new URL for later
journeys. The fake OBS state is shared by every dock and by the independent read script.
