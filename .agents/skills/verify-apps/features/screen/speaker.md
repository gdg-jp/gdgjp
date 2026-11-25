# Speaker lobby and room

A speaker opens the invite link, checks devices, enters a name and joins the room.

## Sub-features

- `screen-invalid-invite`: an unknown stage shows `リンクが無効です` (`/join/<x>` 301s there).
- `screen-speaker-lobby`: language toggle, empty-name alert, joining, and reload staying in the room.

## How to get to it (user POV)

Open `http://localhost:6188/<stageId>/` in a profile with no session.

## Driving it with Orca Browser

- Invalid invite: `goto /join/not-a-token`; require URL `/not-a-token/` and text `リンクが無効です`
  (`Link is invalid` in English).
- Lobby: in a second isolated profile `goto /verify-stage/`. Orca sends an English
  Accept-Language, so the lobby shows **Join**. Click radio **日本語**; require **お名前** and
  **参加**. Click **参加** with the name empty; require alert `お名前を入力してください`. Fill
  **お名前** `Verify Speaker`; the alert disappears. Click **参加**; require **退出**, **送信**
  and **ミニ表示**. Reload; the room returns without the lobby.
- Check devices: `eval` `navigator.permissions.query` for camera and microphone. In the Orca
  isolated profile both are `denied`, so no real device is opened. Record the values.

## Gotchas

Without the SFU the connection chip stays `warn` or `down` and the page shows `再接続中…`.
That is expected locally and does not fail these journeys. Never grant this tab real camera
or microphone access to complete a journey.
