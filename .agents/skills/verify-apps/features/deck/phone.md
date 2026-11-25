# deck phone controller

The phone page `/d/<deck>` shows the deck's keys and sends only "key X was pressed" to the room.
The room resolves the press against the saved layout and the dock runs the OBS requests. Keys
reflect live OBS state (scene live, streaming, muted) and follow editor saves without reload.

## Sub-features

- `deck-press-scene`: **休憩** sets the program scene to `Break` and turns `aria-pressed="true"`.
- `deck-press-confirm`: **配信（0.8 秒長押し）** ignores a tap and fires after a 0.8 s hold
  (stream on, elapsed badge `mm:ss`, chip **配信**); **録画（2 回タップ）** shows `もう一度` after the
  first tap and toggles recording on the second within 1.5 s (chip **録画**).
- `deck-press-momentary`: **トーク（押している間）** unmutes `Mic` while held and mutes it on release.
- `deck-press-multi`: **締め** switches to `Ending`, waits 300 ms, then hides `Logo` in `Main`.
- `deck-folder-nav`: **その他** opens the folder (header `/ その他`), **ホットキー** triggers
  `OBSBasic.Screenshot`, **戻る** returns to the root keys.
- `deck-volume`: **マイク音量** opens a dialog titled **マイク音量** with the slider **音量** and value
  `-6.0 dB`; moving it sets `Mic`'s volume; **閉じる** closes it.
- `deck-live-layout`: renaming key **休憩** to **休憩中** in the editor and saving updates the phone.
- `deck-phone-layout`: at 390 × 844 the header is hidden, no chips float while connected, and the
  4 × 2 grid renders as 2 columns × 4 rows taller than 700 px.

## How to get to it (user POV)

From `/`, tap the deck row (it links to `/d/<deck>`), or choose **操作画面** in the editor. While
the room connects the page shows **接続しています…**; keys stay disabled until the dock reports a
connected OBS.

## Driving it with Orca Browser

Preconditions: `DECK` exists; the dock is connected to the fake OBS (`deck-dock-connect`) and is
the only dock. Seed the layout the e2e suite uses, plus a volume and a record key, through the
layout API (a precondition, not the journey): read the editor's current version from the
latest save response (or `1` for a fresh deck), then POST with `member.jar`:

```json
{"version":<current>,"layout":{"cols":4,"rows":2,"boards":{
"root":{"id":"root","name":"ホーム","pages":[{"id":"p1","keys":{
"0":{"id":"kbreak","title":"休憩","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"none"},"behavior":{"type":"action","action":{"op":"scene","scene":{"name":"Break","uuid":null},"target":"program"}}},
"1":{"id":"kstream","title":"配信","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"hold","ms":800},"behavior":{"type":"action","action":{"op":"stream","mode":"toggle"}}},
"2":{"id":"kptt","title":"トーク","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"none"},"behavior":{"type":"action","action":{"op":"mute","input":{"name":"Mic","uuid":null},"mode":"pushToTalk"}}},
"3":{"id":"kmulti","title":"締め","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"none"},"behavior":{"type":"multi","steps":[{"type":"obs","action":{"op":"scene","scene":{"name":"Ending","uuid":null},"target":"program"}},{"type":"wait","ms":300},{"type":"obs","action":{"op":"sourceVisibility","scene":{"name":"Main","uuid":null},"source":{"name":"Logo","uuid":null},"mode":"off"}}]}},
"4":{"id":"kfolder","title":"その他","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"none"},"behavior":{"type":"folder","board":"more"}},
"5":{"id":"kvol","title":"マイク音量","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"none"},"behavior":{"type":"action","action":{"op":"volume","input":{"name":"Mic","uuid":null},"mode":"slider","db":0}}},
"6":{"id":"krec","title":"録画","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"double"},"behavior":{"type":"action","action":{"op":"record","mode":"toggle"}}}}}]},
"more":{"id":"more","name":"その他","pages":[{"id":"p2","keys":{
"0":{"id":"kback","title":"戻る","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"none"},"behavior":{"type":"back"}},
"1":{"id":"khot","title":"ホットキー","look":{"icon":null,"image":null,"color":"neutral"},"lookOn":null,"confirm":{"mode":"none"},"behavior":{"type":"action","action":{"op":"hotkey","name":"OBSBasic.Screenshot"}}}}}]}}}}
```

Require 200 `{"ok":true,"version":<current+1>}`. Open `/d/$DECK` in `deck-member`, set
`orca viewport --page <id> --width 390 --height 844 --mobile`, and wait until **休憩** has no
`data-disabled`. Before each assertion, read the fake OBS with the script in
[README.md](README.md#independent-obs-read) and assert the change.

- Scene. Require **休憩** `aria-pressed="false"` (program `Main`). Click **休憩**. Require
  `aria-pressed="true"` within 2 s, `GetSceneList` → `currentProgramSceneName` `Break`, and the
  dock **操作ログ** row `休憩 — verify-deck (dev)`.
- Hold. Click **配信（0.8 秒長押し）** once; after 400 ms `GetStreamStatus.outputActive` is unchanged.
  Read the key's centre with
  `(r=>[r.x+r.width/2,r.y+r.height/2])(document.querySelector('[aria-label^="配信"]').getBoundingClientRect())`,
  then `orca mouse move --x --y`, `orca mouse down`, wait 1.1 s, `orca mouse up`. Require
  `outputActive` toggled, the key text matching `\d{2}:\d{2}` and increasing, and, at desktop
  width, the chip **配信**.
- Double tap. Click **録画（2 回タップ）** once: the face shows `もう一度` and `GetRecordStatus` is
  unchanged. Click again within 1.5 s: `outputActive` toggles and the key is `aria-pressed="true"`
  when recording.
- Push-to-talk. Move to **トーク（押している間）**, `orca mouse down`. While held,
  `GetInputMute {"inputName":"Mic"}` → `inputMuted` `false`. `orca mouse up`:
  `inputMuted` `true`.
- Multi. Click **締め**. Require `currentProgramSceneName` `Ending` and in
  `GetSceneItemList {"sceneName":"Main"}` item 2 (`Logo`) `sceneItemEnabled` `false`. The editor
  **操作ログ** shows **締め** with **成功**.
- Folder. Click **その他**. Require keys **戻る** and **ホットキー** (the root keys are gone). Click
  **ホットキー**; the dock log gains `ホットキー — verify-deck (dev)` and the editor log **成功**.
  Click the key **戻る** (the folder key, not the header button); **休憩** is back.
- Volume. Click **マイク音量**. Require the dialog **マイク音量** with description `Mic`, slider
  **音量**, and `-6.0 dB`. Focus the slider and press ArrowRight twice; require `-5.0 dB` and
  `GetInputVolume {"inputName":"Mic"}` → `inputVolumeDb` `-5`. Click **閉じる**.
- Live layout. As `member2` on `/decks/$DECK/edit` change **タイトル** of **キー: 休憩** to `休憩中` and
  **保存**. Without reloading the phone, require a key **休憩中** and no **休憩**.
- Phone layout. At 390 × 844, require `.dk-controller-head` not displayed,
  `document.querySelectorAll('.dk-float .dk-chip').length === 0`, the grid's computed
  `gridTemplateColumns` and `gridTemplateRows` splitting into 2 and 4 tracks, and its
  `getBoundingClientRect().height` above 700. Screenshot.
- Disabled. Close the dock tab. Require keys with `data-disabled`, the floating chip
  **ドック未接続**, and that a click on **休憩** sends nothing (no new log row). Reopen the dock.
- Evidence: per press, the OBS read before and after, the key's `aria-pressed` and text, the log
  rows, and one screenshot; for hold and push-to-talk, the mouse receipts with timings.

## Gotchas

Keys act on pointer events. A plain Orca `click` is a tap; holds need `mouse down` / `mouse up`
on the key's centre with a real delay. The accessible names of hold, double-tap, and momentary
keys include their hint, as in **配信（0.8 秒長押し）**. The seed replaces every key built in the
editor journeys; their uploaded image stays in R2 and D1 (pruning waits a day), so the access
journey's image check still works. The fake OBS state persists, so streaming or recording may already be on
from an earlier run step; assert the toggle. On a phone viewport the header (and its **戻る**)
is hidden; at desktop width there are two **戻る** controls in a folder, the header button and
the key. A press while the dock is down is refused in the UI; the room would log
**OBS のドックが接続されていません** only for a press that reaches it.
