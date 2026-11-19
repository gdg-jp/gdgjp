# meet.gdgs.jp

GDG Japan / GDG on Campus Japan 向けの Google Meet 管理アプリ。共有 Google Workspace アカウント `community-support@gdgoc.jp` のパスワードを配布せずに、チャプターメンバーが GDG Accounts ログインで Google Meet 会議を作成し、co-host・参加者登録、Google Calendar 予定の作成、会議生成ファイル（録画・文字起こし＋Gemini メモ・チャット記録）の自動共有と予定添付までを一貫して管理する。

全体設計とステージ計画は [`docs/plans/meet/00-overview.md`](../../docs/plans/meet/00-overview.md) を参照。

## 構成と Cloudflare バインディング

React Router v7 SSR on Cloudflare Workers（Worker 名 `gdgjp-meet`、本番ホスト `meet.gdgs.jp`）。

- **D1 (`DB` / `gdgjp-meet-db`)**: Relying-party 認証（`"user"`, `oidc_session`）、共有 Google 接続（`google_connection`, `google_oauth_state`）、会議管理（`meetings`, `meeting_invite_sources`, `meeting_invitees`）、開催回・生成ファイル・通知・購読管理（`conference_records`, `artifacts`, `processed_events`, `google_subscription`）
- **Service binding (`ACCOUNTS` → `gdgjp-accounts`)**: GDG Accounts OIDC 認証・チャプター一覧取得
- **Service binding (`ACCOUNTS_DIRECTORY` → `gdgjp-accounts` / `MeetDirectoryService`)**: アクティブなチャプターメンバー一覧を取得する内部 RPC
- **Queue (`MEET_JOBS` / `gdgjp-meet-jobs`)**: `sync_members`・`cleanup_meeting`・`process_artifact`・`share_artifact` の直列非同期処理（`max_batch_size = 1`, `max_concurrency = 1`）
- **Cron Trigger (`7 * * * *`)**: 毎時実行で Workspace Events 購読の維持・過去 7 日以内の `active` 会議の取りこぼし補完・未完了 `artifacts` の再投入を実行
- **Pub/Sub Push エンドポイント (`POST /api/google/events`)**: Cloud Pub/Sub Push の Google 署名 OIDC JWT を WebCrypto で検証して Workspace Events 通知を受信（`PUBSUB_PUSH_SERVICE_ACCOUNT` 未設定時は全拒否）

## ローカル開発

```sh
cp apps/meet/.dev.vars.example apps/meet/.dev.vars   # 必要な秘密情報・設定値を埋める
pnpm --filter @gdgjp/meet migrate:local
pnpm --filter @gdgjp/meet dev                         # http://localhost:5193
pnpm --filter @gdgjp/meet test
pnpm --filter @gdgjp/meet test:e2e
```

ローカルでは Accounts 経由せずに `/dev/login` でサインインできる（`APP_URL` が loopback 以外の本番では 404）。

- チャプター所属ユーザー: `http://localhost:5193/dev/login?as=organizer1&chapter=1:tokyo:organizer&return_to=/`
- チャプター未所属ユーザー: `http://localhost:5193/dev/login?as=guest1&chapter=none&return_to=/no-chapter`

ローカル開発環境（`ENVIRONMENT=development` かつ loopback）では、JWT 検証を伴う `/api/google/events` を迂回せず、専用ルート `POST /dev/simulate-event` に Pub/Sub エンベロープ JSON を送って通知処理（`processPubsubEnvelope`）を確認できる（本番では 404）。

## 本番デプロイ・運用手順

1. D1 データベース `gdgjp-meet-db` と Queue `gdgjp-meet-jobs` を作成し、`database_id` を `apps/meet/wrangler.toml` に設定する。
2. GCP プロジェクト `gdgs-meet` で Web 型 OAuth 2.0 クライアント（承認済みリダイレクト URI: `https://meet.gdgs.jp/admin/google/callback`）と Pub/Sub Push 認証用サービスアカウントおよび Push サブスクリプション（URL / Audience: `https://meet.gdgs.jp/api/google/events`）を作成し、`wrangler.toml` の `GOOGLE_CLIENT_ID` と `PUBSUB_PUSH_SERVICE_ACCOUNT` に設定する。
3. 秘密情報を `wrangler secret put` で設定する（値を変えたら 4 のシードを再実行する）。
   - `gdgjp-meet`: `RP_SESSION_SECRET`（`openssl rand -base64 48`）、`IDP_CLIENT_SECRET`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_TOKEN_ENCRYPTION_KEY`（`openssl rand -base64 32`）
   - `gdgjp-accounts`: `MEET_CLIENT_SECRET`（上記 `IDP_CLIENT_SECRET` と同一値）
4. `apps/accounts` のデプロイ後、管理者が `https://accounts.gdgs.jp/admin/seed-clients` を実行して `meet` クライアントを登録する。
5. `main` へのマージで GitHub Actions がビルド・デプロイ・リモートマイグレーションを実行する。
6. デプロイ後、管理者が `https://meet.gdgs.jp/admin/google` を開き、共有ホストアカウント（`community-support@gdgoc.jp`）の OAuth 接続と Workspace Events 購読状態を確認する。

## 仕様上の注意

- Calendar UI で `community-support@gdgoc.jp` から直接編集した内容は取り込まない（D1 が正本であり、アプリからの編集時に上書きされる）。
- 招待者を後から外した場合でも、既に共有済みの Drive ファイル閲覧権限は自動では剥奪しない。
- D1 の `meetings.space_name` に存在しないスペース（アプリ外で作成された会議）の通知・ファイルは保存・共有しない。
