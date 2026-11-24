# mc track channels

Each track tab is its own channel (`McRoom` named `track:<id>`) with its own Player URL. The
controller asks before switching tabs, reconnects to the new track's room, and from then on
controls only that track's player.

## Sub-features

- `mc-track-channels`: clicking tab `B` asks **トラック B に切り替えますか？**; **キャンセル** keeps
  tab `A`; **切り替える** selects `B`. Track B's Player URL has `track=B` and a different token.
  Track A's player does not count on track B. Track A's token on a `track=B` URL is refused.
  Switching back to `A` shows A's player `ok` again and A's commands reach it.

## How to get to it (user POV)

The tablist **トラック** is at the top left of `/`. The selected tab survives a reload in the same
tab (`sessionStorage` key `mc-tab`).

## Driving it with Orca Browser

Preconditions: `operator` on `/` in `mc-operator`, tab `A`, and a track A player open in the
`mc-player` profile with the lamp `ok`. Read both URLs only into shell variables.

- Cancel. Click tab `B`. Require the alert dialog **トラック B に切り替えますか？**. Click
  **キャンセル**. Require tab `A` `aria-selected="true"` and the first card file `01_0930`.
- Switch. Click tab `B`, then **切り替える**. Require tab `B` selected and the first card file
  `B-01`. Within 6 s the lamp must be `down` although the A player is still open. Click the first
  card's **再生**: require the toast **配信PCが接続されていません**.
- Distinct token. Open **診断**. Require **Player URL (Track B)** and a value matching
  `/play\?track=B&t=[0-9a-f]{64}$`. Compare tokens without printing:
  `new URL(<B url>).searchParams.get('t') !== <A token>` must be true (keep the A token in a page
  variable set earlier with `window.__a=...`).
- Crossed token. Open a player tab with `track=B` and track A's token. Wait 3 s: the lamp on tab
  `B` stays `down`. Its network log shows the `/ws?role=player&track=B` upgrade refused (403).
  Close it.
- Back to A. Click tab `A`, confirm **切り替える**. Require the lamp `ok` (the A player never
  disconnected). Click the first card's **再生**; require `data-status="playing"`, then stop it
  with the bar's **停止** and **停止する**.
- Independent check. Reload the controller tab after selecting `B`: tab `B` is still selected.
  Open a fresh controller tab: it starts on `A` (sessionStorage is per tab).
- Evidence: dialog snapshots, lamp readouts per tab, the token-inequality boolean, and the
  crossed-token player's network status.

## Gotchas

The tablist uses manual activation: focusing a tab with arrow keys does nothing until Enter or a
click, and every switch asks first. A shared 共通 clip plays on the player of the track that is
selected at the moment of the press. Played marks and loops are per track, so a mark set on A
does not show on B.
