# Stage 04 — meeting-create 会議の作成・招待者解決・一覧と詳細・メンバー同期キュー

## Context — 背景とリポジトリ状況

**着手前に [`00-overview.md`](00-overview.md) と [`00a-poc-findings.md`](00a-poc-findings.md) を必ず読むこと。** 付録は delegate されないため、両文書に確定した方式 B・権限モデル・PoC の実測値を前提に実装する。

### なぜやるか

Stage 01〜03 で `apps/meet/` の骨格、GDG Accounts のメンバー一覧 RPC（`MeetDirectoryService`）、および `community-support@gdgoc.jp` の Google OAuth 接続と Google API クライアント群が整った。本ステージでは、チャプター所属メンバーが Google Meet 会議を新規作成し、co-host と参加者を決定し、方式 B（`spaces.create` → `events.insert` → 非同期 `spaces.members` 同期）で会議を作成・一覧表示・詳細表示できるようにする。

PoC で確定したとおり、Calendar のゲスト登録だけでは `RESTRICTED` スペースのノックを回避できず、co-host のホスト管理も付かない。したがって、招待者は全員 `meeting_invitees` に解決して保存したうえで、Cloudflare Queues（`MEET_JOBS`）の `sync_members` ジョブで Meet スペースのメンバーとして登録する。

### 依存と対象範囲

- **依存**: Stage 01（`apps/meet` 骨格、`user` / `oidc_session`、`requireUser` / `requireUserWithChapter`）、Stage 02（`ACCOUNTS_DIRECTORY.listChapterMembers` RPC、`/api/chapters/directory` ラッパー）、Stage 03（`google_connection`、アクセストークン取得と `invalid_grant` 処理、Meet/Calendar クライアント、`normalizeEmail`）。
- **対象ワークスペース**: `apps/meet/` のみ（加えて事前確認で確定した上限値と `MAX_INVITEES` を `docs/plans/meet/00a-poc-findings.md` に追記する）。`apps/accounts/`・`packages/gdg-lib/`・`00-overview.md` は変更しない。
- **対象外（別ステージ担当）**:
  - 会議の編集・チャプターからの再同期・取り消し（`cleanup_meeting`）→ Stage 05
  - Pub/Sub Push 受信、生成ファイル（録画・文字起こし＋メモ・チャット記録）の取り込み・Drive 共有・予定添付・毎時 cron → Stage 06

### 事前確認（実装前に必ず）

1. **招待上限（確認済み）**: `MAX_INVITEES = 150`、`MAX_COHOSTS = 25`。根拠は `docs/plans/meet/00a-poc-findings.md` §6。

### 読むべきもの

- `apps/roulette/app/features/auth/access.server.ts` — `requireUserWithChapter` とサインイン導線
- `apps/roulette/app/routes/projects/home.tsx` — `@gdgjp/design-system` を使った一覧画面の構成
- `apps/connpass/workers/app.ts` / `apps/wiki/workers/app.ts` — `ExportedHandler<Env>` の `queue(batch, env, ctx)` ハンドラの書き方
- `apps/pr/tests/architecture/layering.test.ts` — `app/features/<domain>/` と `app/routes/` の依存境界、`*.server` のクライアント混入防止

### 再利用する既存実装

- Stage 01 で導入した `app/features/auth/access.server.ts`（`requireUserWithChapter` / `requireUser`）と `app/layouts/` のシェル
- Stage 02 で導入した `app/features/directory/`（`ACCOUNTS_DIRECTORY.listChapterMembers` 呼び出しラッパーとチャプター一覧取得）
- Stage 03 で導入した `app/features/google/`（アクセストークン取得、Meet `spaces.create` / `members.list` / `members.create` / `members.delete`、Calendar `events.insert`、`google_connection` 状態確認、`normalizeEmail`）

## Design — 設計

### 1. D1 マイグレーション（`apps/meet/migrations/0003_meetings.sql`）

Stage 01（認証テーブル）・Stage 03（`google_connection` 等）に続く番号で、`meetings`・`meeting_invite_sources`・`meeting_invitees` を追加する（既存マイグレーション番号に合わせて連番を調整する）。

```sql
CREATE TABLE meetings (
  id                 TEXT PRIMARY KEY,
  host_chapter_id    INTEGER NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  start_at           TEXT NOT NULL, -- UTC ISO 8601
  end_at             TEXT NOT NULL, -- UTC ISO 8601
  time_zone          TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  access_type        TEXT NOT NULL DEFAULT 'RESTRICTED'
                     CHECK (access_type IN ('RESTRICTED', 'TRUSTED', 'OPEN')),
  space_name         TEXT,
  meeting_uri        TEXT,
  meeting_code       TEXT,
  calendar_event_id  TEXT,
  calendar_html_link TEXT,
  status             TEXT NOT NULL CHECK (status IN ('creating', 'active', 'failed', 'canceled')),
  last_error         TEXT,
  created_by_user_id TEXT NOT NULL,
  created_by_email   TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  canceled_at        TEXT
);

CREATE INDEX meetings_space_name_idx ON meetings (space_name);
CREATE INDEX meetings_created_by_idx ON meetings (created_by_user_id);
CREATE INDEX meetings_status_start_idx ON meetings (status, start_at);

CREATE TABLE meeting_invite_sources (
  id         TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('host_chapter_organizers', 'chapter_organizers', 'chapter_all', 'email')),
  chapter_id INTEGER,
  email      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('cohost', 'participant')),
  created_at TEXT NOT NULL
);

CREATE INDEX meeting_invite_sources_meeting_idx ON meeting_invite_sources (meeting_id);

CREATE TABLE meeting_invitees (
  meeting_id       TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  email            TEXT NOT NULL,
  display_name     TEXT,
  user_id          TEXT,
  role             TEXT NOT NULL CHECK (role IN ('cohost', 'participant')),
  source_kinds     TEXT NOT NULL, -- JSON 配列: 例 ["creator", "host_chapter_organizers"]
  PRIMARY KEY (meeting_id, email_normalized)
);

CREATE INDEX meeting_invitees_email_idx ON meeting_invitees (email_normalized, meeting_id);
```

- ID 生成は外部依存を増やさず `crypto.randomUUID()`（またはタイムスタンプ接頭辞付きランダム ID）を用いる。
- `schema.sql` は `pnpm --filter @gdgjp/meet migrate:local` により自動生成する（手編集禁止）。

### 2. 招待者の解決（`app/features/meetings/invitees.ts`）

ブラウザからでもテストからでも使える純粋モジュールとして実装し、D1 やネットワークに依存させない。

- **定数**: `export const MAX_INVITEES = 150;`（Business Standard の Meet 参加者上限）と `export const MAX_COHOSTS = 25;`（Meet の co-host 上限）。根拠は `00a-poc-findings.md` §6。
- **入力型**:
  - `creator: { userId: string; email: string; name: string }`
  - `hostChapterId: number`
  - `sources`: `{ kind: "host_chapter_organizers" | "chapter_organizers" | "chapter_all" | "email"; chapterId: number | null; email: string | null; role: "cohost" | "participant" }[]`
  - `chapterMembers: MeetDirectoryMember[]`（Stage 02 の RPC 結果。すべて `status = 'active'`）
  - `hostEmail: string`（`env.GOOGLE_HOST_EMAIL` = `community-support@gdgoc.jp`）
- **解決規則（`resolveInvitees`）**:
  1. `sources` を順に展開し、候補リストを作る:
     - `host_chapter_organizers`: `chapterMembers` のうち `chapterId === hostChapterId && role === "organizer"` を対象。役割は `source.role`（フォーム既定 `cohost`）。
     - `chapter_organizers`: `chapterMembers` のうち `chapterId === source.chapterId && role === "organizer"` を対象。役割は `source.role`（フォーム既定 `participant`）。
     - `chapter_all`: `chapterMembers` のうち `chapterId === source.chapterId` 全員を対象。役割は `source.role`（フォーム既定 `participant`）。
     - `email`: 個別メール入力（`source.email`）を 1 件の候補として追加。`userId = null`、`displayName = null`。
  2. `creator` を `role = "cohost"`、`sourceKind = "creator"` として**必ず追加**する（作成者が Member であっても、主催チャプターの Organizer 自動招待をオプトアウトしていても `cohost` になる）。
  3. `normalizeEmail(entry.email)` をキーに重複排除する:
     - `normalizeEmail(hostEmail)`（`community-support@gdgoc.jp`）に一致する候補は**除外**する（オーナー自身をゲスト・メンバーに含めない）。
     - 同一正規化メールが複数ソースから現れた場合は 1 件に統合し、**`cohost` を `participant` より優先**する。`sourceKinds` は重複なしの配列として和集合を取り、`userId` / `displayName` は非 null の値（チャプターメンバーや作成者の情報）を優先保持する。
  4. 解決後の人数が `MAX_INVITEES` を超えた場合は `{ ok: false, code: "too_many_invitees", count, max: MAX_INVITEES }` を、`cohost` の人数が `MAX_COHOSTS` を超えた場合は `{ ok: false, code: "too_many_cohosts", count, max: MAX_COHOSTS }` を返す。
- **Google グループの拒否**:
  - 個別メール入力のバリデーションで `@googlegroups.com` ドメインを検出し、「Google グループ（googlegroups.com）は招待先に指定できません」としてフォームエラーで弾く（PoC で `COHOST` 指定時に 200 が返るだけで効かないため）。

### 3. メールアドレスの秘匿と閲覧権限（`app/features/meetings/access.server.ts`）

- **会議の閲覧権限（`requireMeetingViewAccess`）**:
  - サインイン必須だが**チャプター所属は不要**（`requireUser(env, request)` を使う）。
  - 閲覧可の条件: `user.isAdmin`、または `meeting.createdByUserId === user.id`、または `meeting_invitees` に `email_normalized === normalizeEmail(user.email)` が存在する。
  - 上記に該当しない場合は `404 Not Found` を返す（会議の存在を漏らさないため `403` にしない）。
- **画面へのメールアドレス返却規則（`toPublicInviteeList`）**:
  - 決定事項に従い、チャプター由来の招待者は名前と役割だけを表示しメールアドレスを出さず、個人で追加した招待者のメールのみ作成者・`cohost`・管理者に表示可とする。
  - 具体的には:
    - 閲覧者が「作成者 / 会議の `cohost` / 管理者」のいずれかであり、かつ当該招待者の `source_kinds` に `"email"` が含まれる場合のみ `email` を loader の戻り値に含める。
    - `"email"` を含まないチャプター由来の招待者は、閲覧者が管理者・作成者であっても loader の戻り値型に `email` / `emailNormalized` を含めない（`{ displayName, role, isCreator, isChapterDerived }` のみ返す）。
    - 一般の `participant` が閲覧する場合、個人メール追加の招待者についても `email` は返さず「外部招待者（メール非公開）」等の表示にする。

### 4. 会議作成フロー（`app/features/meetings/create.server.ts`）

1. `requireUserWithChapter(env, request)` でチャプター所属を検証し、`google_connection` が `status === 'connected'` であることを確認する（未接続・切断時は作成を開始せずエラーを返す）。
2. フォーム入力をパース・検証する（`title`、`date`・`startTime`・`endTime`・`timeZone` → UTC ISO、`endAt > startAt`、`hostChapterId` が操作者の承認済み所属チャプターに含まれること、`accessType` ∈ `{RESTRICTED, TRUSTED, OPEN}`、他チャプター追加、個別メール）。
3. `sources` が参照するチャプター ID を重複排除し、必要な役割（`chapter_all` があれば `["organizer", "member"]`、なければ `["organizer"]`）を指定して Stage 02 の `ACCOUNTS_DIRECTORY.listChapterMembers` RPC を呼ぶ。
4. `resolveInvitees(...)` を実行し、`MAX_INVITEES` 以内であることを検証する（ここまで失敗しても Google リソース・D1 行は作らない）。
5. `meetings` に `status = 'creating'` で挿入し、`meeting_invite_sources`・`meeting_invitees` を D1 batch で保存する。
6. Google Meet API `spaces.create({ config: { accessType, moderation: "ON" } })` を実行する。
   - ここで取得した `space.name`・`space.meetingUri`・`space.meetingCode` を直後に失敗しても失わないよう、`meetings` に記録するか、次のエラー捕捉で保存する。
7. Google Calendar API `events.insert`（`calendarId: "primary"`、`conferenceDataVersion: 1`、`sendUpdates: "all"`）を実行する:
   - `summary`: `title`
   - `description`: ユーザー入力の説明 + 末尾に `${env.APP_URL}/meetings/${meetingId}` へのリンク
   - `start` / `end`: `{ dateTime, timeZone }`
   - `attendees`: 解決済み `invitees`（`community-support@gdgoc.jp` 除外済み）
   - `guestsCanSeeOtherGuests: false`、`guestsCanInviteOthers: false`、`guestsCanModify: false`
   - `conferenceData`:
     ```ts
     {
       conferenceSolution: { key: { type: "hangoutsMeet" } },
       entryPoints: [
         {
           entryPointType: "video",
           uri: space.meetingUri,
           label: space.meetingUri.replace(/^https?:\/\//, ""),
         },
       ],
     }
     ```
   - `extendedProperties`: `{ private: { gdgsMeetId: meetingId } }`
8. 成功時: `meetings` を `status = 'active'`、`space_name`、`meeting_uri`、`meeting_code`、`calendar_event_id`、`calendar_html_link`、`last_error = null` に更新し、`env.MEET_JOBS.send({ type: "sync_members", meetingId })` を投入して `/meetings/${meetingId}` へリダイレクトする。
9. `spaces.create` 以降で失敗時: `meetings` を `status = 'failed'`・`last_error`（機密を含まないエラー要約）・取得済み `space_name` / `meeting_uri` / `meeting_code` に更新し、`/meetings/${meetingId}` へリダイレクト（または画面にエラーを表示）する。スペース自体は Meet API で削除できないが、Calendar 予定が無いため誰も入室できない。

### 5. `MEET_JOBS` Queue と `sync_members` ジョブ

Stage 05（`cleanup_meeting`）・Stage 06（`process_artifact`・`share_artifact`）と並行開発で競合しないよう、メッセージ振り分けを**種別 → ハンドラの登録表**で設計する。

- **`wrangler.toml` 追加**:
  ```toml
  [[queues.producers]]
  binding = "MEET_JOBS"
  queue = "gdgjp-meet-jobs"

  [[queues.consumers]]
  queue = "gdgjp-meet-jobs"
  max_batch_size = 1
  max_concurrency = 1
  max_retries = 5
  ```
- **ジョブ登録表（`app/features/jobs/registry.server.ts`）**:
  - `app/features/jobs/types.ts` に `MeetJobMessage` 型（`{ type: "sync_members"; meetingId: string }`）を定義し、Stage 05/06 が自分の種別をユニオンと `registry.server.ts` のハンドラ登録表 `JOB_HANDLERS` に 1 行ずつ足す。
  - `workers/app.ts` の `queue(batch, env, ctx)` が `JOB_HANDLERS[msg.type]` を呼び、正常終了で `message.ack()`、一時エラー・`invalid_grant` 例外で `message.retry()`、未知のメッセージ型はログ出力して `message.ack()` する。
- **`sync_members` ハンドラ（`app/features/meetings/sync-members.server.ts`）**:
  1. D1 から `meetings` と `meeting_invitees` を読む。会議が存在しない、`status === 'canceled'`、または `space_name` が空なら何もしないで終了する（ack）。
  2. `meet.spaces.members.list(meeting.spaceName)` を全ページ取得する。
  3. 既存メンバーの `email` を `normalizeEmail` でマップ化し、`normalizeEmail(env.GOOGLE_HOST_EMAIL)` は操作対象から除外する。
  4. `meeting_invitees` と突き合わせる（`cohost` → Meet role `"COHOST"`、`participant` → `role` 指定なし）:
     - Meet 側に無い → `spaces.members.create`
     - Meet 側にあるが役割が違う → `spaces.members.delete` → `spaces.members.create`
     - Meet 側にあるが `meeting_invitees` に無い → `spaces.members.delete`
     - **役割まで一致しているメンバーには書き込み API を一切呼ばない（冪等性）**。
  5. 429 / 5xx / ネットワークエラー / `invalid_grant` は例外を投げて Queue の再試行に回す（429 は `message.retry({ delaySeconds: 60 })`。Meet API の書き込みは 1 ユーザーあたり毎分 100 件まで）。特定メンバーの無効メールアドレス等（恒久的 4xx）は他メンバーの同期を止めないよう `meetings.last_error` に警告を記録して処理を継続する。
  6. Queue の再試行（`max_retries`）を使い切って捨てられた場合に備え、失敗を `meetings.last_error` に残して詳細画面に出す。回復は Stage 05 の「チャプターから再同期」（`sync_members` を再投入する）で行う。

### 6. 画面（`@gdgjp/design-system`）

- **`/`（`app/routes/meetings/home.tsx`）**:
  - `requireUser` + `fetchChaptersForUser` を使用（チャプター未所属者も招待された会議を一覧できる）。
  - `google_connection` が未接続・`disconnected` の場合は上部に警告 `Alert` を表示（管理者には `/admin/google` へのリンクを併記）。
  - 「新しい会議」ボタンは `chapters.length > 0` のユーザーにのみ表示する。
  - 自分が閲覧可能な会議（管理者は全件、それ以外は作成者または正規化メール一致の招待者）を「今後の会議」「過去の会議」に分けて表示し、日時・主催チャプター・状態バッジ（`active` / `creating` / `failed` / `canceled`）を出す。
- **`/meetings/new`（`app/routes/meetings/new.tsx`）**:
  - `requireUserWithChapter` を使用。
  - 入力項目: タイトル、日付、開始・終了時刻、タイムゾーン（既定 `Asia/Tokyo`）、説明、主催チャプター（所属チャプターから選択、既定 primary）、チェックボックス「主催チャプターの Organizer を共同主催者として招待」（既定オン）、アクセスの種類（`RESTRICTED` 既定 / `TRUSTED` / `OPEN`）、他チャプターの追加（チャプター選択・範囲 `Organizer のみ` / `Organizer + Member`・役割 `参加者` / `共同主催者`）、個人のメールアドレス（co-host 用・参加者用）。
  - 送信前の招待者数内訳プレビュー: resource route または同ルートの `intent=preview` fetcher でサーバー側解決した「作成者 / 主催チャプター / 他チャプター / 個別メール / 重複統合後合計」の**人数のみ**を返す（ブラウザにチャプターメンバーのメールアドレスは返さない）。
- **`/meetings/:id`（`app/routes/meetings/detail.tsx`）**:
  - `requireUser` + `requireMeetingViewAccess` を使用（権限外は `404`）。
  - 表示内容: タイトル・状態バッジ、`failed` 時の `last_error`、日時・タイムゾーン、Meet 参加リンク（`meeting_uri`）、Calendar 予定リンク（`calendar_html_link`）、アクセス種別、**チャット履歴が自動保存されない旨の案内**、招待者一覧（役割 + 名前、個人追加分のみ条件付きでメール表示）。

### 制約

- **方式 A（Calendar 先行作成）は絶対に使わない。** 理由: PoC で co-host が黙って効かないことを確認済みのため。
- **チャプター由来の招待者のメールアドレスをブラウザへ返さない。** 理由: 他チャプターメンバーのメールアドレス拡散を防ぐ決定事項のため。プレビュー機能でも件数のみを返す。
- **Meet メンバー同期はアクション内で同期実行せず `MEET_JOBS` Queue で行う。** 理由: 招待者が多い場合に Workers の 1 リクエストあたりサブリクエスト上限に達するのを防ぐため。
- **`community-support@gdgoc.jp` と `@googlegroups.com` を招待者に含めない。** 理由: ホスト自身は招待対象外であり、Google グループは Meet API で効かないことが PoC で確定しているため。
- **編集・再同期・取り消し（Stage 05）および生成ファイル・Pub/Sub・cron（Stage 06）の実装には手を出さない。** 理由: ステージ境界と並行開発の安全性を守るため。
- **`schema.sql` と `worker-configuration.d.ts` を手で編集しない。** 理由: 生成物であり、`migrate:local` と `cf-typegen` で更新するため。

## Files to touch — 変更ファイル

### `docs/plans/meet/`

- `00a-poc-findings.md`（事前確認で確定した Calendar / Meet 上限と `MAX_INVITEES` の追記のみ）

### `apps/meet/`

- `wrangler.toml`（`MEET_JOBS` producer / consumer 追加）
- `migrations/0003_meetings.sql`（新規）
- `schema.sql`（`migrate:local` により自動更新）
- `worker-configuration.d.ts`（`cf-typegen` により自動更新）
- `workers/app.ts`（`queue` ハンドラ追加）
- `app/features/jobs/types.ts`（新規）
- `app/features/jobs/registry.server.ts`（新規。ジョブ種別登録表） + `registry.server.test.ts`（新規）
- `app/features/meetings/meeting.ts`（新規。ドメイン型・定数）
- `app/features/meetings/invitees.ts`（新規。`resolveInvitees`、`MAX_INVITEES`、Google グループ検証）
- `app/features/meetings/invitees.test.ts`（新規）
- `app/features/meetings/meetings.repository.server.ts`（新規。D1 CRUD・閲覧クエリ）
- `app/features/meetings/access.server.ts`（新規。`requireMeetingViewAccess`、`toPublicInviteeList`）
- `app/features/meetings/access.server.test.ts`（新規）
- `app/features/meetings/create.server.ts`（新規。作成オーケストレーション）
- `app/features/meetings/create.server.test.ts`（新規）
- `app/features/meetings/sync-members.server.ts`（新規。`sync_members` ジョブ実装）
- `app/features/meetings/sync-members.server.test.ts`（新規）
- `app/features/meetings/components/MeetingForm.tsx`（新規。作成フォーム UI）
- `app/features/meetings/components/InviteeListCard.tsx`（新規）
- `app/routes.ts`（`/meetings/new`、`/meetings/:id` 追加）
- `app/routes/meetings/home.tsx`（新規または Stage 01 空トップを差し替え）
- `app/routes/meetings/new.tsx`（新規）
- `app/routes/meetings/detail.tsx`（新規）
- `tests/architecture/__snapshots__/route-urls.test.ts.snap`（URL スナップショット更新）

## Verification — 完了条件と検証

### 完了条件

1. チャプター所属メンバーが `/meetings/new` から会議を作成すると、`meetings` が `active` になり、`meeting_invite_sources` / `meeting_invitees` が保存され、Google Meet スペースと Calendar 予定（`conferenceData`・`guestsCan*=false`）が作成される。
2. `MEET_JOBS` Queue が `sync_members` を処理し、解決済み招待者全員が Meet スペースのメンバー（co-host は `COHOST`、参加者は `role` なし）として登録される。
3. `/` に自分が作成した会議・招待された会議（今後の会議・過去の会議）が表示され、チャプター未所属の招待者には「新しい会議」ボタンが出ないが会議詳細は閲覧できる。招待されていないユーザーには `/meetings/:id` が `404` になる。
4. 招待者のメールアドレス秘匿が守られ、チャプター由来招待者のメールアドレスが詳細画面・プレビューのレスポンスに含まれない。

### コマンド

```sh
pnpm --filter @gdgjp/meet migrate:local
pnpm --filter @gdgjp/meet cf-typegen
pnpm --filter @gdgjp/meet typecheck
pnpm --filter @gdgjp/meet test
pnpm --filter @gdgjp/meet build
node scripts/check-design-harness.mjs
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **作成者は Member でも `cohost`**: 主催チャプター内のロールが `member` のユーザーが作っても、作成者本人は `role = "cohost"` になる
- **主催チャプター Organizer のオプトアウト**: オプトアウト時は主催チャプターの他の Organizer が入らず、作成者のみ `cohost` として残る
- **複数招待元の重複統合と `cohost` 優先**: 同じ人が `chapter_all`（`participant`）と個別メール（`cohost`）の両方に含まれても 1 件にまとまり、`cohost` が勝つ
- **Gmail ドット違いの同一人物判定**: `a.b@gmail.com` と `ab@gmail.com` が `normalizeEmail` により 1 件に統合される
- **`community-support@gdgoc.jp` と Google グループの除外**: `GOOGLE_HOST_EMAIL` は招待者リストから除外され、`@googlegroups.com` はバリデーションで拒否される
- **他チャプター由来招待者のメール非露出**: `/meetings/:id` の loader 戻り値および `/meetings/new` のプレビュー応答に、チャプター由来メンバーのメールアドレス文字列が含まれない
- **`spaces.create` 後の失敗で `status = 'failed'`**: `events.insert` がエラーを返した場合に `meetings.status = 'failed'`・`last_error`・`space_name` が D1 に残る
- **`sync_members` の冪等性**: 同じ招待者構成で `sync_members` を 2 回実行したとき、2 回目は `members.create` / `members.delete` が 0 回になる
- **`events.insert` のリクエスト本文検証**: `conferenceDataVersion=1`、`sendUpdates="all"`、`guestsCanSeeOtherGuests=false`、`guestsCanInviteOthers=false`、`guestsCanModify=false`、`conferenceData.entryPoints[0].uri`、`extendedProperties.private.gdgsMeetId` が正しく渡される
- **非招待者のアクセス拒否**: 招待者・作成者・管理者のいずれでもないユーザーの `/meetings/:id` へのアクセスが `404` になる

### 手動 E2E

1. ローカルまたは検証環境で Google 接続（`community-support@gdgoc.jp`）を済ませた状態で、チャプター所属アカウントで `/meetings/new` を開き、以下の 3 種を含む会議を作成する:
   - co-host: 組織内のテスト用アカウント（`gdgoc.jp`）
   - 参加者（`role` なし）: 組織外のテスト用 Gmail アカウント
   - 招待しない対照用: 招待されていない対照用アカウント
2. 各招待アカウントのメールボックスに Google Calendar からの招待メールが届いていることを確認する。
3. 招待されたテスト用アカウントの Google Calendar 上で、他のゲスト一覧が表示されない（`guestsCanSeeOtherGuests=false`）ことを確認する。
4. Meet リンクを開き、それぞれの挙動を確認する:
   - co-host のテスト用アカウント: ノックなしで入室でき、ホスト管理アイコン（主催者用コントロール）が使える
   - 参加者のテスト用 Gmail アカウント: ノックなしで入室できるが、ホスト管理が使えない
   - 招待されていない対照用アカウント: 入室時にノック（参加リクエスト）が必要になる
5. 作成した会議が参加者の `/` 一覧に出ること、対照用アカウントで `/meetings/:id` を開くと `404` になることを確認する。
