# connpass events update: `--capacity` fails because `#FieldMaxNum` is hidden

## Summary

`--capacity` を含む update ジョブは、全体定員ウィジェット `#FieldMaxNum` が hidden のため失敗する。参加受付ありのイベントでは定員が参加枠側にあり、イベント全体の定員 UI が使えない。

## Observed (2026-08-14, event `gdgkwansai` / `403756`)

`--capacity 42` を他フィールドと一緒に送ったジョブ:

```
locator.waitFor: Timeout 30000ms exceeded
waiting for locator('#FieldMaxNum').first() to be visible
locator resolved to hidden <span id="FieldMaxNum" class="adv_value">
```

この時点で `title` / `subtitle` / `description` までは反映済み（`fillEventEdit` は capacity より先にそれらを書く）。`capacity` 以降のフィールドはそのジョブでは未処理。

同じイベントで `--json` の `participationTypes[].maxParticipants` は 42 に更新できた。

## Expected

`--capacity` がこのイベント種別で意味を持つなら保存される。持たないならジョブを落とさず、参加枠定員へ indirection するか CLI/API で拒否する。

## Known fill path

`fillEventEdit` は `waitForBoundEvent(page, "#FieldMaxNum", "click")` のあと `#FieldMaxNum .FormEditable` を編集する。フィクスチャ上の `#FieldMaxNum` は `class="adv_value"` の span。
