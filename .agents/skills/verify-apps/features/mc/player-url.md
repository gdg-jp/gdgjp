# mc Player URL

The 診断 sheet shows the selected track's Player URL, copies it, and reissues it. Reissuing
invalidates the old URL at once and disconnects any player that used it.

## Sub-features

- `mc-player-url` reads **Player URL (Track A)**, checks its shape, and copies it.
- `mc-player-url-reissue` needs two confirmations; cancelling the second keeps the URL; the
  final reissue changes the URL and drops the connected player.

## How to get to it (user POV)

On the controller (`/`), choose the waveform button **診断** at the top right. The sheet opens on
the right with **Player URL (Track X)**, **コピー**, and **再発行**.

## Driving it with Orca Browser

Preconditions: `operator` signed in within the `mc-operator` profile on `http://localhost:6187/`
with tab `A` selected. For the reissue check, a player tab for track A is open and the lamp
named **配信PC 接続中** shows (see [presence.md](presence.md) for opening one).

- Read. Click **診断**. Require the heading text **Player URL (Track A)** and the read-only field
  of the same name. Read its value with
  `orca eval --expression "document.querySelector('[data-testid=player-url]').value"` and require
  `^http://localhost:6187/play\?track=A&t=[0-9a-f]{64}$`. Record only `track` and the token
  length, never the token.
- Copy. Click **コピー**. Require the toast **コピーしました**. Then compare without printing:
  `orca eval --expression "navigator.clipboard.readText().then(t=>t===document.querySelector('[data-testid=player-url]').value)"`
  must return `true`. If Orca denies clipboard read, the toast **コピーできませんでした** or a
  rejected promise is a recorded limitation, not a product failure.
- Reissue, cancelled. Store the current value in the page (`orca eval --expression
  "window.__before=document.querySelector('[data-testid=player-url]').value, true"`). Click
  **再発行**. Require an alert dialog **Player URL を再発行しますか？**; click **再発行する**. Require the
  second dialog **本当に Player URL を再発行しますか？** with the description containing
  **配信されません**. Click **キャンセル**. Require no alert dialog and
  `document.querySelector('[data-testid=player-url]').value===window.__before` to be `true`.
- Reissue, confirmed. Click **再発行**, **再発行する**, then **再発行する** again. Require the field
  value to differ from `window.__before` and still match the 64-hex shape. Require the log row
  **Player URL 再発行** in the sheet. Within 5 s the player lamp must be `data-state="down"` and
  the issue strip (`data-testid=issue`) must read **配信PCが接続されていません**.
- Independent check. Reload the controller and reopen **診断**: the field shows the new value
  (it is stored in the track's `McRoom`). Reload the old player tab: the lamp stays `down` for
  at least 3 s. Open a new player tab with the new URL: the lamp returns to `ok`.
- Evidence: snapshots of both dialogs, screenshot after reissue, the eval booleans, and a
  network capture of the player tab showing the `/ws?role=player` upgrade failing (403) after
  reload with the old token.

## Gotchas

The token is a credential for the player socket. Keep it out of retained artifacts; store it in
the page or a shell variable only for comparisons. Reissue breaks every copied Player URL for
that track for the rest of the run, so run it after the playback and presence journeys or
copy the new URL before continuing. Escape closes the sheet; the reissue dialogs are alert
dialogs and need their own buttons.
