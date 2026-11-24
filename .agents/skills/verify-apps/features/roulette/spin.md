# Visitor spin

An anonymous visitor opens `/<slug>` on a phone, spins once, and sees a result card. The
device cookie keeps the result, refuses a second spin, and the page never reveals stock.

## Sub-features

- `roulette-spin`: a deterministic win (No. 001, 大当たり, 1 等) and a deterministic loss
  (ハズレ), the result card, the sound toggle label.
- `roulette-one-per-device`: reload after a spin shows 「この端末ではもう抽選しました」 and no
  button; a new `roulette-device` cookie may spin; `/dev/reset/<slug>` lets every device spin
  again.
- `roulette-closed-soldout`: closed and sold-out states, and the admin's stock floor error.
- `roulette-invalid-slug`: unknown, reserved and malformed slugs return 404.

## How to get to it (user POV)

Open `http://localhost:6190/<slug>`, or 「開く」 on the admin page. The header shows
「GDG Roulette」, the project name as the h1, and the icon button 「音を消す」 (or
「音を出す」). Below the wheel: the button 「ルーレットを回す」 (it reads 「はなして回す！」
while held and 「回転中…」 while spinning), the hint 「長押しで勢いをためられます · 1 人 1 回まで」,
and the 「景品」 list. After the spin the stamp reads 「大当たり」 (rank 1), 「当たり」 (other
ranks), 「ざんねん…」 or 「おしい…！」 (loss). The result card (`output` element) shows the prize
as an h2; a win adds the rank badge, 「抽選番号」 `No. 00N`, 「日時」, and
「おめでとうございます！ この画面をスタッフに見せて、景品を受け取ってください。」; a loss says
「ご参加ありがとうございました。またの機会に！」.

## Driving it with Orca Browser

Preconditions: `verify-spin` is in カスタムモード with row 1 `Google Pixel 10`, stock 1,
100 %, row 2 ハズレ 0 %, and open ([settings.md](settings.md)). The visitor tab is in the
`verify-roulette-visitor` profile with `orca viewport --width 390 --height 844 --mobile`
re-applied after every navigation. Start `orca capture start` on the visitor tab.

`roulette-spin`:

1. `goto` `/verify-spin`. Require h1 `Verify 抽選` and an enabled 「ルーレットを回す」. Run
   `orca cookie get --url http://localhost:6190/` and record that `roulette-device` exists
   and is httpOnly (record the flag, not the value).
2. Click 「音を消す」; require the button name to become 「音を出す」. Click it again.
3. Click 「ルーレットを回す」. If a 「連打する」 or 「押す」 button appears, leave it; it presses
   itself. Wait up to 20 s for 「大当たり」. Require h2 `Google Pixel 10`, 「1 等」, `No. 001`, and
   no text containing 「残り」. Screenshot `roulette-win.png`. In `orca network`, require one
   `POST /verify-spin` whose response status is 200.
4. New device: `orca cookie delete --name roulette-device --url http://localhost:6190/`,
   `reload`. Click 「ルーレットを回す」, wait for 「ざんねん…」 or 「おしい…！」. Require h2
   「ハズレ」 and 「ご参加ありがとうございました。またの機会に！」. Screenshot `roulette-lose.png`.

`roulette-one-per-device`:

1. On the losing device, `reload`. Require the alert 「この端末ではもう抽選しました」 with
   「1 人 1 回までです。ご参加ありがとうございました。」, the ハズレ result card, and no
   「ルーレットを回す」 button.
2. Independent check, HTTP: with a cookie jar, `curl -s -c jar -o /dev/null
   http://localhost:6190/verify-spin`, then `curl -s -b jar -X POST
   http://localhost:6190/verify-spin.data` twice and record both bodies. The first is a real
   spin from a new device (status `won`, a ハズレ result, the next draw number). The second
   must be status `already` with the same number, not a new one. Then
   `curl -s -X POST http://localhost:6190/verify-spin.data` without the jar must contain
   `nocookie`.
3. `goto` `/dev/reset/verify-spin`. Require the final URL `/verify-spin`, an enabled
   「ルーレットを回す」, and no 「この端末ではもう抽選しました」. Spin again and require
   `No. 001` and `Google Pixel 10` (the win and its stock were reset too).

`roulette-closed-soldout`:

1. Admin: create `Verify 完売` / `verify-soldout`. Click 「景品を追加」, name row 1 `Tシャツ`
   (stock 1), click 「2 行目を削除」 (the ハズレ row), save, switch 「抽選を受け付ける」 on.
2. Visitor (new device): `goto` `/verify-soldout`, spin. Require the stamp 「大当たり」 (the
   only prize is rank 1), h2 `Tシャツ`, and `No. 001`.
3. Another new device: `reload`. Require 「景品はすべてなくなりました」 and
   「たくさんのご参加、ありがとうございました。」, and no 「ルーレットを回す」.
4. Admin: reload; require 景品の残り `0 個`. Fill 「個数（1 行目）」 `0`, save. Require
   「当選済みの 1 個より減らせません」.
5. Admin: switch 「抽選を受け付ける」 off. Visitor: reload; the closed alert
   「いまは抽選を受け付けていません」 and 「運営スタッフの案内をお待ちください。」 replace the
   sold-out alert. With the visitor page open, switch it on and off again in admin, then click
   the visitor's 「ルーレットを回す」 if enabled from the stale page: the server answers
   `closed` and the page revalidates into the closed alert without a result.

`roulette-invalid-slug`:

1. Anonymous: `goto` `/no-such-project`, `/new`, `/Bad_Slug`. Each shows 「404」,
   「ページが見つかりません」, 「URL が正しいか確認してください。」. Confirm each status with
   `curl -s -o /dev/null -w '%{http_code}'`.
2. `goto` `/VERIFY-SPIN`. It renders the `verify-spin` page (slugs are lower-cased), which is
   expected.
3. Organizer: `goto` `/admin/no-such-project`; require the same 404 page.

Evidence: win and lose screenshots, the cookie record, the network row for the POST, the curl
bodies, the reset redirect, the sold-out and closed screens.

## Gotchas

- A spin starts on release. Orca's `click` sends pointerdown then click, which is a short
  press; no long-press is needed.
- Staged finishes are random and take up to about 15 s; use `wait --text`, not a fixed sleep.
  Reduced motion is not settable in Orca, so the full animation always plays.
- Deleting `roulette-device` is the only way to be a new device in one profile. The cookie is
  httpOnly, so `eval` on `document.cookie` cannot see or clear it.
- `/dev/reset/<slug>` clears draws for every device of the project, not only the current one.
  It requires no sign-in on loopback; that is intended for local use only.
- The `.data` endpoint is React Router's single-fetch action URL used by the page itself; its
  body is turbo-stream encoded, so match on `already`, `nocookie` and the number rather than
  parsing JSON.
- A loss result has no 抽選番号 on screen even though the draw is numbered in the log.
