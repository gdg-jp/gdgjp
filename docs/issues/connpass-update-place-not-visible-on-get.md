# connpass events update: `--place` / `--address` job succeeds but GET stays empty

## Summary

会場名と住所の update ジョブは `succeeded` だが、直後の GET では `place` / `address` が空文字のまま。

## Observed (2026-08-14, event `gdgkwansai` / `403756`)

```
gdg connpass events update gdgkwansai 403756 \
  --place "グランフロント大阪" \
  --address "大阪府大阪市北区大深町" \
  --wait
```

ジョブ `request`:

```json
{ "place": "グランフロント大阪", "address": "大阪府大阪市北区大深町" }
```

`status: succeeded`。続けて `gdg connpass events get` すると `place: ""`, `address: ""`。

他フィールドと同時に走らせたジョブでも、会場は GET に現れなかった。

## Expected

ジョブ成功後の GET に会場名と住所が入る。保存失敗ならジョブは `failed` であるべき。

## Known read/write split

書き込み: `fillEventEdit` が `openPlaceEditor` のあと `#FieldPlace input[name="name"]` / `input[name="address"]` を fill して `#FieldPlace` を保存。

読み取り: 埋め込み Backbone の `place` は常に null というコメントがあり、GET は `scrapePlaceFromDom`（`#FieldPlace table tr.spot td` / `tr.place td`）に依存する。保存 UI と読み取り DOM が一致していない可能性がある。この issue 作成時点では、未保存なのかスクレイプ漏れなのかは切り分けていない。
