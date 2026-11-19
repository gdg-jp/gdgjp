# meet.gdgs.jp — GDG Japan Meet 管理アプリ 全体方針

**Status:** 設計確定（2026-11-19 起草、2026-11-18〜19 の PoC で確定）
**Related:** [`00a-poc-findings.md`](00a-poc-findings.md)（実 API 検証結果）、[`docs/plans/pr/00-overview.md`](../pr/00-overview.md)（設計書・計画書構成の手本）、`apps/roulette/`（最小構成の GDG Accounts Relying Party 手本）、`apps/accounts/app/features/google-workspace/`（Google OAuth・暗号化・トークン管理の手本）

本書は人間向けの全体地図であり、`plan-creator` の見出し契約の対象外である。各ステージファイル（`01`〜`06`）は本書の用語・データモデル・権限・制約を前提にする。**各ステージに着手する前に、必ず本書と `00a-poc-findings.md` を最初に読むこと。**

---

## 0. 結論

GDG Japan / GDG on Campus Japan では、共有の Google Workspace アカウント `community-support@gdgoc.jp`（`gdgoc.jp` ドメイン）で Google Meet を主催している。現在は各チャプターの Organizer がこの共有アカウントに直接ログインして会議を作成し、共同主催者（co-host）を手作業で設定しているため、以下の課題がある。

1. 共有アカウントのパスワードを複数人に配布・共有しなければならない
2. チャプターメンバーや共催者を co-host として登録する手作業が煩雑
3. 会議終了後の録画・文字起こし・Gemini メモ・チャットの記録がオーナーのみ（または一部のみ）に共有され、他の主催者・参加者に届かない

**meet.gdgs.jp**（新規ワークスペース `apps/meet/`、`@gdgjp/meet`）は、GDG Accounts（`apps/accounts/`）でログインしたチャプターメンバーが、`community-support@gdgoc.jp` の認可済み OAuth 接続を代理利用して Google Meet 会議を作成し、co-host・参加者・Calendar 予定・会議生成ファイルの共有と予定添付を自動化する。これにより `community-support@gdgoc.jp` のパスワードを配る必要がなくなる。

実装方式は実機 PoC で検証済みの **方式 B** を採用する。

- **Meet スペース先行作成**: Google Meet REST API `spaces.create` でスペース（`RESTRICTED` / `TRUSTED` / `OPEN`、`moderation: "ON"`）を作成し、`spaces.members.create` で co-host（`role: "COHOST"`）と参加者（`role` なし）を登録する
- **Calendar 予定との結び付け**: Google Calendar API `events.insert` で `community-support@gdgoc.jp` の予定を作成し、`conferenceData` にその Meet スペースの URI を設定する
- **非同期メンバー同期・イベント駆動共有**: Meet メンバー同期は Cloudflare Queues（`MEET_JOBS`）で非同期実行し、生成ファイル（録画・文字起こし＋Gemini メモ・チャットの記録）は Workspace Events API → Cloud Pub/Sub Push → `MEET_JOBS` + 毎時 cron で取り込み、招待者全員へ Drive 閲覧権限を付与して Calendar 予定に添付する

---

## 1. 背景と方式 A / B の比較

PoC（2026-11-18〜19）で次の 2 方式を実機検証し、方式 B を採用した（詳細は [`00a-poc-findings.md`](00a-poc-findings.md)）。

| 観点 | 方式 A（不採用）: Calendar で Meet 発行 → Meet API で co-host 追加 | 方式 B（採用）: Meet API でスペース作成 → Calendar に結び付け |
|---|---|---|
| 手順 | `events.insert` (`createRequest`) で Meet 発行後、`spaces.members.create` で co-host を追加 | `spaces.create` → `spaces.members.create` → `events.insert`（`conferenceData` で URI 指定） |
| co-host（ホスト管理）の動作 | **黙って効かない**（200 が返ってもホスト管理が付与されないことを実機確認） | **正常に機能する**（入室時点でホスト管理が付与される） |
| ノック回避（`RESTRICTED`） | Calendar ゲストの扱いに依存 | Calendar ゲストだけではノックが必要。Meet API の `members.create` で登録したメンバーはノック不要 |
| Calendar UI での変更耐性 | — | Calendar UI でタイトル・時刻・ゲストを変えても Meet のリンク・設定・メンバーは保たれる（歯車アイコンは非表示） |
| 生成ファイルの既定共有 | — | 自動共有・予定への自動添付が行われないため、アプリ側で Drive 共有と Calendar 添付を行う |
| チャットの保持設定 | — | API に設定項目がなく、B のスペースでは Calendar UI からも変更不可（組織既定オフ＝ピン留め機能のため）。API 対応まで「残さない」方針 |

既存の Calendar で手動作成した Meet は方式 B のスペースへ変換できないため、移行対象外とする（必要な場合は作り直す）。

---

## 2. 決定事項

利用者との合意により確定した仕様は以下のとおりである。

| 項目 | 決定 |
|---|---|
| アプリ名 / URL / Worker | GDG Japan Meet / `https://meet.gdgs.jp` / `apps/meet/`（`@gdgjp/meet`）、Worker 名 `gdgjp-meet`、Accounts client ID `meet` |
| 会議を作れる人 | いずれかのチャプターに承認済み（`status = 'active'`）で所属するメンバー全員（Organizer / Member とも可） |
| 作成者の役割 | 作成者は常に `cohost` として登録する |
| 主催チャプターと既定 co-host | 所属チャプターから主催チャプターを 1 つ選ぶ（既定は primary）。既定で主催チャプターの Organizer（Member は含まない）全員を `cohost` として招待する（作成時にオプトアウト可能） |
| 追加の招待先 | (a) 他チャプターの Organizer、(b) 他チャプターの Organizer + Member、(c) 特定の個人の Google アカウント（メール）。それぞれ `cohost` か `participant` を選択可能（既定はすべて `participant`） |
| Google グループ | 最初の版では対象外（`googlegroups.com` を `COHOST` で登録しても 200 が返るだけで無効なため） |
| 重複排除の優先順位 | 複数の招待元に同一人物が含まれる場合、正規化したメールアドレスで 1 人にまとめ、`cohost` を優先する |
| 編集・取り消し権限 | その会議の `cohost` 全員（ログイン中ユーザーの Google メールアドレスを正規化して照合、チャプター所属は問わない）＋ GDG Accounts 管理者（`is_admin`） |
| 閲覧権限（詳細ページ） | 招待者（メール一致）、作成者、Accounts 管理者。それ以外には `404`。招待された会議の閲覧・編集にはチャプター所属は不要 |
| Calendar 通知・ゲスト可視性 | 作成・変更・取り消しは `sendUpdates=all` で通知メール送信。生成ファイル添付のみの patch は `sendUpdates=none`。予定は `guestsCanSeeOtherGuests=false`、`guestsCanInviteOthers=false`、`guestsCanModify=false` |
| メールアドレスの秘匿 | `meet.gdgs.jp` 画面上で、チャプター由来の招待者は**名前と役割のみ**を表示しメールアドレスはブラウザへ返さない（個人で追加した招待者のメールのみ作成者・co-host・管理者に表示可） |
| アクセス種別とモデレーション | 既定は `RESTRICTED`（招待者以外はノック）。作成・編集時に `TRUSTED` / `OPEN` も選択可。`moderation` は常に `ON` |
| 生成ファイル（録画・メモ・チャット記録） | すべて招待者全員（`community-support@gdgoc.jp` を除く）へ Drive で閲覧者共有（`sendNotificationEmail=false`）、Calendar 予定へ添付、`meet.gdgs.jp` 会議ページへリンク表示 |
| 招待者削除時の Drive 権限 | 最初の版では、既に共有済みの Drive 権限は自動で剥奪しない（誰が付与した権限か追跡していないため） |
| Calendar UI 直接編集の扱い | `community-support@gdgoc.jp` で Calendar UI から直接加えた変更は取り込まない（D1 が正本。アプリから編集すると上書きされる） |
| 繰り返し予定 | 最初の版では対象外 |

---

## 3. 全体構成図

```
[ブラウザ]
   │ HTTPS (OIDC 認証・画面操作)
   ▼
[apps/meet (gdgjp-meet / meet.gdgs.jp)] ─── service binding ──▶ [apps/accounts (gdgjp-accounts)]
   │  React Router v7 SSR                                        ├─ OIDC (ACCOUNTS)
   │  D1: gdgjp-meet-db                                          ├─ GET /api/chapters/directory
   │  Queue Producer/Consumer: MEET_JOBS (gdgjp-meet-jobs)       └─ MeetDirectoryService (RPC)
   │    (max_batch_size=1, max_concurrency=1)
   │  Cron: 毎時 ("7 * * * *")
   │
   ├── OAuth / Google APIs (community-support@gdgoc.jp の暗号化 Refresh Token を使用)
   │     ├─ Google Meet REST API   (spaces, members, conferenceRecords, recordings/transcripts/smartNotes)
   │     ├─ Google Calendar API    (events.insert / get / patch / delete)
   │     ├─ Google Drive API       (files.get / list, permissions.list / create)
   │     └─ Workspace Events API   (subscriptions.create / get / list / patch ttl / reactivate)
   │
   ▲ POST /api/google/events (OIDC JWT 検証: WebCrypto + Google JWKS)
   │
[Cloud Pub/Sub (projects/gdgs-meet/topics/meet-events)]
   ▲ Workspace Events 通知 (target: //cloudidentity.googleapis.com/users/<host_user_id>)
[Google Meet 会議の進行・ファイル生成]
```

---

## 4. データモデル概要

全テーブルは `apps/meet/migrations/` で管理し、`schema.sql` は `migrate:local` により自動生成する（手編集禁止）。

| テーブル | 導入ステージ | 役割 | 主な列 |
|---|---|---|---|
| `user` | Stage 01 | gdg-lib RP 認証のユーザーキャッシュ | `id`, `email`, `name`, `image`, `oidc_issuer`, `oidc_subject` |
| `oidc_session` | Stage 01 | gdg-lib RP OIDC セッション | `id`, `user_id`, `issuer`, `subject`, `access_token`, `refresh_token`, `id_token` |
| `google_connection` | Stage 03 | 共有 Google アカウント接続（`id=1` 固定） | `id`, `email`, `google_user_id`, `refresh_token_ciphertext`, `refresh_token_nonce`, `encryption_key_version`, `scope`, `status`, `last_error` |
| `google_oauth_state` | Stage 03 | Google 接続 OAuth の単回利用 state/PKCE | `id`, `user_id`, `code_verifier`, `return_to`, `expires_at` |
| `meetings` | Stage 04 | 会議の正本 | `id`, `host_chapter_id`, `title`, `description`, `start_at`, `end_at`, `time_zone`, `access_type`, `space_name`, `meeting_uri`, `meeting_code`, `calendar_event_id`, `calendar_html_link`, `status`, `last_error`, `created_by_user_id`, `created_by_email`, `canceled_at` |
| `meeting_invite_sources` | Stage 04 | 招待元の定義（再同期の元データ） | `id`, `meeting_id`, `kind`, `chapter_id`, `email`, `role` |
| `meeting_invitees` | Stage 04 | 解決済み招待者スナップショット | `meeting_id`, `email_normalized`, `email`, `display_name`, `user_id`, `role`, `source_kinds` (`PK(meeting_id, email_normalized)`) |
| `conference_records` | Stage 06 | 開催回と会議の対応 | `name` (`conferenceRecords/...` PK), `meeting_id`, `start_time`, `end_time` |
| `artifacts` | Stage 06 | 生成ファイル（録画・メモ・チャット記録） | `id`, `meeting_id`, `conference_record`, `kind`, `drive_file_id` (`UNIQUE`), `title`, `mime_type`, `web_view_link`, `created_at`, `shared_at`, `attached_at`, `last_error`, `attempts` |
| `processed_events` | Stage 06 | Pub/Sub イベントの重複排除 | `dedupe_key` (`ce-type\|resourceName` PK), `received_at` |
| `google_subscription` | Stage 06 | Workspace Events 購読状態（`id=1` 固定） | `id`, `name`, `state`, `expire_time`, `updated_at`, `last_error` |

---

## 5. 主なフロー

### 5-1. 会議の作成（Stage 04）
1. フォーム入力を検証し、`ACCOUNTS_DIRECTORY.listChapterMembers` RPC で招待元からアクティブメンバーを取得、純粋関数で招待者を解決（正規化メール重複統合、`cohost` 優先、作成者強制追加、`community-support@gdgoc.jp` 除外）
2. `meetings`（`status = 'creating'`）、`meeting_invite_sources`、`meeting_invitees` を D1 へ保存
3. `spaces.create({ config: { accessType, moderation: "ON" } })` でスペース作成
4. `events.insert`（`conferenceDataVersion=1`, `sendUpdates="all"`, `guestsCan*=false`, `extendedProperties.private.gdgsMeetId`）で予定を作成し、会議ページ URL を description に記載
5. `meetings` を `status = 'active'` に更新し、`MEET_JOBS` へ `{ type: "sync_members", meetingId }` を送信。Consumer が `members.list` と突合し差分を `create` / `delete→create` / `delete` で冪等に同期（`spaces.create` 後に失敗した場合は `status = 'failed'` と `last_error` を保存）

### 5-2. 会議の編集・再同期・取り消し（Stage 05）
- **編集**: タイトル・説明・時刻・`accessType`・招待元を変更。`accessType` 変更時は `spaces.patch`、予定変更は `events.patch(sendUpdates="all")`、招待元変更時は再解決して `attendees` を更新し `sync_members` と既存生成ファイルの再共有ジョブ（Stage 06 配線）を発行
- **チャプターから再同期**: 現在の `meeting_invite_sources` で再度 `ACCOUNTS_DIRECTORY` RPC を呼び、スナップショット・Calendar 予定・Meet メンバー・生成ファイル共有を最新化
- **取り消し**: `events.delete(sendUpdates="all")`、`meetings.status = 'canceled'`、`cleanup_meeting` ジョブで Meet メンバー全削除・`RESTRICTED` 化・進行中会議の `endActiveConference` を実行

### 5-3. 通知受信・生成ファイル共有・予定添付（Stage 06）
1. `POST /api/google/events` が Pub/Sub Push の Google 署名 JWT（WebCrypto + JWKS）を検証
2. `processed_events` で `(ce-type|リソース名)` を冪等判定し、`conferenceRecords.get` で `space` を引いて D1 `meetings.space_name` に存在するか確認（**存在しないスペースの通知は無視し決して共有しない**）
3. `fileGenerated` 通知に対して `MEET_JOBS` へ `process_artifact` を投入 → Meet API で実体ファイル ID を取得し Drive `files.get` でメタデータ取得、`artifacts` へ upsert（`transcript` と `smartNote` は同一 Doc のため `kind = 'notes'` に統合）。`recording` の場合は親フォルダーを `files.list` し規則一致する `text/plain` を `chat_log` として追加
4. `share_artifact` ジョブ（`max_concurrency = 1` で直列実行）が `permissions.list` と正規化メールで突合し未共有招待者へ 1 件ずつ `permissions.create(sendNotificationEmail=false)` → `events.get` で既存添付を残しつつ `events.patch?supportsAttachments=true&sendUpdates=none` で予定へ添付
5. 毎時 cron で (1) `google_subscription` の延長（残 2 日未満）/再作成、(2) 過去 7 日以内の `active` 会議の取りこぼし補完、(3) 未共有・未添付 `artifacts` の再投入を実行

---

## 6. 権限モデル

| 操作 | 対象ページ / API | 許可される主体 | 備考 |
|---|---|---|---|
| 会議の作成 | `/meetings/new` | チャプターに `status='active'` で所属するユーザー（Organizer / Member） | 未所属者は `/no-chapter` へリダイレクト |
| 会議一覧の閲覧 | `/` | GDG Accounts サインイン済みユーザー全員 | 自分が作成者または招待者である会議のみ表示（管理者は全件閲覧可）。作成ボタンはチャプター所属者のみ |
| 会議詳細の閲覧 | `/meetings/:id` | その会議の招待者（正規化メール一致）、作成者、Accounts 管理者 | チャプター所属不要。権限外は `404`。チャプター由来招待者のメールは非表示 |
| 会議の編集・再同期・取り消し | `/meetings/:id/edit` 等 | その会議の `cohost`（正規化メール一致）、Accounts 管理者 | チャプター所属不要。`status !== 'active'` の会議は編集不可 |
| Google 接続・購読・ジョブ管理 | `/admin/google` | Accounts 管理者（`user.isAdmin`）のみ | 非管理者は `403` |
| Pub/Sub Push 受信 | `POST /api/google/events` | Google Pub/Sub Push 署名 JWT（`PUBSUB_PUSH_SERVICE_ACCOUNT` & `PUBSUB_PUSH_AUDIENCE` 一致） | 認証失敗は `401` / `403` |

---

## 7. ステージと依存グラフ

```
Stage 01 (workspace-scaffold)
   ├──▶ Stage 02 (accounts-directory-rpc) ──┐
   │                                        ├──▶ Stage 04 (meeting-create)
   └──▶ Stage 03 (google-connection) ───────┘       ├──▶ Stage 05 (meeting-edit-cancel)
                                                    └──▶ Stage 06 (artifacts-events)
```

- **並行可能**: Stage 02 と Stage 03 は互いに独立しており並行実装できる。Stage 05 と Stage 06 も互いに並行実装できる（`MEET_JOBS` のジョブ振り分けを Stage 04 で登録表にしておくことで競合を防ぐ）。

| Stage | ファイル | 概要 | 主な観測ポイント |
|---|---|---|---|
| **01** | [`01-workspace-scaffold.md`](01-workspace-scaffold.md) | `apps/meet` 骨格、RP 認証、Accounts `meet` クライアント登録、CI/Deploy 配線 | dev login でトップ表示、未所属で `/no-chapter` |
| **02** | [`02-accounts-directory-rpc.md`](02-accounts-directory-rpc.md) | `packages/gdg-lib/src/meet-rpc.ts`、`apps/accounts` `MeetDirectoryService` RPC、`apps/meet` directory クライアント | active 所属のみ返却、actor 検証のユニットテスト通過 |
| **03** | [`03-google-connection.md`](03-google-connection.md) | `google_connection`、OAuth 接続フロー（`/admin/google`）、AES-GCM 暗号化、Google API クライアント、`normalizeEmail` | `community-support@gdgoc.jp` で接続、別アカウント拒否、API クライアントテスト |
| **04** | [`04-meeting-create.md`](04-meeting-create.md) | 会議テーブル、招待者解決、作成・一覧・詳細 UI、`MEET_JOBS` Queue と `sync_members` | 会議作成 → 招待メール受信、co-host ノックなし＆ホスト管理あり、参加者ノックなし |
| **05** | [`05-meeting-edit-cancel.md`](05-meeting-edit-cancel.md) | 編集フォーム、`spaces.patch` / `events.patch`、チャプター再同期、取り消しと `cleanup_meeting` | 非 co-host 拒否、時刻変更メール、取り消しで予定削除・入室不可 |
| **06** | [`06-artifacts-events.md`](06-artifacts-events.md) | Pub/Sub Push（WebCrypto JWT 検証）、`process_artifact` / `share_artifact`、毎時 cron、生成ファイル UI・管理画面 | 録画・メモ・チャット記録が自動共有・予定添付・画面表示 |

---

## 8. 利用者が行う GCP・Cloudflare の準備

コード実装と並行または本番デプロイ前に、以下のインフラ準備が必要となる。

1. **GCP（プロジェクト `gdgs-meet`）**:
   - Web アプリケーション型 OAuth 2.0 クライアントを新規作成（リダイレクト URI: `https://meet.gdgs.jp/admin/google/callback`、`http://localhost:5193/admin/google/callback`）。同意画面が「内部（Internal）」であることを維持する
   - Pub/Sub Push 認証用のサービスアカウント（例: `pubsub-push-meet@gdgs-meet.iam.gserviceaccount.com`）を作成し、トピック `projects/gdgs-meet/topics/meet-events` に対する Push サブスクリプションを作成（エンドポイント `https://meet.gdgs.jp/api/google/events`、OIDC 認証有効、上記サービスアカウントと audience `https://meet.gdgs.jp/api/google/events` を指定）
2. **Cloudflare リソース作成（`apps/meet`）**:
   - D1 データベース `gdgjp-meet-db` を作成し、`database_id` を `apps/meet/wrangler.toml` に記入
   - Queue `gdgjp-meet-jobs` を作成（Workers Paid プラン必須。アカウントは既に Paid）
3. **Secrets 登録（`wrangler secret put`）**:
   - `apps/meet`（`gdgjp-meet`）: `RP_SESSION_SECRET`（`openssl rand -base64 48`）、`IDP_CLIENT_SECRET`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_TOKEN_ENCRYPTION_KEY`（32byte base64: `openssl rand -base64 32`）
   - `apps/accounts`（`gdgjp-accounts`）: `MEET_CLIENT_SECRET`（上記 `IDP_CLIENT_SECRET` と同一値）
4. **OAuth クライアント登録と Google 接続**:
   - `accounts` デプロイ後、管理者で `https://accounts.gdgs.jp/admin/seed-clients` を実行して `meet` クライアントをシード
   - `meet` デプロイ後、管理者で `https://meet.gdgs.jp/admin/google` を開き、`community-support@gdgoc.jp` で同意・接続を実行

---

## 9. リスクと未確認事項

| 項目 | 現状とリスク | 確認タイミング / 緩和策 |
|---|---|---|
| **ゲスト数・メンバー数・co-host 数の上限** | Calendar イベントのゲスト上限、Meet スペースのメンバー/co-host 上限は `community-support@gdgoc.jp` の Workspace ライセンスに依存 | 確認済み（Business Standard）: `MAX_INVITEES = 150`、`MAX_COHOSTS = 25`（`00a-poc-findings.md` §6） |
| **`sub` と Cloud Identity ユーザー ID の一致** | Workspace Events の購読対象 `//cloudidentity.googleapis.com/users/<id>` に必要な数値 ID が、OAuth `id_token` の `sub` と一致するか未確認 | **Stage 03 手動確認で検証**し、一致しない場合は People API / Cloud Identity からの取得手順に切り替える |
| **長時間会議での通知遅延** | 1 分の会議で文字起こし/メモは 3.5 分後、録画は 5.3 分後に生成されたが、数時間の会議では大幅に延びる見込み | UI に「数分〜時間がかかる」旨を明記し、毎時 cron で過去 7 日以内の `active` 会議を見直す |
| **Drive 共有のレート制限** | 招待者が数十〜百人規模の場合、1 ファイルにつき人数分の `permissions.create` が走る | `MEET_JOBS` を `max_concurrency=1` で直列化し、1 件ずつ順次実行 + Queue 再試行に委ねる |
| **リフレッシュトークンの失効** | `community-support@gdgoc.jp` のパスワード変更や管理者によるセッション失効で `invalid_grant` になる | `google_connection.status = 'disconnected'` へ倒し、トップ画面と `/admin/google` に警告を出して再接続を促す |
| **Calendar UI での直接編集との不整合** | `community-support@gdgoc.jp` で Calendar 上から直接編集すると D1 と乖離する | アプリ側編集時は D1 を正本として上書きする仕様を UI・README に明記する |

---

## 10. 将来の拡張（最初の版の対象外）

- **Google グループ（`googlegroups.com`）対応**: Meet API がグループ展開に対応する、またはアプリ側でグループメンバーを展開して個別登録できるようになった場合に対応
- **招待者削除時の Drive 権限の自動剥奪**: アプリが付与した permission ID を追跡するテーブルを追加し、招待外し時に該当権限だけを削除する機能
- **繰り返し予定（Recurrence）**: 単発会議に限定した現行設計を拡張し、複数回の開催回やシリーズ単位のメンバー管理に対応
- **Meet チャット履歴の自動保存設定**: Meet REST API がチャット保持オプションに対応した段階で設定項目を追加
- **既存の Calendar 作成済み Meet の移行**: API 仕様上変換不可のため対象外のまま（新規作成で対応）

---

## 11. 検証で作ったリソースの片付け

PoC（2026-11-18〜19）で作成した検証用リソースは、本番運用開始前（または Stage 06 完了時）に片付ける。

- **検証用 Workspace Events 購読**: `subscriptions.delete` で検証時に作成した購読を削除する
- **検証用 Pub/Sub Pull サブスクリプション**: `gdgs-meet` の `meet-events-sub` を削除する（本番は新規作成する Push サブスクリプションのみ使用）
- **検証用 Calendar 予定**: `community-support@gdgoc.jp` のカレンダー上の検証用予定を削除する
- **検証用デスクトップ OAuth トークン**: ローカル検証で取得したデスクトップ型クライアントのリフレッシュトークンを失効（`oauth2.googleapis.com/revoke`）し、不要であれば検証用デスクトップクライアントも無効化/削除する
- **検証用 Drive ファイル**: `community-support@gdgoc.jp` のマイドライブ「Google Meet」フォルダー内に生成された検証用の録画・ドキュメント・チャット記録を手動で削除する
