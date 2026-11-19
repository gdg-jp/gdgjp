# meet.gdgs.jp

GDG Japan / GDG on Campus Japan 向けの Google Meet 管理アプリ。共有 Google Workspace アカウント `community-support@gdgoc.jp` のパスワードを配布せずに、チャプターメンバーが GDG Accounts ログインで Google Meet 会議を作成し、co-host・参加者登録、Google Calendar 予定の作成、会議生成ファイル（録画・文字起こし＋Gemini メモ・チャット記録）の自動共有と予定添付までを一貫して管理する。

全体設計とステージ計画は [`docs/plans/meet/00-overview.md`](../../docs/plans/meet/00-overview.md) を参照。

## 構成と Cloudflare バインディング

React Router v7 SSR on Cloudflare Workers（Worker 名 `gdgjp-meet`、本番ホスト `meet.gdgs.jp`）。

- **現在（Stage 01）**:
  - D1 (`DB` / `gdgjp-meet-db`): Relying-party 認証テーブル（`"user"`, `oidc_session`）
  - Service binding (`ACCOUNTS` → `gdgjp-accounts`): GDG Accounts OIDC 認証
- **後続ステージで追加予定**:
  - Stage 02: `ACCOUNTS_DIRECTORY` RPC（`MeetDirectoryService`、チャプターメンバー一覧取得）
  - Stage 03: Google OAuth 接続・暗号化トークン管理・Google API クライアント
  - Stage 04: 会議ドメインテーブル・Cloudflare Queues (`MEET_JOBS` / `gdgjp-meet-jobs`)
  - Stage 05: 会議の編集・再同期・取り消し
  - Stage 06: Workspace Events / Cloud Pub/Sub Push 受信・生成ファイル自動共有・毎時 cron

## ローカル開発

```sh
cp apps/meet/.dev.vars.example apps/meet/.dev.vars   # RP_SESSION_SECRET / IDP_CLIENT_SECRET を埋める
pnpm --filter @gdgjp/meet migrate:local
pnpm --filter @gdgjp/meet dev                         # http://localhost:5193
pnpm --filter @gdgjp/meet test
pnpm --filter @gdgjp/meet test:e2e
```

ローカルでは Accounts 経由せずに `/dev/login` でサインインできる（`APP_URL` が loopback 以外の本番では 404）。

- チャプター所属ユーザー: `http://localhost:5193/dev/login?as=organizer1&chapter=1:tokyo:organizer&return_to=/`
- チャプター未所属ユーザー: `http://localhost:5193/dev/login?as=guest1&chapter=none&return_to=/no-chapter`

## 本番デプロイ・運用手順

1. D1 データベース `gdgjp-meet-db` を作成し、発行された `database_id` を `apps/meet/wrangler.toml` に設定する。
2. 秘密情報を `wrangler secret put` で設定する（値を変えたら 3 のシードを再実行する）。
   - `gdgjp-meet`: `RP_SESSION_SECRET`（`openssl rand -base64 48`）、`IDP_CLIENT_SECRET`
   - `gdgjp-accounts`: `MEET_CLIENT_SECRET`（上記 `IDP_CLIENT_SECRET` と同一値）
3. `apps/accounts` のデプロイ後、管理者が `https://accounts.gdgs.jp/admin/seed-clients` を実行して `meet` クライアントを登録する。
4. `main` へのマージで GitHub Actions がビルド・デプロイ・リモートマイグレーションを実行する。
