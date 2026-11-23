# Stage 07 — meeting-stats 参加状況・会議統計の取得と表示

## Context — 背景とリポジトリ状況

**着手前に [`docs/plans/meet/00-overview.md`](00-overview.md) と [`docs/plans/meet/00a-poc-findings.md`](00a-poc-findings.md) を読むこと。**

### なぜやるか

会議ごとの参加状況（参加者数・ピーク同時接続数・滞在時間・招待者出席状況・入退室回数・文字起こしベースの発言時間）を `meet.gdgs.jp` の会議詳細画面に表示する。

Meet REST API の開催回データ（`conferenceRecords` と配下の参加者・セッション）は **会議終了から 30 日後（`expireTime`）に消滅する**（`00a-poc-findings.md` §8）。そのため、会議終了後に一度だけ API から取得して D1 へ永続化し、以降は D1 を唯一の正本（source of truth）として扱う。表示用のページ（`loader`）からは一切 Meet API を呼ばない。

### 実装前の確認事項（必須 — 通らなければ止まって報告する）

**本ステージの実装に入る前に、接続済みの `google_connection` を用いて以下を確認し、通らなければ作業を止めて報告すること。**

1. `google_connection` が `connected` 状態であること。
2. 直近の `conferenceRecord` に対する `participants.list` の GET リクエストが HTTP 200 を返すこと（`00a-poc-findings.md` §8 行 1）。
3. `spaces.members.list` のメンバー `name` 末尾の数値 ID が `signedinUser.user`（`users/<数値ID>`）と一致する挙動が維持されていること（`00a-poc-findings.md` §8 行 8）。

### 依存と対象範囲

- 依存: Stage 04（`meetings`, `meeting_invitees`, `sync_members`）および Stage 06（`conference_records`, Push ハンドラ, `process_artifact`, 毎時 cron, `MEET_JOBS` Queue）。
- 対象ワークスペース: `apps/meet/` のみ。
- 対象外: Admin SDK Reports API による通話品質メトリクス（`00-overview.md` §10 将来の拡張）。

### 読むべきもの

- `CLAUDE.md`（または `AGENTS.md`）、`apps/meet/ARCHITECTURE.md`
- `docs/plans/meet/00-overview.md`
- `docs/plans/meet/00a-poc-findings.md`（特に §4、§8）
- `docs/plans/meet/06-artifacts-events.md`

### 再利用する既存実装（書き直さない）

- `apps/meet/app/features/google/client.server.ts` — `googleJsonRequest`, `paginateAll`, `GoogleApiError`（429 / 5xx のリトライ判定を含む）
- `apps/meet/app/features/google/meet.server.ts` — `getConferenceRecord`, `listSpaceMembers`, `listTranscripts`（新規の取得関数をここへ追加する）
- `apps/meet/app/features/google/token.server.ts` — `getGoogleAccessToken`（Isolate 内キャッシュ付き）
- `apps/meet/app/features/events/push-handler.server.ts` — `google.workspace.meet.conference.v2.ended` の受信、`conference_records` の upsert、未管理スペースの無視を実装済み
- `apps/meet/app/features/artifacts/process-artifact.server.ts` — `transcript` の処理（統計ジョブ投入のフック地点）
- `apps/meet/app/features/cron/cron.server.ts` — 毎時 `runMeetCron`（ステップ 2 で過去 7 日以内の `active` 会議の `transcripts` を既に取得している）
- `apps/meet/app/features/jobs/registry.server.ts` — ジョブ登録表と `computeRetryDelaySeconds`（レート制限考慮バックオフ）。Queue 設定は `max_concurrency = 1`, `max_batch_size = 1`
- `apps/meet/app/features/meetings/access.server.ts` — `canViewMeeting`, `hasMeetingEditRole`
- `apps/meet/app/features/google/email.ts`（`normalizeEmail`）、`apps/meet/app/lib/redact-email.ts`（`maskEmail`）
- `apps/meet/app/features/google/error-summary.server.ts` — PII を除いたエラー要約

### API 上限（公式, `https://developers.google.com/workspace/meet/api/guides/limits`, 2026-11-22 確認）

- **Reads**: プロジェクトあたり 6,000 / 分、ユーザーあたり（プロジェクト別）**600 / 分**
- **Writes**: プロジェクトあたり 1,000 / 分、ユーザーあたり 100 / 分
- **`spaces.create`**: プロジェクトあたり 100 / 分、ユーザーあたり 10 / 分
- 日次上限（daily cap）はなし。上限超過時は HTTP 429 が返り、切り捨て指数バックオフ（truncated exponential backoff）を行う。公式ドキュメントには 2026 年後半以降にクォータ超過分の課金導入予定と記載されている。
- 本アプリの Google API 呼び出しはすべて単一ユーザー（`community-support@gdgoc.jp`）で実行されるため、**実質的な読み取り上限は 600 reads / 分** となる。
- `pageSize` 上限: `participants` 最大 250、`participantSessions` 最大 250、`transcript.entries` 最大 100、`conferenceRecords` 最大 100。

## Design — 設計

### 1. D1 スキーマ（`migrations/0007_conference_stats.sql`）

```sql
ALTER TABLE conference_records ADD COLUMN expire_time TEXT;
ALTER TABLE conference_records ADD COLUMN stats_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (stats_status IN ('pending','collecting','collected','skipped','failed','expired'));
ALTER TABLE conference_records ADD COLUMN stats_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conference_records ADD COLUMN stats_collected_at TEXT;
ALTER TABLE conference_records ADD COLUMN stats_last_error TEXT;
ALTER TABLE conference_records ADD COLUMN participant_count INTEGER;      -- host account excluded
ALTER TABLE conference_records ADD COLUMN invitee_attended_count INTEGER;
ALTER TABLE conference_records ADD COLUMN peak_concurrent INTEGER;
ALTER TABLE conference_records ADD COLUMN total_attendance_seconds INTEGER;
CREATE INDEX conference_records_stats_idx ON conference_records (stats_status, end_time);

CREATE TABLE conference_participants (
  name TEXT PRIMARY KEY,                 -- conferenceRecords/<cr>/participants/<id>
  conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('signedin','anonymous','phone')),
  google_user TEXT,                      -- users/<id> (signedin only)
  display_name TEXT,
  is_host_account INTEGER NOT NULL DEFAULT 0,
  invitee_email_normalized TEXT,         -- set when google_user matches meeting_invitees.google_user
  earliest_start_time TEXT, latest_end_time TEXT,
  session_count INTEGER NOT NULL DEFAULT 0,
  total_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX conference_participants_record_idx ON conference_participants (conference_record);

CREATE TABLE conference_participant_sessions (
  name TEXT PRIMARY KEY,
  participant TEXT NOT NULL REFERENCES conference_participants (name) ON DELETE CASCADE,
  start_time TEXT, end_time TEXT
);
CREATE INDEX conference_participant_sessions_participant_idx ON conference_participant_sessions (participant);

CREATE TABLE conference_transcript_stats (
  transcript TEXT PRIMARY KEY,           -- conferenceRecords/<cr>/transcripts/<id>
  conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','collected','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  collected_at TEXT, last_error TEXT
);
CREATE TABLE conference_speaker_stats (
  transcript TEXT NOT NULL REFERENCES conference_transcript_stats (transcript) ON DELETE CASCADE,
  participant TEXT NOT NULL,             -- participant resource name, no FK (participants may be collected later)
  entry_count INTEGER NOT NULL, char_count INTEGER NOT NULL, speaking_seconds INTEGER NOT NULL,
  PRIMARY KEY (transcript, participant)
);
ALTER TABLE meeting_invitees ADD COLUMN google_user TEXT;  -- users/<id> from Meet member name suffix
```

- 文字起こし本文（`text`）は保存しない（Google ドキュメント側で保持するため）。
- `schema.sql` は `pnpm --filter @gdgjp/meet migrate:local` により自動生成する。
- 保持方針: 統計行は会議が存在する限り保持する（`ON DELETE CASCADE`）。データ間引き（pruning）方針は `00-overview.md` §9 の未決定事項であり、本ステージでは削除処理を実装しない。

### 2. Meet API クライアント追加（`app/features/google/meet.server.ts`）

- `listParticipants(accessToken, conferenceRecordName, fetchFn)`: `pageSize = 250` で全ページを取得する。
- `listParticipantSessions(accessToken, participantName, fetchFn)`: `pageSize = 250` で全ページを取得する。
- `listTranscriptEntries(accessToken, transcriptName, { pageToken }, fetchFn)`: `pageSize = 100` で **1 ページ分だけ** 返す（ジョブ側で予算を管理しながらページングするため）。
- 型定義: `MeetParticipant`（`signedinUser` / `anonymousUser` / `phoneUser` の oneof）、`MeetParticipantSession`、`MeetTranscriptEntry`。
- 注意事項:
  - ワイルドカード `participants/-/participantSessions` は使わない（HTTP 200 でも常に 0 件のため、`00a-poc-findings.md` §8 行 6）。
  - フィルタを使う場合は必ず `snake_case` を使う（同 行 7）。
- ヘルパー `memberUserId(memberName: string): string | null`: `spaces/<s>/members/<id>` の末尾 `<id>` がすべて数字のときのみ `"users/" + id` を返し、hex ハッシュ等の場合は `null` を返す。

### 3. 招待者と Google ユーザー ID の対応（`sync_members`）

- `app/features/meetings/sync-members.server.ts` で `listSpaceMembers` および `createSpaceMember` の結果を得た後、`normalizeEmail(member.email)` で `meeting_invitees` と照合し、`memberUserId(member.name)` を `meeting_invitees.google_user` へ保存する（hex ハッシュ時は `null`）。
- 既に取得した API レスポンスをそのまま利用するため、追加の Google API 呼び出しは増えない。

### 4. API 呼び出しの予算（`app/features/google/pacer.server.ts` 新規）

- `createPacer({ minIntervalMs, maxCalls })` を新設する。各 Google API 呼び出し直前に `await pacer.next()` を呼び、連続呼び出しの間隔を制御する。`maxCalls` に到達した場合は `false` を返す（または型付き `BudgetExhausted` エラーを送出する）ことで、ジョブが継続メッセージを再投入して中断・再開できるようにする。
- 統計ジョブ用の定数:
  - `STATS_MIN_INTERVAL_MS = 200`（最大 300 reads / 分 ＝ ユーザー上限 600 reads / 分の半分に抑え、cron・`sync_members`・`share_artifact` 用の余裕を確保する）
  - `STATS_MAX_CALLS_PER_JOB = 100`
- HTTP 429 受信時は通常どおりリトライ可能な `GoogleApiError` として送出し、`registry.server.ts` のバックオフに委ねる。
- 予算計算: 参加者 100 人の会議では `conferenceRecords.get` (1) + `participants.list` (1) + `participantSessions.list` (100) = 約 102 reads となるため、2 ジョブ（各約 20 秒）に分けて安全に完走する。

### 5. `collect_conference_stats` ジョブ（`app/features/stats/collect-conference-stats.server.ts`）

- メッセージ型: `{ type: "collect_conference_stats", conferenceRecord: string, cursor?: string }`。`app/features/jobs/types.ts`（`isMeetJobMessage`）と `app/features/jobs/registry.server.ts` に登録する。
- 実行手順:
  - a. `conference_records` と `meetings` を読み込む。`stats_status` が `'collected'`・`'skipped'`・`'expired'` のいずれかなら即 no-op で終了する（**完了済みレコードは絶対に再取得しない** — これが最大のクォータ節約策）。`expire_time` を過ぎていれば `'expired'` へ更新して終了する。
  - b. `cursor` が未指定のとき: `stats_status = 'collecting'`・`stats_attempts + 1` に更新し、`getConferenceRecord` を呼んで `end_time` と `expire_time` を保存する。`endTime` が未確定（進行中）なら `delaySeconds: 600` で同メッセージを再投入して終了する。
  - c. `listParticipants` を実行する。0 人なら `'skipped'` に更新して終了。1 人でも `latestEndTime` が `null` の参加者がいれば `stats_status = 'pending'` に戻し、`delaySeconds: 300` で再投入して終了する（`stats_attempts >= 10` に達したら `'failed'` にする）。
  - d. 参加者を upsert する: `kind`、`google_user`、`display_name`、`is_host_account`（`google_user === "users/" + google_connection.google_user_id`）、`invitee_email_normalized`（`meeting_invitees.google_user` 一致から設定）。会議が `active` かつ `google_user` 未設定の招待者がいる場合は `listSpaceMembers` を 1 回だけ呼んで補完する（`cleanup_meeting` は取り消し時にスペースメンバーを削除するため、取り消し済み会議は既に保存済みの値のみに依存する）。
  - e. セッション取得: 参加者を `name` 昇順で並べ、`cursor` より後の参加者から順に Pacer 経由で `listParticipantSessions` を呼んで `conference_participant_sessions` に保存する。予算上限（`BudgetExhausted`）に達した場合は、直前に完了した参加者の `name` を `cursor` に設定して `delaySeconds: 30` で再投入し終了する。
  - f. 全参加者のセッション取得後、`app/features/stats/aggregate.ts` の純粋関数で集計を算出する（**共有ホストアカウントは集計から除外**）:
    - `participant_count`（ホスト除外）
    - `invitee_attended_count`
    - `peak_concurrent`（全セッションのイベント走査で算出。同時刻の同着は「退室を先、入室を後」として数える）
    - `total_attendance_seconds`
    - 参加者ごとの `session_count`・`total_seconds`（同一人物の重なり合うセッションは区間を統合し二重計上しない）
    - `stats_status = 'collected'` と `stats_collected_at` を保存して完了する。
- エラー処理: リトライ可能な `GoogleApiError` はそのまま再スローして `registry.server.ts` のバックオフ再試行に委ねる。非リトライエラーは `error-summary.server.ts` で要約（メールアドレスを含めない）し、`stats_status = 'failed'` と `stats_last_error` を保存する。

### 6. `collect_transcript_stats` ジョブ（`app/features/stats/collect-transcript-stats.server.ts`）

- メッセージ型: `{ type: "collect_transcript_stats", conferenceRecord: string, transcript: string, pageToken?: string }`。`types.ts`・`registry.server.ts` に登録する。
- 実行手順:
  - Pacer 経由で `listTranscriptEntries` をページングする（1 ジョブ最大 100 ページ、超過時は `pageToken` 付きで継続ジョブを再投入）。
  - 参加者ごとに `entry_count`、`char_count`（`text` の文字数のみ加算し本文は破棄）、`speaking_seconds`（`endTime - startTime` の合算）を集計する。
  - ページ単位の冪等性を保つため、初回ページ（`pageToken` 未指定）では当該 `transcript` の既存 `conference_speaker_stats` 行を削除してから挿入し、継続ページでは `ON CONFLICT DO UPDATE` で加算する。
  - 全ページ処理後に `status = 'collected'` を記録する（エントリ 0 件でも `'collected'`・`speaker_stats` 行なしで完了）。
- 起動トリガー:
  1. `process_artifact`（`app/features/artifacts/process-artifact.server.ts`）が `kind === 'transcript'` かつ `state === 'FILE_GENERATED'` を処理した際、`conference_transcript_stats` に `pending` 行を `INSERT OR IGNORE` して `collect_transcript_stats` を投入する。
  2. 毎時 cron のステップ 2 は既に過去 7 日以内のアクティブ会議の `transcripts` をリスト取得しているため、`FILE_GENERATED` かつ未完了の行があれば投入する（追加 API 呼び出しゼロ）。
- UI 表記: 発言割合・発言時間は必ず「（参考値）」と表示する（`00a-poc-findings.md` §8 行 12）。

### 7. トリガーと cron の保険

- **Push ハンドラ（`app/features/events/push-handler.server.ts`）**: `google.workspace.meet.conference.v2.ended` 受信時、既存の `conference_records` upsert に加えて `expire_time`（既に `getConferenceRecord` で取得済み）も保存し、`collect_conference_stats` を `delaySeconds: 120` で投入する。未管理スペースは引き続き無視して保存しない。
- **`upsertConferenceRecord` の非破壊更新**: Push ハンドラや cron からの upsert 実行時、既存の `stats_status` や集計列を絶対にリセットしない。
- **毎時 cron 新ステップ 4（`app/features/cron/cron.server.ts`、既存ステップ 3 の後）**:
  - `conference_records` から `stats_status IN ('pending', 'failed') AND end_time IS NOT NULL AND end_time < now - 30分 AND (expire_time IS NULL OR expire_time > now) AND stats_attempts < 10` を最大 20 件取得して `collect_conference_stats` を投入する（**このステップでは Meet API を一切呼ばない**）。
  - `expire_time <= now` かつ未完了の `conference_records` を `'expired'` に更新する。
  - `conference_transcript_stats` についても同様に `pending` / `failed`（`attempts < 10`）を再投入し、期限切れを `'expired'` に更新する。
  - `CronRunSummary` に統計ジョブ投入・期限切れ件数のカウンタを追加する。
- 30 日間の `expireTime` に対して毎時 cron が動くため、イベントを取りこぼしても十分な余裕で回収できる（Stage 06 の 7 日バックフィルでも `conference_records` が作成される）。

### 8. 画面（会議詳細 `/meetings/:id`）

- 新規コンポーネント `app/features/stats/components/ConferenceStatsCard.tsx` を `/meetings/:id`（`app/routes/meetings/detail.tsx`）に追加する。`detail.tsx` の `loader` は `app/features/stats/repository.server.ts` 経由で D1 のみを参照し、**Google API は絶対に呼ばない**。
- **`canViewMeeting` を満たす閲覧者全員への表示**:
  - `'skipped'` 以外の `conference_records` ごとに新しい順で表示: 開始・終了時刻・長さ、参加者数、ピーク同時接続数、平均滞在時間、招待者の出席（`invitee_attended_count` / 招待者総数）、招待外・匿名・電話の人数、集計状態（`pending` / `collecting`: 「会議終了後に集計します」、`failed` / `expired`: 「集計できませんでした」）。
- **`hasMeetingEditRole`（`cohost` と管理者、取り消し済み会議を含む）のみへの表示**:
  - 個人別テーブル: 名前（招待者の `display_name` を優先し、無ければ参加者の `display_name`）、招待者 / 招待外、最初の入室、最後の退室、滞在時間、入退室回数、発言時間（参考値）。
  - 未出席の招待者も一覧表示する。
  - **サーバー側でのデータ除外**: `loader` は `hasMeetingEditRole` を満たさない閲覧者へのレスポンスに個人別データを含めてはならない（UI 非表示だけでなくサーバー側で落とす）。メールアドレスを表示する場合は必ず `maskEmail` を通す。
- UI は `@gdgjp/design-system` コンポーネントを使用し、`node scripts/check-design-harness.mjs` を通過させる。
- 本ステージでは新規ルートを追加しない（`route-urls.test.ts` のスナップショットは変更なし）。

### 制約

- **ページや `loader` から Meet API を直接呼ばない。** 理由: 閲覧アクセスによるクォータスパイクを防ぎ、D1 を唯一の正本として保つため。
- **`participant.v2.joined` / `left` を購読しない。** 理由: 参加・退室ごとにイベントと API 読み取りが発生し、事後統計には不要なため。
- **完了済み（`collected` / `skipped` / `expired`）レコードを二度と再取得しない。** 理由: 600 reads / 分の上限と将来のクォータ超過課金リスクを回避するため。
- **文字起こし本文（`text`）を保存せず、参加者のメールアドレスは招待者との突合結果（`conference_participants.invitee_email_normalized`）以外に保存しない。** 理由: 最小データ原則とプライバシー保護のため（本文は Google ドキュメントに保持される）。
- **ワイルドカード経路（`participants/-/participantSessions`）や `camelCase` フィルタを使わない。** 理由: PoC で空配列および 400 エラーになることが判明済みのため（`00a-poc-findings.md` §8）。
- **ソースファイルは 400 行以下、`app/features/` から `app/routes/` を import しない、SQL は repository のみに置く。** 理由: `apps/meet/tests/architecture/` のガードレール遵守のため。
- **Admin SDK Reports API・会議中リアルタイム統計・チャプター横断ダッシュボード・データ削除（pruning）は本ステージに含めない。** 理由: `00-overview.md` §9・§10 に従い対象外としてスコープを守るため。
- **`schema.sql` や `worker-configuration.d.ts` を手で編集しない。** 理由: `migrate:local` と `cf-typegen` による自動生成物のため。

## Files to touch — 変更ファイル

### `apps/meet/`

- `migrations/0007_conference_stats.sql`（新規）、`schema.sql`（`migrate:local` で再生成）
- `app/features/google/meet.server.ts` + `meet.server.test.ts`
- `app/features/google/pacer.server.ts`（新規） + `pacer.server.test.ts`（新規）
- `app/features/stats/aggregate.ts`（新規） + `aggregate.test.ts`（新規）
- `app/features/stats/repository.server.ts`（新規） + `repository.server.test.ts`（新規）
- `app/features/stats/collect-conference-stats.server.ts`（新規） + `collect-conference-stats.server.test.ts`（新規）
- `app/features/stats/collect-transcript-stats.server.ts`（新規） + `collect-transcript-stats.server.test.ts`（新規）
- `app/features/stats/components/ConferenceStatsCard.tsx`（新規） + `ConferenceStatsCard.test.tsx`（新規）
- `app/features/jobs/{types.ts,registry.server.ts}` + 関連テスト
- `app/features/events/push-handler.server.ts` + `push-handler.server.test.ts`
- `app/features/artifacts/{process-artifact.server.ts,repository.server.ts}` + 関連テスト
- `app/features/cron/cron.server.ts` + `cron.server.test.ts`
- `app/features/meetings/{sync-members.server.ts,meetings.repository.server.ts}` + 関連テスト
- `app/routes/meetings/detail.tsx`
- `ARCHITECTURE.md`（`app/features/stats/` の行と新規ジョブ種別を追記）

### `docs/`

- `docs/plans/meet/00-overview.md`（計画ステップで更新済み。実装時に乖離が生じた場合のみ修正）

## Verification — 完了条件と検証

### 1. 完了条件

1. 実 Google Meet の会議終了から数分以内に、会議詳細画面（`/meetings/:id`）に統計カードが表示される。
2. 個人別の入退室・滞在・発言時間テーブルは `cohost` と管理者のみに表示され、一般参加者の `loader` レスポンスには含まれない。
3. 文字起こし生成後、参考値として発言時間が表示される。
4. 完了済みレコードに対して以降の cron 等で Meet API が再取得されない。

### 2. コマンド

```sh
pnpm --filter @gdgjp/meet migrate:local
pnpm --filter @gdgjp/meet typecheck
pnpm --filter @gdgjp/meet test
node scripts/check-design-harness.mjs
pnpm ci:quick
```

### 3. 回帰として固定すべきテスト（静かに壊れる経路）

- `collected` / `skipped` / `expired` のレコードに対してジョブが `fetch` を 0 回しか呼ばない（再取得しない）
- 参加者 0 人の開催回が `skipped` になる
- `latestEndTime` が `null` の参加者がいる場合、`collected` にせず遅延付きで再投入する
- `STATS_MAX_CALLS_PER_JOB` を超える参加者数のとき、`cursor` 付き継続ジョブに分かれて最終的に `collected` となり、同じ参加者を二重取得しない
- 共有ホストアカウントが `participant_count` と `peak_concurrent` から除外される
- 同一人物の重複・重なり合うセッションが `total_seconds` で二重計上されず、`peak_concurrent` のスイープで `end == start`（同着）が正しく処理される
- メンバー `name` 末尾が hex ハッシュのときは `google_user = null`、全桁数字のときは `users/<id>` になる
- 非 `cohost` 閲覧者向けの `loader` レスポンスに個人別行が含まれない（セキュリティ境界）
- 文字起こし本文（`text`）が D1 に一切書き込まれない
- 未管理スペースの `conferenceRecords` が保存されない（既存挙動の維持）
- Push ハンドラや cron からの `upsertConferenceRecord` が `stats_status` をリセットしない
- Meet API の HTTP 429 に対してレート制限バックオフで再試行し、ステータスが `failed` に落ちず `pending` / `collecting` のまま維持される

### 4. 手動 E2E（実 Google）

1. テスト用個人 Gmail アカウント 2 件（個人用の `@gdgoc.jp` アカウントは使わない）を `cohost` と参加者として招待した会議を作成する。
2. 両アカウントで入室し、参加者側が一度退室して再入室する。
3. 文字起こしをオンにして両名が少し話したあと、会議を終了する。
4. 約 3 分以内に会議詳細の統計カードへ「参加者 2 人」「ピーク同時接続 2」「参加者の入退室回数 2」が表示されること、`cohost` には個人別テーブルが表示され、参加者には集計値のみが表示されることを確認する。
5. 文字起こし生成完了後、発言時間（参考値）が表示されることを確認する。
6. ローカル D1 で該当レコードの統計行を削除して `stats_status` を `pending` に戻し、開発環境で cron を実行して再収集されることを確認したうえで、2 回目の cron 実行時のログで該当レコードに対する Meet API 呼び出しが発生しないことを確認する。
