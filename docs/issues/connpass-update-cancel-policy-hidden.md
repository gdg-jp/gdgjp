# connpass events update: `--cancel-policy` fails because the textarea stays hidden

## Summary

`--cancel-policy` はジョブ失敗。`textarea[name="cancel_policy"]` は DOM にあるが hidden のまま。

## Observed (2026-08-14, event `gdgkwansai` / `403756`)

参加枠は無料（`fee: 0`, `feeType: "place"`）。`--cancel-policy "キャンセルポリシー検証"` を含むジョブ:

```
locator.waitFor: Timeout 10000ms exceeded
waiting for locator('textarea[name="cancel_policy"]').first() to be visible
locator resolved to hidden <textarea ... name="cancel_policy" id="input_about_cancel" ...>
```

同じジョブで先に書いた `--owner-text` と `--participant-only-info` は GET に残った。

## Expected

キャンセルポリシーがこのイベントで編集可能なら保存される。有料オプションを開かないと出ないなら、その手順を踏むか、非表示時は失敗せずスキップ/400 する。

## Known fill path

`fillEventEdit` は `#FieldEventType .JoinOptions` の click 待ちのあと、見えなければ `#FieldEventType button.FormEditable` でパネルを開き `textarea[name="cancel_policy"]` を fill する。今回は textarea が hidden のまま 10s で落ちた。
