# pr.gdgs.jp

GDG Japan のイベント集客（PR）を、1 イベント = 1 キャンペーンで進めるアプリ。

- **brief** にイベントの事実・メタテーマ・セッション・登壇者・予算を入れる
- **スケジュール**に投稿・告知・依頼を並べる。X / Instagram 投稿には 60 分前のスタッフ依頼、登壇者付きの X 投稿には
  180 分前の引用依頼が自動で付く（格が高い登壇者は提案のみ）。セッションが確定するまで告知を止められる
- **告知先**は Wiki の「イベント告知対象とコネクション保有者」から取り込む
- 主催チャプターに共催チャプターを足すと、共催のメンバーも同じキャンペーンを扱える

判断基準は `skills/pr-playbook`（gdg-jp/skills）に言語化してあり、アプリはそれを同梱する。

## 初回デプロイ

1. `wrangler d1 create gdgjp-pr-db` → `wrangler.toml` の `database_id` を置き換える
2. `wrangler secret put RP_SESSION_SECRET` / `IDP_CLIENT_SECRET`（pr 側）
3. accounts に `wrangler secret put PR_CLIENT_SECRET`（同じ値）→ accounts をデプロイ → `/admin/seed-clients` を実行
4. `pnpm --filter @gdgjp/pr migrate:remote && pnpm --filter @gdgjp/pr run deploy`
