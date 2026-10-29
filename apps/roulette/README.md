# roulette.gdgs.jp

イベントの景品抽選アプリ。運営者が景品と個数を登録し、来場者が自分のスマートフォンで円盤ルーレットを 1 回ずつ回す。

- 運営者: `https://roulette.gdgs.jp/`（GDG チャプターメンバーのみ）。プロジェクトを作り、管理画面
  `https://roulette.gdgs.jp/admin/<slug>` で景品（最大 15 個）・個数（∞ はハズレ枠）・抽選方式を設定して、受付をオンにする。
- 来場者: `https://roulette.gdgs.jp/<slug>`（ログイン不要）。1 端末 1 回まで。景品名は見えるが、残り個数は見えない。

## 抽選方式

| 方式 | 当たり方 |
| --- | --- |
| 確率を指定 | 景品ごとの %（合計 100%）。なくなった景品の分は、残っている景品に比率どおり配る |
| くじ箱 | 想定人数ぶんのくじから引く。残り枚数に比例し、∞ の景品は「想定人数 − 抽選済み − 景品の残り」枚 |
| 均等 | 残っている景品のどれかが同じ確率 |

行の順番がそのまま等級（1 等、2 等…）になり、演出の強さも決まる（1 等 / それ以外 / ∞ = ハズレ）。

## Cloudflare

Workers Free プランで動く構成にしている。使うのは Workers・静的アセット・D1・accounts へのサービスバインディングだけで、
Durable Objects・KV・Queues・R2 は使わない。来場者 1 人の抽選は D1 への書き込み 3 行程度。

初回デプロイの前に、次を一度だけ行う。

1. `wrangler d1 create gdgjp-roulette-db` を実行し、表示された `database_id` を `wrangler.toml` に書く。
2. 秘密情報を設定する: `wrangler secret put RP_SESSION_SECRET` と `wrangler secret put IDP_CLIENT_SECRET`
   （accounts 側の `ROULETTE_CLIENT_SECRET` と同じ値）。
3. accounts に `ROULETTE_CLIENT_SECRET` を設定してデプロイし、`/admin/seed-clients` で OAuth クライアントを登録し直す。
4. `roulette.gdgs.jp` の DNS（gdgs.jp ゾーン）を用意する。ルートは `wrangler.toml` の `[[routes]]`。

## 開発

```sh
cp .dev.vars.example .dev.vars   # RP_SESSION_SECRET を埋める
pnpm --filter @gdgjp/roulette migrate:local
pnpm --filter @gdgjp/roulette dev        # http://localhost:5190/dev/login?as=owner&chapter=1:dev-chapter
pnpm --filter @gdgjp/roulette test
pnpm --filter @gdgjp/roulette test:e2e
```
