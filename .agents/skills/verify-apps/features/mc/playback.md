# mc playback

The operator plays, stops, restarts, seeks, and loops clips on the selected track's player. The
player is the source of truth: a card only turns `playing` after the player's media clock moves.

## Sub-features

- `mc-playback`: **再生** on a card is acknowledged by the player; the card and the now-playing
  bar turn `playing`; the remaining time counts down; **停止** asks **再生を停止しますか？**
  (cancel keeps playing, **停止する** pauses); bar **再生** resumes without a question.
- `mc-restart-seek-switch`: **最初から再生** asks **最初から再生しますか？** while audible; the seek
  slider asks **再生位置を移動しますか？** / **移動する** while audible; **再生** on another card while
  audible asks **再生を切り替えますか？** / **切り替える**; seeking an idle card only sets its cue.
- `mc-played-marks`: playing a track clip sets **再生済み** (`aria-pressed=true`); the mark is room
  state shared by every controller; 診断 **再生済みをリセット** clears all marks after
  **再生済みをリセットしますか？** / **リセットする**.
- `mc-loop`: the bar's **ループ** toggle and **ループ間隔** (**短く** / **長く** step 5 s, field
  **ループ間隔（秒）**); a looping clip waits in `gap` with a countdown; stopping it asks
  **ループを停止しますか？**.
- `mc-common-clips`: a 共通 chip (for example **登壇準備中**) plays on the selected track's player.

## How to get to it (user POV)

Open `/` as a member with a player connected for the track (lamp **配信PC 接続中**). Cards list the
track's clips in order; the third card on track A is `03_1040`
(**10:40 Opening 終了 ＆ 村上 憲郎 学長 呼び込み**, 0:23). The header shelf holds the 共通 chips.

## Driving it with Orca Browser

Preconditions: `operator` signed in within `mc-operator` on `/`, tab `A` selected. Read the
Player URL from **診断** (see [player-url.md](player-url.md)), close the sheet with Escape, and
open it in a separate isolated profile `mc-player`:
`orca tab create --profile <mc-player id> --url <player URL> --split right --json`. A visible
split keeps the player out of the hidden state. Wait for the lamp `data-state="ok"`
(`orca eval --expression "document.querySelector('[data-testid=player-lamp]').dataset.state"`).
If the player tab shows **音声を有効にする**, click it first (see [presence.md](presence.md)).
Reset marks before `mc-played-marks` if earlier journeys played track A clips.

Card helpers used below (read-only evals on the controller page):
`document.querySelectorAll('article.mc-card')[2].dataset.status` (state of card 3) and
`document.querySelectorAll('article.mc-card')[2].querySelector('.mc-card-duration').textContent`
(remaining `m:ss`). Use `snapshot --selector "article.mc-card:nth-of-type(3)" --interactive`
to get the card's own refs.

- Play. Click card 3's **再生** (exact name, not **最初から再生**). Require `data-status`
  `playing`, card **再生済み** `aria-pressed="true"`, and the region **再生中** visible with
  `03_1040`. Read the remaining time, wait 2 s, read again: the second value must be smaller.
  In **診断**, the player row's status must read `playing · A-03` and clock `ok`.
- Stop, cancelled then confirmed. In region **再生中**, click **停止**. Require the alert dialog
  **再生を停止しますか？**; click **キャンセル**; status stays `playing`. Click **停止** again, then
  **停止する**; status becomes `paused` and the remaining time stops changing across 2 s.
- Resume. Click the bar's **再生**. No dialog; status `playing` again. Stop it with **停止** /
  **停止する**.
- Restart and seek. Play card 3 again. Click card 3's **最初から再生**; require
  **最初から再生しますか？**, click **最初から再生する**; the card's slider
  (named **10:40 Opening 終了 ＆ 村上 憲郎 学長 呼び込み**) reports `aria-valuenow` 0 or 1. Focus that
  slider and `orca keypress --key ArrowRight`; require **再生位置を移動しますか？**, click **移動する**;
  `aria-valuenow` rises by about 5.
- Switch. While card 3 plays, click card 4's **再生**. Require **再生を切り替えますか？**, click
  **切り替える**. Card 4 becomes `playing`; card 3 loses `data-status`. Stop with **停止** /
  **停止する**.
- Cue while idle. With nothing audible, focus card 5's slider and press ArrowRight twice. No
  dialog and no command (the 診断 log gets no new **コマンド送信**). Require
  `JSON.parse(localStorage.getItem('mc-cues'))['A-05']` to be about 10000. Click card 5's
  **再生**: the first remaining-time reading is about 10 s below the clip length. Stop it.
- Played marks. Open a second controller tab in `mc-operator` on `/` (tab `A`). Require the same
  cards to show **再生済み** pressed (cards 3, 4, 5). In the second tab click card 3's **再生済み**;
  the first tab's card 3 becomes `aria-pressed="false"` without reload. Then in **診断** click
  **再生済みをリセット**, require **再生済みをリセットしますか？**, click **リセットする**. Reload both
  tabs: no card has **再生済み** pressed.
- Loop. Play card 1 (`01_0930`, a loop clip). In region **再生中** require **ループ**
  `aria-pressed="true"`. Open **ループ間隔**, click **長く** once; the field **ループ間隔（秒）** reads 5
  and the trigger shows `5`. Focus the bar slider and press End, confirm **移動する**. Require
  card 1 `data-status` `gap` and a countdown number in the bar, then `playing` again within
  about 6 s. While in `gap` or `playing`, click the bar's **停止**; during `gap` the dialog is
  **ループを停止しますか？**. Click **停止する**. Independent check: reload; open **ループ間隔** on card 1's
  bar after playing it again, and the value is still 5. Set it back to 0 with **短く**.
- Common clip. Click the shelf chip **登壇準備中**. Require the bar **再生中** with `登壇準備中` and
  no track badge, and **診断** status `playing · X-01`. Let it end (7.2 s): status becomes `ended`.
- Evidence per step: a snapshot of the card or bar, the eval readouts (status, remaining time
  pairs, `aria-valuenow`, lamp state), the confirmation dialog snapshots, and one screenshot
  while playing.

## Gotchas

Audio is not observable directly. The player's `Audio` element is created with `new Audio()`
and never attached to the DOM, so `eval` on the player page cannot read its `src` or
`currentTime`. Use what the player reports: card `data-status`, remaining time, seek
`aria-valuenow`, and the 診断 player row. Whether sound is audible is outside the map. Commands
are never queued: with the lamp `down` every action fails with a toast instead. Each controller
tab is a separate controller; dialogs and cues are per tab, marks and loops are per track room.
A failed command shows a toast such as **配信PCから応答がありません**; record it with the 診断 log.

If 診断 shows the player clock `stalled`, the audio element is not advancing in this browser
session (seen when the Orca window is not frontmost); remaining-time, gap, and `ended`
assertions then cannot be read. Keep the player in a visible split and note the state.
