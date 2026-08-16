# connpass events update: `--registration-enabled=false` job succeeds but GET stays true

## Summary

`--registration-enabled=false` のジョブは成功し `request.registrationEnabled` は `false` だが、GET は `registrationEnabled: true` かつ `eventType: "participation"` のまま。

## Observed (2026-08-14, event `gdgkwansai` / `403756`)

更新前: `registrationEnabled: true`, `eventType: "participation"`。

```
gdg connpass events update gdgkwansai 403756 --registration-enabled=false --wait
```

ジョブ `request`: `{ "registrationEnabled": false }`, `status: succeeded`。

直後の GET: `registrationEnabled: true`, `eventType: "participation"`。

続けて `--registration-enabled`（true）もジョブ成功。GET はもともと true のままなので、true 方向が効いたかは判断できない。

CLI が `false` を送ること自体はモック PATCH で確認済み（`Changed()` しているため）。

## Expected

`false` なら告知イベント（`eventType` が advertisement 相当）になり、GET の `registrationEnabled` が `false` になる。クリックが効かないならジョブは失敗する。

## Known fill/read path

書き込み: `fillEventEdit` が `registrationEnabled` に応じて `#EventTypeParticipation` / `#EventTypeAdvertisement` を jQuery click し、`#FieldEventType` を保存。

読み取り: `registrationEnabled: model.event_type === "participation"`。GET が true のままなのは、UI クリックが種別を変えていないか、保存されていないか。
