# connpass events update: date/time pickers intercept save

## Summary

`--start-at` / `--end-at` と `--reserved-at` はジョブが失敗する。Playwright が「保存」を押すとき、connpass の datepicker / timepicker オーバーレイがクリックを遮る。

## Observed (2026-08-14, event `gdgkwansai` / `403756`)

`--start-at "2026-12-01T19:00:00+09:00" --end-at "2026-12-01T21:00:00+09:00"`:

```
locator.click: Timeout 30000ms exceeded
waiting for locator('#EventDates button.save').first()
<a href="#" class="ui-state-default">28</a> from
<div id="ui-datepicker-div" class="ui-datepicker ..."> subtree intercepts pointer events
```

GET の `startAt` / `endAt` は空のまま。

`--reserved-at "2026-11-01T10:00:00+09:00"`:

```
waiting for locator('#EventPublishReservation button.save').first()
<a class="ui-corner-all">02:30</a> from
<ul class="ui-timepicker ..."> subtree intercepts pointer events
```

GET の `reservedAt` は `null` のまま。

## Expected

日時フラグを渡したジョブが成功し、GET に ISO 日時が残る。

## Known fill path

`connpass/app/lib/connpass-ui/events.ts` の `fillEventEdit` が `splitDateTime` のあと `input[name="start_date"]` 等へ `fill` し、`#EventDates` / `#EventPublishReservation` の `button.save` をクリックする。`fill` がウィジェットを開いたまま保存クリックしている。
