# Stage 06 — artifacts-events 通知受信・生成ファイル共有・予定添付・定期同期

## Context — 背景とリポジトリ状況

**着手前に [`docs/plans/meet/00-overview.md`](00-overview.md) と [`docs/plans/meet/00a-poc-findings.md`](00a-poc-findings.md) を読むこと。**

### なぜやるか

方式 B で作成した会議では、co-host が録画・文字起こし・Gemini メモを開始しても、文字起こし＋メモはオーナー（`community-support@gdgoc.jp`）にしか共有されず、録画も他招待者に共有されず、Calendar 予定への自動添付も行われない。

本ステージでは Workspace Events API の Cloud Pub/Sub Push 通知（`POST /api/google/events`）と毎時 cron を組み合わせ、**録画・文字起こし＋Gemini メモ・チャットの記録をすべて取得して招待者全員に Drive 閲覧共有（通知メールなし）し、Calendar 予定へ添付し、`meet.gdgs.jp` 会議ページにリンクを表示する**一気通貫のパイプラインを完成させる。

### 実装前の確認事項（必須 — なければ止まって報告する）

**本ステージの実装・デプロイ確認に入る前に、以下が GCP プロジェクト `gdgs-meet` で準備済みであることを必ず確認し、未作成であれば作業を止めて利用者に作成を依頼・報告すること。**

1. Pub/Sub Push 認証用の GCP サービスアカウント（`PUBSUB_PUSH_SERVICE_ACCOUNT` に設定するメールアドレス）が作成済みであること。
2. トピック `projects/gdgs-meet/topics/meet-events` に以下の設定で **Push サブスクリプション** が新規作成済みであること:
   - エンドポイント URL: `https://meet.gdgs.jp/api/google/events`
   - 認証: 有効（OIDC トークン）
   - サービスアカウント: 上記 `PUBSUB_PUSH_SERVICE_ACCOUNT`
   - Audience: `https://meet.gdgs.jp/api/google/events`（`PUBSUB_PUSH_AUDIENCE` と一致）
3. ※ 検証用の pull サブスクリプション `meet-events-sub` は本番では使用しない（利用者が削除してよい）。

### 依存と対象範囲

- 依存: Stage 04（`meetings`, `meeting_invitees`, `JOB_HANDLERS` 登録表、`MEET_JOBS` Queue）。**Stage 05 と並行実装できる。**
- 対象: `apps/meet/` のみ。
- **Stage 05 との連携（境界フックの実装）**:
  - Stage 05 が導入する `app/features/meetings/artifact-reshare.server.ts` の `enqueueArtifactReshareForMeeting(env, meetingId)` を本ステージで実装（該当会議の `artifacts` 全件に対し `{ type: "share_artifact", artifactId }` を `MEET_JOBS` へ積む）する。Stage 05 より先に本ステージを実装する場合は同ファイル・同関数をここで作成しておき、Stage 05 がそれをそのまま呼び出す形にする。

### 読むべきもの

- `apps/meet/app/features/google/{meet,calendar,drive,workspace-events,token}.server.ts` と `email.ts`（Stage 03）
- `apps/meet/app/features/jobs/registry.server.ts`（Stage 04）
- `apps/pr/workers/app.ts` と `apps/pr/wrangler.toml` — `[triggers] crons` と `scheduled` ハンドラの形

### 再利用する既存実装（書き直さない）

- **`normalizeEmail`（`app/features/google/email.ts`）** — Drive `permissions.list` が返すドット付き Gmail アドレスと `meeting_invitees.email_normalized` の照合に使う
- **`JOB_HANDLERS`（`app/features/jobs/registry.server.ts`）** — `process_artifact` と `share_artifact` の 2 行を登録するだけ

## Design — 設計

### 1. 環境変数・Cron（`wrangler.toml` / `.dev.vars.example`）

`wrangler.toml` に追加:

```toml
[triggers]
crons = ["7 * * * *"]
```

`[vars]` に追加:
- `GOOGLE_PUBSUB_TOPIC = "projects/gdgs-meet/topics/meet-events"`
- `PUBSUB_PUSH_AUDIENCE = "https://meet.gdgs.jp/api/google/events"`
- `PUBSUB_PUSH_SERVICE_ACCOUNT = "<作成したサービスアカウントのメール>"`

`.dev.vars.example` にも開発用の対応項目を追記し、`cf-typegen` を実行する。

### 2. D1 スキーマ（`migrations/0004_artifacts_events.sql`）

```sql
CREATE TABLE conference_records (
  name       TEXT PRIMARY KEY,          -- conferenceRecords/<id>
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  start_time TEXT,
  end_time   TEXT
);
CREATE INDEX conference_records_meeting_idx ON conference_records (meeting_id);

CREATE TABLE artifacts (
  id                TEXT PRIMARY KEY,
  meeting_id        TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('recording', 'notes', 'chat_log')),
  drive_file_id     TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  web_view_link     TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  shared_at         TEXT,
  attached_at       TEXT,
  last_error        TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX artifacts_meeting_idx ON artifacts (meeting_id, created_at);
CREATE INDEX artifacts_pending_idx ON artifacts (shared_at, attached_at);

CREATE TABLE processed_events (
  dedupe_key  TEXT PRIMARY KEY,         -- "<ce-type>|<resourceName>"
  received_at TEXT NOT NULL
);

CREATE TABLE google_subscription (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  name        TEXT NOT NULL,
  state       TEXT NOT NULL,
  expire_time TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  last_error  TEXT
);
```

※ 文字起こしと Gemini メモは同一 Google ドキュメントになるため、`drive_file_id UNIQUE` 制約と `kind = 'notes'` によって 1 行にまとまる。

### 3. Pub/Sub Push 受信と WebCrypto JWT 検証

#### 3-1. JWT 検証（`app/features/events/pubsub-jwt.server.ts`）
- **新しい npm 依存を一切追加せず WebCrypto のみで実装する。** JWKS 取得先・`fetch`・現在時刻（`nowSec`）を依存注入可能にして単体テストする。
- 検証手順:
  1. `Authorization: Bearer <jwt>` を抽出。ヘッダ欠落・形式不正は `401 Unauthorized`。
  2. JWT を `header.payload.signature` に分割して base64url デコード。`header.alg === "RS256"` と `header.kid` を確認（不一致は `403`）。
  3. JWKS（既定 `https://www.googleapis.com/oauth2/v3/certs`）を取得し、`Cache-Control: max-age`（最小/フォールバック TTL 設定）で Isolate 内キャッシュ。該当 `kid` がキャッシュに見つからない場合のみ 1 回強制再取得して鍵ローテーションに追随。
  4. `crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])` と `crypto.subtle.verify` で署名を検証。
  5. クレーム検証（失敗はすべて `403 Forbidden`）:
     - `iss` が `"accounts.google.com"` または `"https://accounts.google.com"`
     - `aud === env.PUBSUB_PUSH_AUDIENCE`
     - `email === env.PUBSUB_PUSH_SERVICE_ACCOUNT`
     - `email_verified === true`
     - `exp > nowSec - 60`（わずかな時計ずれ許容）かつ（存在すれば）`nbf <= nowSec + 60`

#### 3-2. `POST /api/google/events`（`app/routes/api.google.events.ts` + `app/features/events/push-handler.server.ts`）
1. 上記 JWT 検証を実行（失敗は `401` / `403`）。
2. リクエスト JSON（`{ message: { attributes, data, messageId } }`）をパース。JSON が壊れている・`message.data` が base64 デコード不能など**再送しても絶対に直らない不正ボディは警告ログを残し `204 No Content` で ack して Pub/Sub の無限リトライを防ぐ**。
3. `ceType = attributes["ce-type"]` と `data` JSON を読む:
   - **ライフサイクル通知**:
     - `google.workspace.events.subscription.v1.expirationReminder` → 即座に `workspaceEvents.patchSubscriptionTtl(accessToken, subName, "0s")` で延長し `google_subscription` を更新、204。
     - `google.workspace.events.subscription.v1.expired` → 購読を再作成（`ensureSubscription`）し `google_subscription` を更新、204。
     - `google.workspace.events.subscription.v1.suspended` → `google_subscription` に `state = 'SUSPENDED'` と `last_error` を記録したうえで `reactivateSubscription` を試みる（管理画面 `/admin/google` にも表示）、204。
   - **対象イベント型**:
     - `google.workspace.meet.conference.v2.ended`
     - `google.workspace.meet.recording.v2.fileGenerated`
     - `google.workspace.meet.transcript.v2.fileGenerated`
     - `google.workspace.meet.smartNote.v2.fileGenerated`
     - 上記以外の `ce-type` は何もせず `204`。
4. payload からリソース名（`recording.name` / `transcript.name` / `smartNote.name` / `conferenceRecord.name`）を取り出し、`dedupeKey = "${ceType}|${resourceName}"` を組み立てる。
5. `INSERT OR IGNORE INTO processed_events (dedupe_key, received_at) VALUES (?, ?)` を実行。`meta.changes === 0`（重複配信）なら即 `204`。
6. `conferenceRecordName`（リソース名先頭の `conferenceRecords/<id>`）から対象会議を特定する:
   - まず `conference_records` テーブルを検索し、無ければ Meet API `conferenceRecords.get(conferenceRecordName)` を呼んで `space`（`spaces/<id>`）を取得し、`meetings` を `space_name` で引く。
   - **`meetings` に該当スペースが無い場合（アプリ外で直接作られた会議など）は即無視して `204` を返す。その会議のファイルは決して共有・保存しない。**
   - 該当会議があれば `conference_records` を `INSERT OR IGNORE` / `ON CONFLICT DO UPDATE` で保存する（**これにより `fileGenerated` が `conference.ended` より先に届いても正常に処理できる**）。
7. `fileGenerated` 3 種の場合は `MEET_JOBS.send({ type: "process_artifact", meetingId, kind, conferenceRecord: conferenceRecordName, resourceName })` を投入し、`204` を返す。
8. **5 で入れた `processed_events` の行は、6〜7 が失敗したら削除してから `500` を返す**（Pub/Sub に再送させる）。行を残すと再送が重複扱いで捨てられ、通知が失われる。後続のジョブは冪等なので、まれに 2 回流れても害はない。

### 4. `process_artifact` ジョブ（`app/features/artifacts/process-artifact.server.ts`）

1. `resourceName` と `kind`（`recording` / `transcript` / `smartNote`）に応じて Meet API からリソース詳細を取得する（`getRecording` / `getTranscript` / `getSmartNote`）。`state !== "FILE_GENERATED"` の場合は一時不整合としてエラーを投げリトライに回す。
2. Drive ファイル ID を取り出す（`recording.driveDestination.file`、`transcript.docsDestination.document`、`smartNote.docsDestination.document`）。
3. `drive.getFile(accessToken, fileId, "id,name,mimeType,parents,webViewLink,createdTime")` を取得。
4. `artifacts` テーブルへ upsert（`drive_file_id` をユニークキーとし、`ON CONFLICT(drive_file_id) DO UPDATE SET title = excluded.title, web_view_link = excluded.web_view_link`）。`transcript` と `smartNote` は `kind = 'notes'` とする。
5. **チャットの記録の特定（`kind === 'recording'` かつ `parents[0]` が存在するとき）**:
   - 同じスペースの別会議ファイルが同じフォルダーに同居するため、**フォルダー丸ごとや全ファイルを拾ってはならない**。
   - `drive.listFiles(accessToken, { q: "'<parentId>' in parents and trashed = false and mimeType = 'text/plain'", fields: "nextPageToken,files(id,name,mimeType,webViewLink,createdTime)" })` を実行。
   - 次の条件を**すべて**満たす 1 件のみを当該録画のチャット記録と判定する:
     - `file.mimeType === "text/plain"`
     - `file.name.startsWith(recordingFile.name)`（例: `<録画ファイル名> - チャットの記録`。接尾辞は所有者言語に依存するため前方一致とする。なお完全一致の録画ファイル自体は `mimeType` で除外される）
     - `Math.abs(Date.parse(file.createdTime) - Date.parse(recordingFile.createdTime)) <= 120_000`（PoC では録画の 0.05 秒後に生成。別会議の録画・チャット記録とは作成日時で明確に分離できる）
   - 見つかった場合、`kind = 'chat_log'` として `artifacts` へ upsert。
6. 今回保存／更新された各 artifact のうち `shared_at IS NULL OR attached_at IS NULL` のものに対し、`MEET_JOBS.send({ type: "share_artifact", artifactId })` を投入する。

### 5. `share_artifact` ジョブ（`app/features/artifacts/share-artifact.server.ts`）

`MEET_JOBS` コンシューマ（`max_concurrency = 1`, `max_batch_size = 1`）により直列実行される。

1. `artifact`、`meeting`、`meeting_invitees` を D1 から読む。`meeting.status === "canceled"` の場合は何もしない。
2. **Drive 共有**:
   - `drive.listPermissions(accessToken, artifact.driveFileId)` で既存権限を取得。
   - 既存権限の `emailAddress` をすべて `normalizeEmail` した Set を作る（`emailAddress` が無い権限やオーナー権限はそのまま無視し、既存の権限には一切触れない・削除しない）。
   - 招待者のうち `email_normalized !== normalizeEmail(env.GOOGLE_HOST_EMAIL)` かつ上記 Set に含まれない人**だけ**を抽出し、`drive.createPermission(accessToken, artifact.driveFileId, { type: "user", role: "reader", emailAddress: invitee.email, sendNotificationEmail: false })` を **1 件ずつ順次** 呼ぶ。
   - 招待者単位の恒久的なエラー（共有できないアドレスなどの 400 / 403。ただし `sharingRateLimitExceeded` / `userRateLimitExceeded` は除く）は、その人だけ飛ばして `last_error` に記録し、他の招待者の共有を続ける。429・5xx・レート制限・ネットワークエラーだけを再試行に回す（1 人のせいで全員の共有が止まり、cron が永久に再投入し続けるのを防ぐ）。
   - 飛ばした人を除いて全員分終わったら `artifacts.shared_at = now` を更新する。
3. **Calendar 予定への添付**:
   - `meeting.calendarEventId` が存在し、`artifact.attached_at === null` の場合:
     - `calendar.getEvent(accessToken, { calendarId: "primary", eventId: meeting.calendarEventId })` で現在の `attachments ?? []` を取得する。
     - `attachments` 内に既に同じ `fileUrl === artifact.webViewLink`（または URL 中の `driveFileId` 一致）が存在しなければ、末尾に `{ fileUrl: artifact.webViewLink, title: artifact.title, mimeType: artifact.mimeType }` を追記し、`calendar.patchEvent(accessToken, { calendarId: "primary", eventId: meeting.calendarEventId, supportsAttachments: true, sendUpdates: "none", body: { attachments } })` を実行する（**既存の添付を絶対に消さない**）。
     - 成功したら `artifacts.attached_at = now` を更新する。
4. いずれかで失敗した場合: `attempts = attempts + 1`、`last_error = message` を `artifacts` に記録したうえでエラーを再スローし、Queue の自動再試行に委ねる。

### 6. 毎時 cron（`app/features/cron/cron.server.ts`、`workers/app.ts` `scheduled`）

`google_connection` が `connected` でなければスキップする。処理は次の 3 段で構成する。

1. **購読の維持（`ensureSubscription`）**:
   - `google_subscription (id = 1)` を読む。
   - `targetResource = "//cloudidentity.googleapis.com/users/" + connection.googleUserId`、`eventTypes` は本番対象 4 型、`pubsubTopic = env.GOOGLE_PUBSUB_TOPIC`。
   - レコードなし・`state` が期限切れ/削除済み・`expire_time` が「現在 + 2 日未満」なら、まず `patchSubscriptionTtl(name, "0s")` を試み、期限切れ等で失敗した場合または未作成時は `createSubscription` で作り直して `google_subscription` に保存する。
2. **取りこぼしの見直し（過去 7 日以内の `active` 会議）**:
   - `meetings` から `status = 'active'` かつ `end_at >= now - 7 days` かつ `start_at <= now` かつ `space_name IS NOT NULL` を取得。
   - 各会議について `meet.listConferenceRecords(accessToken, 'space.name="' + spaceName + '"')` を呼び、各開催回の `recordings` / `transcripts` / `smartNotes` を確認。
   - `state === "FILE_GENERATED"` なのに Drive ファイル ID が `artifacts` に存在しないものがあれば `MEET_JOBS.send({ type: "process_artifact", ... })` を投入する（`conference_records` も未登録なら登録）。
3. **未完了・再共有待ち artifact の回収**:
   - `artifacts` から `(shared_at IS NULL OR attached_at IS NULL)` かつ `attempts < 20` の行を取得し、`share_artifact` を再投入する。

### 7. UI 追加とローカル開発用シミュレータ

- **会議詳細 `/meetings/:id`**:
  - 生成ファイルセクションを追加し、`artifacts` 一覧（種別バッジ: 録画 / 文字起こし・Gemini メモ / チャットの記録、タイトル、作成日時、Google Drive リンク）を表示する。
  - `artifacts` が 0 件のときは案内メッセージ（「録画・文字起こし・Gemini メモは会議終了から数分（長時間会議ではさらに長くなる場合があります）後に自動で共有・添付されます」）を表示する。
- **管理画面 `/admin/google`**:
  - `google_subscription` の状態（購読名、`state`、`expire_time`、`updated_at`、`last_error`）と「購読を今すぐ確認・更新」POST ボタンを追加する。
  - 最近の失敗 `artifacts`（`last_error IS NOT NULL` または `attempts > 0` で未完了）の一覧と「再試行」ボタンを追加する。
- **ローカル開発用の偽通知送信経路**:
  - `ENVIRONMENT === "development"`（かつ loopback）のときだけ有効な dev 専用ルート `POST /dev/simulate-event`（本番等では `404`）を用意する（またはローカル用スクリプト）。
  - **`POST /api/google/events` 自体には絶対に JWT 検証バイパスを入れない。** dev ルートから直接内部ハンドラ `processPubsubEnvelope(env, envelope)` を呼ぶ形にすることで、本番で認証を迂回する経路を構造的に作らない。

### 制約

- **本番の `POST /api/google/events` で JWT 検証を迂回する分岐・フラグを一切作らない。** 理由: 認証バイパス事故を構造的に防ぐ。ローカル確認は `/dev/simulate-event` 側を `ENVIRONMENT === "development"` でゲートして使う。
- **D1 `meetings.space_name` に存在しないスペースの通知・ファイルは絶対に保存・共有しない。** 理由: `community-support@gdgoc.jp` でアプリ外作成された会議のファイルを誤共有しないため。
- **Drive の親フォルダー自体・フォルダー内全ファイルを共有しない。** 理由: 同じスペースの後続会議でフォルダーが使い回されるため（00a §3）。
- **新規の JWT/JOSE 外部ライブラリを追加しない。** 理由: WebCrypto 標準 API で十分かつ依存を増やさない。
- **Calendar の `attachments` 更新時は必ず `events.get` で既存を取得して追記し、`sendUpdates=none` にする。** 理由: 既存の添付を消さないため、および不要な更新メールを飛ばさないため。

## Files to touch — 変更ファイル

### `apps/meet/`

- `wrangler.toml`（`[triggers] crons`、`GOOGLE_PUBSUB_TOPIC`, `PUBSUB_PUSH_AUDIENCE`, `PUBSUB_PUSH_SERVICE_ACCOUNT`）
- `.dev.vars.example`
- `workers/app.ts`（`scheduled` ハンドラ追加）
- `migrations/0004_artifacts_events.sql`（新規）、`schema.sql`（`migrate:local` で更新）
- `app/routes.ts`（`api/google/events`、`dev/simulate-event` 追加）
- `app/features/jobs/{types.ts,registry.server.ts}`（`process_artifact`, `share_artifact` 登録）
- `app/features/meetings/artifact-reshare.server.ts`（Stage 05 境界フックの本実装） + `artifact-reshare.server.test.ts`（新規）
- `app/features/events/pubsub-jwt.server.ts`（新規） + `pubsub-jwt.server.test.ts`（新規）
- `app/features/events/push-handler.server.ts`（新規） + `push-handler.server.test.ts`（新規）
- `app/features/events/subscription.server.ts`（新規） + `subscription.server.test.ts`（新規）
- `app/features/artifacts/repository.server.ts`（新規）
- `app/features/artifacts/process-artifact.server.ts`（新規） + `process-artifact.server.test.ts`（新規）
- `app/features/artifacts/share-artifact.server.ts`（新規） + `share-artifact.server.test.ts`（新規）
- `app/features/artifacts/components/ArtifactList.tsx`（新規）
- `app/features/cron/cron.server.ts`（新規） + `cron.server.test.ts`（新規）
- `app/routes/api.google.events.ts`（新規）
- `app/routes/dev.simulate-event.ts`（新規）
- `app/routes/meetings/detail.tsx`（生成ファイル一覧・案内表示追加）
- `app/routes/admin/google.tsx`（購読状態・手動更新・失敗ジョブ再試行追加）
- `tests/architecture/__snapshots__/route-urls.test.ts.snap`
- `README.md`, `ARCHITECTURE.md`

## Verification — 完了条件と検証

### 1. 完了条件

1. `migrations/0004_artifacts_events.sql` 適用、`cf-typegen`、`typecheck`、`test`、`build`、`check-design-harness.mjs` がすべて通る。
2. `POST /api/google/events` が署名済み OIDC JWT を検証し、不正トークンを `401` / `403` で拒否し、正当な通知で `process_artifact` → `share_artifact` の連鎖を処理できる。
3. 毎時 cron が購読の維持・取りこぼし補完・未完了 artifact 再投入を実行する。
4. 会議詳細画面に 3 種（録画・メモ・チャット記録）の生成ファイルリンクが表示され、管理画面に購読状態と失敗ジョブが出る。

### 2. コマンド

```sh
pnpm --filter @gdgjp/meet migrate:local
pnpm --filter @gdgjp/meet cf-typegen
pnpm --filter @gdgjp/meet typecheck
pnpm --filter @gdgjp/meet test
pnpm --filter @gdgjp/meet build
node scripts/check-design-harness.mjs
pnpm ci:quick
```

### 3. 回帰として固定すべきテスト（静かに壊れる経路）

- **`push-handler.server.test.ts`**:
  - **重複配信**: 同じ `(ce-type, リソース名)` が 2 回届いても `processed_events` により 2 回目は `204` でスキップされ、共有・添付は 1 回しか走らない
  - **順不同配信**: `fileGenerated` が `conference.v2.ended` より先に届いても `conferenceRecords.get` で `space` を引いて正常に処理できる
  - **アプリ外会議の無視**: D1 `meetings.space_name` に存在しないスペースの通知は何もしない（`artifacts` にも入らず、共有 API も一切呼ばれない）
  - **破損ボディ**: パース不能な JSON 等の再送しても直らないボディは `204` で ack する
  - **投入失敗時の巻き戻し**: `MEET_JOBS.send` が失敗したら `processed_events` の行が消えて `500` になり、再送で処理される
- **`process-artifact.server.test.ts`**:
  - **文字起こし + Gemini メモの統合**: 同一 `drive_file_id` を返す `transcript` と `smartNote` が `kind = 'notes'` の 1 行にまとまる
  - **チャット記録の分離特定**: 親フォルダーに同スペース別会議の録画・チャット記録が混在していても、録画ファイル名の前方一致 + `text/plain` + `createdTime` の近接判定で今回の会議のチャット記録だけを拾う（別会議のファイルを拾わない）
- **`share-artifact.server.test.ts`**:
  - **ドット付き Gmail 照合**: Drive `permissions.list` がドット付き/なし異表記（`a.b@gmail.com` vs `ab@gmail.com`）を返しても共有済みと判定し、重複して `permissions.create` を呼ばない
  - **既存権限の非破壊**: 既存のオーナーや手動共有済み権限を変更・削除しない
  - **1 人の恒久エラーで止まらない**: 1 人の `permissions.create` が 400 でも他の招待者には共有され、`shared_at` が入る（レート制限の 403 は再試行に回る）
  - **既存 `attachments` 保持**: Calendar 予定に既存の添付（他ファイル等）があっても消さずに末尾へ追記し、`sendUpdates=none` で `patch` する
- **`pubsub-jwt.server.test.ts`**:
  - `aud` 不一致、`email` 不一致、`email_verified: false`、`exp` 期限切れ、署名改ざんのすべてを `403`（Bearer 欠落は `401`）で拒否する
- **`subscription.server.test.ts` / `cron.server.test.ts`**:
  - 購読の期限が 2 日未満なら `ttl: "0s"` で延長し、期限切れまたは未登録なら作り直す
  - `expirationReminder` で即延長、`expired` で作り直し、`suspended` で状態保存 + `reactivate` 試行

### 4. 手動 E2E（実 Google / 本番またはステージング接続環境）

1. `/admin/google` で購読が `ACTIVE`（期限が約 7 日後）として表示されていることを確認する。
2. 組織内・組織外のテスト用アカウントを招待して会議を作成し、対照用アカウント（未招待）も別途用意する。
3. 実際に Meet 会議へ入室し、co-host アカウントで **録画・文字起こし・Gemini メモ** を開始し、チャットにテストメッセージを送ったうえで 1 分ほど話して全員退室する。
4. 会議終了から数分（PoC では 3.5〜5.3 分）後、以下を確認する:
   - `meet.gdgs.jp/meetings/:id` に **録画・文字起こし/メモ・チャットの記録** の 3 種類のリンクが表示される。
   - 組織内のテスト用アカウント（`gdgoc.jp`）と組織外のテスト用 Gmail アカウントの**両方**が 3 種類すべてを Drive で開ける。
   - 共有されていない対照用アカウントは 3 種類のいずれも開けない（アクセス拒否）。
   - 招待者に対して Drive 共有の通知メールが届いていない（`sendNotificationEmail=false`）。
   - Calendar 予定に 3 種類のファイルがタイトル・MIME タイプ付きで添付されている。
