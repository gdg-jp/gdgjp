# mc player presence and diagnostics

The controller shows whether the track's player is connected and healthy, and refuses commands
immediately when it is not. The player reports its state every 250 ms while audible and every
second otherwise; 3 s without it marks the player lost.

## Sub-features

- `mc-no-player`: with no player, the lamp is `down`, the strip reads
  **配信PCが接続されていません**, and **再生** fails at once with a toast of the same text.
- `mc-player-lost`: closing the player tab flags **配信PCが接続されていません** within about 6 s;
  opening it again returns the lamp to `ok` and clears the strip.
- `mc-wrong-token`: a player with a wrong 64-hex token never makes the lamp `ok`.
- `mc-multi-player`: two players on one track give lamp `data-state="multi"` with the count `2`
  and the 診断 issue **配信PCが複数接続されています**.
- `mc-player-diagnostics`: the 診断 player row shows preload `16/16` on track A
  (12 track clips + 4 共通), autoplay, volume `100%`, visibility, clock `ok`; a hidden player tab
  adds **配信PCのページが非表示です**.
- `mc-autoplay-unlock`: when the player's engine blocks autoplay, the player page shows the
  button **音声を有効にする**, the controller strip reads **配信PCで自動再生がブロックされています**,
  and clicking the button clears it.

## How to get to it (user POV)

The lamps sit at the top right of `/` beside **診断**. The red strip under the header shows the
first blocking issue. The player is whatever loads `/play?track=A&t=<token>`.

## Driving it with Orca Browser

Preconditions: `operator` on `/` in `mc-operator`, tab `A`, no player tab open. Read the Player
URL from **診断** without retaining the token. Use an isolated `mc-player` profile for players.
Lamp readout: `document.querySelector('[data-testid=player-lamp]').dataset.state`; strip
readout: `document.querySelector('[data-testid=issue]')?.textContent ?? null`.

- No player. Wait up to 6 s for the lamp `down` and the strip **配信PCが接続されていません**. Click the
  first card's **再生**. Require a toast **配信PCが接続されていません** within 1 s and no card with
  `data-status`. In **診断**, require the 配信PC row value `—` and a log row
  **配信PC 未接続のため失敗**. Screenshot.
- Player connects. `orca tab create --profile <mc-player id> --url <player URL> --split right`.
  Require the lamp `ok` within 5 s, named **配信PC 接続中**, the strip empty, and the 診断 log row
  **配信PC 接続**. Snapshot the player page: it has no content other than, possibly,
  **音声を有効にする**.
- Autoplay (conditional). If the player snapshot has **音声を有効にする**, require the controller
  strip **配信PCで自動再生がブロックされています** and 診断 autoplay `blocked`. Click the button in the
  player tab. Require 診断 autoplay `ok`, the strip cleared, and the log row **自動再生 解除**. If
  the button never appears and autoplay reads `ok`, record `mc-autoplay-unlock` as not
  observable in this engine.
- Diagnostics. In **診断**, wait until the player row's preload reads `16/16` (the issue list shows
  **配信PCで音声を読み込み中です** until then). Require volume `100%`, visibility `visible`, clock
  `ok`, and a UA string. Independent check: on the player tab,
  `performance.getEntriesByType('resource').filter(e=>e.name.includes('/audio/')).length` is at
  least 16. Then switch the Orca tab so the player is not visible (move it out of the split into
  a background tab) and require visibility `hidden` and the issue **配信PCのページが非表示です** in
  the 診断 list (not in the strip; it is non-blocking). Make it visible again.
- Player lost. Close the player tab (`orca tab close --page <player page id>`). Require the strip
  **配信PCが接続されていません** within 6 s and the log row **配信PC 切断**. Reopen it with
  `tab create` and the same URL. Require the lamp `ok` within 8 s and no `data-testid=issue`.
- Wrong token. Open a second player tab whose URL replaces the token with 64 zeros
  (`/play?track=A&t=0000...0000`). Close the real player first. Wait 3 s: the lamp stays `down`.
  Independent check: the wrong-token player tab's `orca network` shows the `/ws` upgrade answered
  403 and retried. Close it.
- Multiple players. Open two player tabs with the real URL. Require the lamp `multi` with the
  visible count `2`, aria name **配信PCが複数接続されています**, and that issue in 診断. Close one;
  the lamp returns to `ok`.
- Evidence: lamp and strip readouts with timestamps, 診断 screenshots, the player tabs' network
  status for `/ws`, and the resource-count eval.

## Gotchas

Orca Browser has no offline switch, so the Playwright "setOffline" check is replaced by closing
and reopening the player tab; record that substitution. The player page is blank by design; a
blank snapshot is not a failure. Autoplay policy depends on Orca's engine; do not fake the
blocked state through `eval`. Several player tabs in one profile are fine because the player's
credential is the URL token, not a cookie. A player URL must not be retained in evidence; keep
it in a shell variable for `tab create`.
