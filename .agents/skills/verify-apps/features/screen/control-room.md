# Control room

The operator assigns speakers to output slots, goes ON AIR, sends cue cards and chat, and
runs the timer. Every change travels through the stage's room socket to the speaker.

## Sub-features

- `screen-slot-assignment`: **A に出力** and **A の割り当てを解除**.
- `screen-on-air-cues`: **ON AIR**, preset and custom cues, speaker **OK**, timer **開始**.
- `screen-chat`: speaker chat reaches the operator **チャット** tab.
- `screen-operator-name`: the operator name button; speakers see it on the operator tile.
- `screen-stage-reset`: **メニュー** → **リセット** clears history, slots, ON AIR and timer.

## How to get to it (user POV)

Operator at `/stages/<id>`; speaker joined in another profile ([speaker](speaker.md)).

## Driving it with Orca Browser

- Presence: snapshot `--selector '[aria-label="参加者"]'`; require a row `Verify Speaker` with
  group `Verify Speaker の出力枠`.
- Assignment: click **A に出力**. Operator `出力枠 A` lists `Verify Speaker` and
  **A の割り当てを解除**. On the speaker, `eval` `.sc-slot-badge` text is `A`. Click
  **A の割り当てを解除**; the badge is gone and an output page for A reports `peer: null`.
- ON AIR and cues: click **ON AIR**; speaker `.sc-chip` tone becomes `onair`. Click
  **残り 5 分**; the speaker alert reads `残り 5 分です / 5 minutes left`. Speaker clicks **OK**;
  zero alerts remain. Fill **カンペ** `verify custom cue`, click **カンペを送る**; the speaker
  alert shows it. Reload the speaker before acknowledging; the cue is still shown.
- Timer: click **開始**; within a few seconds the speaker text shows a time below `20:00`.
- Chat: speaker fills **送信** and presses Enter; operator clicks tab **チャット** and reads the text.
- Operator name: click the operator name button, fill **登壇者に表示される名前**, **保存**; the
  button shows the new name and the speaker room text includes it.
- Reset: **メニュー** → **リセット** → **リセット**; ON AIR off, slots `空き`, chat empty.

Capture each action receipt, a speaker screenshot while ON AIR with a cue, and the `eval`
readouts.

## Gotchas

`screen-operator-name` and `screen-stage-reset` have recipes but were not executed in the
first run. Without media the operator tile and slot previews show `カメラなし`; video
assertions from `apps/screen/e2e/stage.spec.ts` belong to `screen-media`, outside this map.
