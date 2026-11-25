# Draw log, CSV, and reset

The admin page lists the latest 50 spins, refreshes every 15 seconds, offers every spin as a
CSV without device ids, and can reset all results.

## Sub-features

- `roulette-draw-log`: the 抽選ログ table (抽選番号, 景品, 日時), its empty message, live
  refresh, 「CSV をダウンロード」, and the CSV read independently over HTTP.
- `roulette-reset`: その他の操作 → 抽選結果をリセット → confirm; counts, log, and device
  records clear while prizes and mode stay.

## How to get to it (user POV)

On `/admin/<slug>` scroll to the 「抽選ログ」 card. With no draws it reads
「まだ抽選されていません」 and has no CSV button. With draws it shows rows newest first, the
note 「新しい順に表示しています。抽選結果をリセットすると消えます。」 (or, above 50 rows,
「新しい順に 50 件を表示しています。N 件すべては CSV で確かめられます。」), and the link
「CSV をダウンロード」 to `/admin/<slug>/draws.csv`. The header icon button 「その他の操作」
opens a menu with 「抽選結果をリセット」; the dialog 「抽選結果をリセットしますか？」 has
「キャンセル」 and 「リセットする」.

## Driving it with Orca Browser

Preconditions: `verify-spin` has exactly two draws, No. 001 `Google Pixel 10` and No. 002
ハズレ. [spin.md](spin.md) ends with one draw (the win after `/dev/reset`); spin once more from
a new visitor device to add the loss. If the state is unclear, `goto` `/dev/reset/verify-spin`
and spin from two new devices. Organizer tab on `/admin/verify-spin`.

`roulette-draw-log`:

1. Keep the admin tab open and visible. In the visitor profile, spin once more from a new
   device (it loses: stock is gone). Without reloading the admin tab, wait up to 20 s for
   抽選回数 `3 回` and a new top row `No. 003` with 「ハズレ」. This proves the 15 s polling.
2. Snapshot the table named 「抽選ログ」. Require row order `No. 003`, `No. 002`, `No. 001`, row
   `No. 001` with badge 「1 等」 and `Google Pixel 10`, and 日時 cells like `11/24 13:05`
   (Asia/Tokyo, month/day hour:minute).
3. Click 「CSV をダウンロード」. Require a `downloads` effect with filename
   `verify-spin-draws.csv`; record the saved path.
4. Independent check over HTTP with the organizer's identity in a cookie jar:

   ```sh
   curl -s -c org.jar -o /dev/null \
     'http://localhost:6190/dev/login?as=verify-roulette&chapter=1:dev-chapter&return_to=/'
   curl -s -b org.jar -D draws.headers -o draws.csv \
     http://localhost:6190/admin/verify-spin/draws.csv
   ```

   Require `200`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment;
   filename="verify-spin-draws.csv"`, `Cache-Control: private, no-store`. The body starts with
   the UTF-8 BOM, then `"No.","日時","等級","景品"`, CRLF line ends, rows oldest first:
   `"1","<YYYY-MM-DD HH:MM:SS>","1 等","Google Pixel 10"`, then `"2",…,"ハズレ","ハズレ"`,
   then `"3",…`. Require no UUID anywhere in the file (`grep -E
   '[0-9a-f]{8}-[0-9a-f]{4}-' draws.csv` prints nothing). Compare it byte for byte with the
   browser download.
5. Anonymous `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'` on the CSV URL returns
   `302` to `/signin?return_to=%2Fadmin%2Fverify-spin%2Fdraws.csv`.

`roulette-reset`:

1. Click 「その他の操作」, then menu item 「抽選結果をリセット」. Click 「キャンセル」; require
   抽選回数 unchanged. Reopen and click 「リセットする」.
2. Require the toast 「抽選結果をリセットしました」, 抽選回数 `0 回`, 景品の残り `1 個`, and
   「まだ抽選されていません」 in the log. Require 「カスタムモード」 still checked and both prize
   rows unchanged.
3. Independent checks: re-fetch the CSV with `org.jar`; it contains only the header line. In a
   visitor tab that had already spun, reload `/verify-spin`; require an enabled
   「ルーレットを回す」 instead of 「この端末ではもう抽選しました」.

Evidence: the table snapshot before and after reset, the download path, `draws.headers`,
`draws.csv`, the UUID grep output, and the reset toast screenshot.

## Gotchas

- Polling pauses while the tab is hidden (`document.visibilityState`); keep the admin tab in
  front during step 1, or reload instead and note that polling was not observed.
- The table shows at most 50 rows; the CSV has every row. Testing the 50-row note needs 51
  spins from 51 devices and is not part of this map.
- Keep `org.jar` and the CSV in the run's evidence directory; never paste the cookie value
  into a report.
- 日時 in the table has no year or seconds; the CSV has both.
