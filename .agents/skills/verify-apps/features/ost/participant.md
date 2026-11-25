# Participant page

A participant submits topics and votes; the projector screen updates live.

## Sub-features

- `ost-submit-topic`: required field, confirmation, live appearance on `/<slug>/screen`, server-side empty rejection.
- `ost-vote`: **👍** toggles one vote per device and persists through reload.

## How to get to it (user POV)

Open `http://localhost:6185/verify-ost` with no session. Keep the owner on
`/verify-ost/screen` in another profile showing `ライブ`.

## Driving it with Orca Browser

- Submit: click **送信する** with the field empty; `eval` the textarea `validity.valueMissing`
  is true. Fill the textbox `Verify topic alpha`, click **送信する**; page reads
  `送信しました 🎉`. Without reloading the owner tab, its text includes the topic.
- Server check: `curl -X POST -d 'text=' http://localhost:6185/verify-ost.data` returns
  `ok` false with `テーマを入力してください（200文字以内）。`. This replaces the e2e spec's DOM
  removal of `required`, which a user cannot do.
- Vote: submit `Verify topic beta`, click **投票する**, click **👍** in the alpha row. The owner
  snapshot hint shows `Verify topic alpha 1 票`. Click again: `0 票`; again: `1 票`. Reload the
  participant, reopen **投票する**; `eval` the alpha button `aria-pressed` is `true`.

## Gotchas

The screen may show `再接続中…` for a second after load; wait for `ライブ` before submitting.
Votes are keyed by the `ost-voter` cookie, so a second voter needs another isolated profile.
