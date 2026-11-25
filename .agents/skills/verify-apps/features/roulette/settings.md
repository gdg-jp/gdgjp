# Prize settings, draw modes, and opening

On `/admin/<slug>` the organizer edits prize rows, picks 標準 / カスタム / 悪徳, saves, and turns
on 「抽選を受け付ける」. The visitor page shows prize names and ranks but never stock, odds, or
exclusions.

## Sub-features

- `roulette-prize-settings`: add, rename, reorder, delete rows; ∞ (losing slot); 想定人数;
  the 今の確率 preview; client-and-server validation; 「変更を保存」 and
  「未保存の変更があります」.
- `roulette-evil-mode`: a prize marked 「出さない」 stays on the visitor's prize list and wheel
  but is never drawn.
- `roulette-open-toggle`: the switch, its toasts and status text, the 抽選画面の URL field with
  「コピー」 and 「開く」.

## How to get to it (user POV)

From `/` click the project link, or open `/admin/<slug>`. Cards from top: status (switch
「抽選を受け付ける」, 抽選回数, 景品の残り, 「抽選画面の URL」, 「コピー」, 「開く」), 「抽選モード」
(radios 「標準モード」, 「カスタムモード」, 「悪徳モード」 and, except in custom, 「想定人数」),
「景品」 (rows, 「景品を追加」, 「確率の合計 N%」 in custom), 「抽選ログ」. 「変更を保存」 and
「その他の操作」 sit in the page header.

Each row's controls are named per row: 「景品名（1 行目）」, 「個数（1 行目）」,
「個数を ∞ にする（1 行目）」, 「確率（1 行目）」 (custom), 「出さない（1 行目）」 (evil),
「1 行目を上へ」, 「1 行目を下へ」, 「1 行目を削除」. A new project has one row, ハズレ with ∞.
「景品を追加」 inserts a row (stock 1) above the first ∞ row. Row order is the rank.

## Driving it with Orca Browser

Preconditions: `organizer` profile signed in; project `verify-spin` exists
([projects.md](projects.md)). A visitor profile exists:
`orca tab profile create --label verify-roulette-visitor --scope isolated`, and its tab uses
`orca viewport --width 390 --height 844 --mobile` after each navigation.

`roulette-prize-settings`:

1. `goto` `/admin/verify-spin`. Require radio 「標準モード」 checked, 「想定人数」 `100`, one
   row with badge 「ハズレ」 and 「個数を ∞ にする（1 行目）」 checked.
2. Click 「景品を追加」. Require 「未保存の変更があります」, a new row 1 with badge 「1 等」, and
   ハズレ now on row 2. Leave 「景品名（1 行目）」 empty and click 「変更を保存」. Require the
   alert 「赤字の項目を直してから保存してください」 and 「景品名を入れてください」.
3. Fill 「景品名（1 行目）」 `Google Pixel 10`, fill 「想定人数」 `0`, save. Require
   「景品の個数の合計（1 個）以上にしてください」. Fill 「想定人数」 `100`. Require 今の確率
   `1.0%` on row 1 and `99%` on row 2 (pool = 100 − 0 − 1 = 99).
4. Click 「景品を追加」, fill row 2 `ステッカー`, fill 「個数（2 行目）」 `abc`, save. Require
   「0 以上の整数にしてください」. Fill `3`. Click 「2 行目を上へ」; require row 1 named
   `ステッカー` with 「1 等」. Click 「1 行目を下へ」 to restore, then 「2 行目を削除」.
5. Click radio 「カスタムモード」. Require 「想定人数」 gone and 「確率の合計 100%」 (the
   default ハズレ row carries 100, a new row 0). Fill 「確率（1 行目）」 `100`, save. Require
   「確率の合計を 100% にしてください（今は 200%）」. Fill 「確率（2 行目）」 `0`, save. Require
   the toast 「変更を保存しました」 and no 「未保存の変更があります」.
6. Independent check: reload. Require 「カスタムモード」 checked, row 1 `Google Pixel 10`
   stock `1` 確率 `100`, row 2 ハズレ 確率 `0`. In the visitor tab `goto` `/verify-spin` and
   require the 「景品」 list item 「1 等 · Google Pixel 10」 and no text containing 「残り」. The
   losing slot never appears on that list.

`roulette-open-toggle` (continue on `verify-spin`):

1. Visitor tab first: require 「いまは抽選を受け付けていません」, 「受付が始まると回せます」,
   and a disabled 「ルーレットを回す」.
2. Admin: require 「停止中です。抽選画面では回せません。」 and 「抽選画面の URL」 value
   `localhost:6190/verify-spin`. Click the switch 「抽選を受け付ける」. Require the toast
   「抽選の受付を始めました」 and 「受付中です。抽選画面で回せます。」.
3. Click 「コピー」. Require either toast 「URL をコピーしました」 or
   「コピーできませんでした。URL を選択してコピーしてください」; record which (Orca's clipboard
   permission decides it, so either is a pass). Click 「開く」. Require a new tab effect at
   `http://localhost:6190/verify-spin`; close it.
4. Independent check: reload the visitor tab; require an enabled 「ルーレットを回す」 and
   「長押しで勢いをためられます · 1 人 1 回まで」. `goto` `/` in the admin tab; require badge
   「受付中」.
5. Leave it open for [spin.md](spin.md). To check closing, switch off, require
   「抽選の受付を止めました」, reload the visitor tab and require the closed alert again, then
   switch back on.

`roulette-evil-mode`:

1. Admin: create project `Verify 悪徳` / `verify-evil` from `/`. Click 「景品を追加」, fill
   「景品名（1 行目）」 `Google Pixel 10`. Click 「悪徳モード」, save. Require
   「悪徳モードでは、出さない景品を 1 つ以上選んでください」. Check 「出さない（1 行目）」 and
   「出さない（2 行目）」, save; require 「出す景品を 1 つ以上残してください」. Uncheck
   「出さない（2 行目）」, save; require 「変更を保存しました」 and row 1 今の確率 `0%`. Switch
   「抽選を受け付ける」 on.
2. Visitor: `goto` `/verify-evil`. Require 「1 等 · Google Pixel 10」 on the prize list. Click
   「ルーレットを回す」 and wait up to 20 s for 「ざんねん…」 or 「おしい…！」. Require the
   result heading 「ハズレ」.
3. Repeat the spin as two more devices (`orca cookie delete --name roulette-device --url
   http://localhost:6190/` then `reload`). Every result must be ハズレ.
4. Independent check: reload admin. Require 「悪徳モード」 checked, 「出さない（1 行目）」
   checked, 抽選回数 `3 回`, and three ハズレ rows in the 抽選ログ table.

Evidence: screenshots after steps 5 and 6 of the settings journey, the visitor prize list, the
evil-mode result screens, and the admin page after the evil spins.

## Gotchas

- 「変更を保存」, the switch, and 「その他の操作」 are disabled until hydration. Wait for them
  to become enabled after every `goto` or `reload`.
- The admin page revalidates every 15 s while visible. A revalidation after a save resets the
  draft only when the saved revision changed; unsaved edits survive polling.
- Switching to 悪徳 and back clears the 出さない flags on save; the mode is derived from
  `project.method` plus the flags, not stored.
- A decimal percent is allowed (`inputMode="decimal"`); totals compare after rounding to two
  decimals.
- The evil journey proves exclusion only over the spins it runs; three losses with a single
  drawable ハズレ slot are deterministic, not statistical.
