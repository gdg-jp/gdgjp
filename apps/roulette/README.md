# roulette.gdgs.jp

イベントの景品抽選アプリ。運営者が景品と個数を登録し、来場者が自分のスマートフォンで円盤ルーレットを 1 回ずつ回す。

- 運営者: `https://roulette.gdgs.jp/`（GDG チャプターメンバーのみ）。プロジェクトを作り、管理画面
  `https://roulette.gdgs.jp/admin/<slug>` で景品（最大 15 個）・個数（∞ はハズレ枠）・抽選モードを設定して、受付をオンにする。
  管理画面の「抽選ログ」に最新 50 件が出る。全件は CSV でダウンロードできる（端末 ID は含めない）。
- 来場者: `https://roulette.gdgs.jp/<slug>`（ログイン不要）。1 端末 1 回まで。景品名は見えるが、残り個数は見えない。

## 抽選モード

| モード | 当たり方 |
| --- | --- |
| 標準 | 残りの個数に比例する。∞ の景品は「想定人数 − 抽選済み − 景品の残り」個として数える |
| カスタム | 景品ごとの %（合計 100%）。なくなった景品の分は、残っている景品に比率どおり配る |
| 悪徳 | 「出さない」にした景品は当たらない。ほかの景品は標準と同じ比率。抽選画面とルーレットの見た目は標準と同じ |

モードは DB に保存していない。`project.method` が `fixed` ならカスタム、`box` なら標準で、`box` のうち
`prize.excluded` が立った景品があれば悪徳として扱う。

行の順番がそのまま等級（1 等、2 等…）になり、演出の強さも決まる（1 等 / それ以外 / ∞ = ハズレ）。

## 演出

パチンコ風の演出。結果はサーバーが先に決めていて、演出は見せ方を変えるだけ（確率には影響しない）。

- 当たりは必ず CHANCE のカットインのあと、ルーレットが心音つきでじわじわ進む。色が期待度で、青 → 赤 → 金 → 虹（虹は当たりのときだけ）
- その半分は「連打!!」になり、PUSH ボタンを連打するとゲージが溜まる。連打の回数は結果に関係しない
- 当たりの一部（1 等は 3 割）は「押せ!!」になる。一度手前で止まって暗転し、PUSH を押すと当たりに入る。押さなくても数秒で進む
- ハズレの 3 割も演出が入り、当たりの 1 マス手前で止まる（「おしい…！」）
- 振動は Vibration API を使う。iPhone には Vibration API がないので、iOS 18 以降の switch のハプティクスで代用する（実機では未確認）。画面も揺れる
- BGM は最初のタップで流れ始め、演出と結果のファンファーレの間は消える。右上のボタンで効果音ごと消せる

ローカルでは、抽選画面の URL に `?demo=push-gold` のように付けると演出を固定できる
（`crawl` / `renda` / `push` / `plain` と `blue` / `red` / `gold` / `rainbow`）。結果画面の「もう一度回す（開発用）」で、同じブラウザから何度でも回せる。

## Cloudflare

Workers Free プランで動く構成にしている。使うのは Workers・静的アセット・D1・accounts へのサービスバインディングだけで、
Durable Objects・KV・Queues・R2 は使わない。来場者 1 人の抽選は D1 への書き込み 3 行程度。
管理画面は 15 秒ごとに再読み込みするので、抽選ログは最新 50 件だけを `(project_slug, number)` の索引で読む。

D1 データベース `gdgjp-roulette-db` は作成済みで、id は `wrangler.toml` にある。
`roulette.gdgs.jp` は `custom_domain = true` のルートなので、`wrangler deploy` が DNS レコードと証明書を作る。
main へのマージで GitHub Actions がデプロイとリモートのマイグレーションを行う。
デプロイのあとにマイグレーションが走るので、列を足す変更では、その間の数十秒ほど新しいコードがエラーを返す。
イベントの最中にはマージしない。

秘密情報は次の 3 つで、`wrangler secret put` で設定する。値を変えたら 3 の手順をやり直す。

1. roulette: `RP_SESSION_SECRET`（ランダムな文字列）
2. roulette: `IDP_CLIENT_SECRET` と、accounts（`gdgjp-accounts`）: `ROULETTE_CLIENT_SECRET`（同じ値）
3. accounts のデプロイ後、管理者が `https://accounts.gdgs.jp/admin/seed-clients` で OAuth クライアントを登録し直す。

## 開発

```sh
cp .dev.vars.example .dev.vars   # RP_SESSION_SECRET を埋める
pnpm --filter @gdgjp/roulette migrate:local
pnpm --filter @gdgjp/roulette dev        # http://localhost:5190/dev/login?as=owner&chapter=1:dev-chapter
pnpm --filter @gdgjp/roulette test
pnpm --filter @gdgjp/roulette test:e2e
```
