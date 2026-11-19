# Stage 05 — meeting-edit-cancel 会議の編集・チャプター再同期・取り消し

## Context — 背景とリポジトリ状況

**着手前に [`docs/plans/meet/00-overview.md`](00-overview.md) と [`docs/plans/meet/00a-poc-findings.md`](00a-poc-findings.md) を読むこと。**

### なぜやるか

Stage 04 で作成した会議のタイトル・説明・時刻・アクセス種別・招待元を後から変更できるようにし、チャプターメンバー増減をワンクリックで反映する「チャプターから再同期」機能と、会議の取り消し（予定削除・Meet メンバー全削除・入室遮断・進行中会議終了）を実装する。

### 依存と対象範囲

- 依存: Stage 04（`meetings` / `meeting_invite_sources` / `meeting_invitees`、`invitees.ts`、`sync-members.server.ts`、`JOB_HANDLERS` 登録表）。**Stage 06 と並行実装できる。**
- 対象: `apps/meet/` のみ。
- 本ステージのスコープ外（**実装しない**）:
  - `artifacts` / `conference_records` / Pub/Sub Push / cron（Stage 06 の担当）
  - **Stage 06 との境界（招待者追加時の既存生成ファイル再共有）の扱い**:
    - 編集や再同期で招待者が増えた場合、既存の生成ファイル（`artifacts`）を新しい招待者にも共有するため `share_artifact` ジョブを投げる必要があるが、本ステージと Stage 06 は並行実装となる。
    - 判断基準: 本ステージでは `app/features/meetings/artifact-reshare.server.ts` を用意し、関数 `enqueueArtifactReshareForMeeting(env, meetingId): Promise<void>` を**境界フック**として呼び出す設計にする。Stage 06 未マージの状態では同ファイルは no-op（`artifacts` テーブルが存在しないため何もせず return）として実装し、Stage 06 の実装時（または Stage 06 が先に完了していれば本ステージ実装時）に同フックの中身を「該当会議の `artifacts` 全件に対して `{ type: "share_artifact", artifactId }` を `MEET_JOBS` へ積む」実装に接続する。これによりどちらの順でマージしても型エラーや D1 テーブル未存在エラーが起きない。

### 読むべきもの

- `apps/meet/app/features/meetings/{access.server.ts,invitees.ts,meetings.repository.server.ts,sync-members.server.ts}`（Stage 04）
- `apps/meet/app/features/jobs/{types.ts,registry.server.ts}`（Stage 04）— `JOB_HANDLERS` 登録表
- `apps/meet/app/features/google/{meet,calendar}.server.ts` と `email.ts`（Stage 03）

### 再利用する既存実装（書き直さない）

- **`resolveInvitees`（`app/features/meetings/invitees.ts`）** — 編集時・再同期時も作成時とまったく同じ解決・重複統合・`GOOGLE_HOST_EMAIL` 除外・作成者 `cohost` 強制ルールをそのまま再利用する
- **`sync_members` ジョブ（`app/features/meetings/sync-members.server.ts`）** — 招待者変更時も既存ジョブをそのままエンキューする（役割変更時の `delete → create` 置換もここで完結する）

## Design — 設計

### 1. 編集・取り消し権限（`app/features/meetings/access.server.ts` 拡張）

`canEditMeeting(user, meeting, invitees): boolean` を追加する。

- 前提: `meeting.status === "active"` であること。`canceled` または `failed` の会議は編集・再同期・取り消しのいずれも不可（アクション時は `409` または `400` を返し、画面では操作ボタンを非表示にする）。
- 許可条件（チャプター所属は問わない）:
  1. `user.isAdmin === true`（GDG Accounts 管理者）
  2. `invitees` の中に `emailNormalized === normalizeEmail(user.email)` かつ `role === "cohost"` の行が存在する（作成者は作成時に必ず `cohost` で登録されているため含まれる）
- 非 `cohost` の参加者（`role === "participant"`）が編集画面や編集・取り消し POST を叩いた場合は `403 Forbidden` を返す（閲覧自体は可能なため `404` ではなく `403`）。会議に無関係な第三者は従来どおり `404`。

### 2. 会議の編集（`/meetings/:id/edit`、`app/features/meetings/update-meeting.server.ts`）

#### 画面と項目
- `app/routes/meetings/edit.tsx`（`requireUser` + `canEditMeeting`、非 `cohost` は `403`、非招待者は `404`）。
- Stage 04 の `MeetingForm` コンポーネントを再利用し、`meetings` と `meeting_invite_sources` から初期値を埋める。
- 変更可能な項目: タイトル、説明、日時（開始・終了・タイムゾーン）、アクセス種別（`RESTRICTED` / `TRUSTED` / `OPEN`）、招待元（主催チャプターの Organizer 招待 ON/OFF、他チャプター追加、個人メール追加）。主催チャプター自体と作成者は変更不可（作成者は常に `cohost`）。
- 編集画面および詳細画面に注記を表示する:
  > 「会議中に共同主催者（co-host）に追加された人は、会議に入り直すとホスト管理が使えます。」

#### 更新処理
1. バリデーションと `google_connection` の `connected` 確認。
2. `access_type` が変更された場合のみ `meet.patchSpace(accessToken, meeting.spaceName, { config: { accessType } }, "config.accessType")` を呼ぶ。
3. 招待元（`meeting_invite_sources`）に変更がある場合:
   - `ACCOUNTS_DIRECTORY` RPC で対象チャプターのメンバーを取得し、`resolveInvitees` で招待者を再解決する（招待元に変更がない通常のタイトル・時刻修正ではチャプターメンバーの再取得はせず、既存のスナップショットを維持する）。
   - `meeting_invite_sources` と `meeting_invitees` を D1 batch で差し替える。
4. `calendar.patchEvent`（`calendarId: "primary"`, `eventId: meeting.calendarEventId`, `sendUpdates: "all"`）:
   - `summary`, `description`（管理ページ URL 維持）, `start`, `end`（`timeZone` 付き）を更新。
   - 招待者が変更された場合は `attendees` も新しい招待者一覧で更新する（`guestsCanSeeOtherGuests: true`、`guestsCanInviteOthers: false`、`guestsCanModify: false` を維持）。
5. D1 `meetings` を更新（`updated_at = now`）。
6. 招待者が変更された場合:
   - `await env.MEET_JOBS.send({ type: "sync_members", meetingId })`
   - `await enqueueArtifactReshareForMeeting(env, meetingId)`

### 3. 「チャプターから再同期」アクション

詳細ページ（`/meetings/:id`）または編集ページに `cohost` / 管理者向けの「チャプターから再同期」ボタン（POST intent `"resync"`）を置く。

1. DB に保存されている現在の `meeting_invite_sources` を読む。
2. 現在の `ACCOUNTS_DIRECTORY` RPC から最新メンバーを取得し、`resolveInvitees` を再実行する。
3. 既存の `meeting_invitees` と差分があるか確認し、変更があれば:
   - `meeting_invitees` を D1 で更新
   - `calendar.patchEvent(sendUpdates: "all", { attendees })` で予定を更新
   - `MEET_JOBS.send({ type: "sync_members", meetingId })`
   - `enqueueArtifactReshareForMeeting(env, meetingId)`
4. 画面に「再同期しました（招待者 X 名、変更あり/なし）」のフィードバックを表示する。

なお、招待者を外した場合でも、既に共有済みの Drive ファイル閲覧権限は自動では剥奪しない（最初の版の仕様。詳細画面・ヘルプにもその旨を注記する）。

### 4. 会議の取り消しと `cleanup_meeting` ジョブ

#### 取り消しアクション（詳細ページ `/meetings/:id` の確認ダイアログ付き POST intent `"cancel"`）
1. `requireUser` + `canEditMeeting`（`status === 'active'` のみ許可）。
2. `calendar.deleteEvent(accessToken, { calendarId: "primary", eventId: meeting.calendarEventId, sendUpdates: "all" })` を呼ぶ（既に Google 側で削除済みで `404` / `410` が返った場合は冪等に成功扱いとする）。
3. D1 `meetings` を `status = 'canceled'`, `canceled_at = now`, `updated_at = now` に更新する。
4. `await env.MEET_JOBS.send({ type: "cleanup_meeting", meetingId })` を投入する。

#### `cleanup_meeting` ジョブ（`app/features/meetings/cleanup-meeting.server.ts` + `JOB_HANDLERS` 登録）
1. `meetings` を読み、`space_name` がなければ終了。
2. `meet.listSpaceMembers(accessToken, meeting.spaceName)` で登録中のメンバーを全件取得し、オーナー自身（`GOOGLE_HOST_EMAIL` と一致するものがある場合）を除いてすべて `meet.deleteSpaceMember` で削除する。
3. `meet.patchSpace(accessToken, meeting.spaceName, { config: { accessType: "RESTRICTED" } }, "config.accessType")` でアクセスを `RESTRICTED` に戻す。
4. `meet.endActiveConference(accessToken, meeting.spaceName)` を呼び、現在進行中の会議があれば終了させる（進行中会議が存在せず `404` や `FAILED_PRECONDITION` が返った場合は正常終了として扱う）。
5. 補足: Meet スペース自体は API で削除できないため残るが、メンバーゼロ + `RESTRICTED` により参加不可となる。また既に共有済みの Drive ファイル権限はそのまま維持する。

### 制約

- **取り消し済み（`canceled`）や失敗（`failed`）の会議に対する編集・再同期・再取り消しを許可しない。** 理由: Calendar 予定が既に存在しないため、更新が破綻する。
- **招待者削除時に Drive 権限を削除しない。** 理由: 最初の版ではアプリが付与した permission か手動付与かを追跡していない（00-overview §2）。
- **`JOB_HANDLERS` への追加は `cleanup_meeting` の 1 エントリのみとする。** 理由: Stage 06 と並行作業でマージ競合を起こさないため。
- **`artifacts` テーブルの存在を前提にした SQL を本ステージ内で直接書かない。** 理由: Stage 06 が未マージでも本ステージ単独でテスト・ビルドが通るようにし、`artifact-reshare.server.ts` のフック経由で接続する。

## Files to touch — 変更ファイル

### `apps/meet/`

- `app/routes.ts`（`meetings/:id/edit` 追加）
- `app/features/jobs/{types.ts,registry.server.ts}`（`cleanup_meeting` ジョブ型とハンドラ登録を追加）
- `app/features/meetings/access.server.ts` + `access.server.test.ts`（`canEditMeeting` 追加）
- `app/features/meetings/meetings.repository.server.ts`（更新・取り消し・再同期用クエリ追加）
- `app/features/meetings/artifact-reshare.server.ts`（新規 — 境界フック。Stage 06 未実装時は no-op）
- `app/features/meetings/update-meeting.server.ts`（新規） + `update-meeting.server.test.ts`（新規）
- `app/features/meetings/cancel-meeting.server.ts`（新規） + `cancel-meeting.server.test.ts`（新規）
- `app/features/meetings/cleanup-meeting.server.ts`（新規） + `cleanup-meeting.server.test.ts`（新規）
- `app/routes/meetings/detail.tsx`（編集リンク・再同期ボタン・取り消し確認ダイアログ・co-host 注意書き追加）
- `app/routes/meetings/edit.tsx`（新規）
- `tests/architecture/__snapshots__/route-urls.test.ts.snap`
- `ARCHITECTURE.md`

## Verification — 完了条件と検証

### 1. 完了条件

1. `typecheck`、`test`、`build`、`check-design-harness.mjs` がすべて通る。
2. `cohost`（別チャプターやチャプター未所属の招待者含む）と Accounts 管理者が `/meetings/:id/edit`・再同期・取り消しを実行でき、非 `cohost` の参加者は `403` で拒否される。
3. 取り消し後に予定が削除され、`cleanup_meeting` ジョブで Meet スペースの全メンバー削除・`RESTRICTED` 化・進行中会議終了が実行される。

### 2. コマンド

```sh
pnpm --filter @gdgjp/meet typecheck
pnpm --filter @gdgjp/meet test
pnpm --filter @gdgjp/meet build
node scripts/check-design-harness.mjs
pnpm ci:quick
```

### 3. 回帰として固定すべきテスト

- **`access.server.test.ts`**:
  - `cohost` でない一般招待者（`role === "participant"`）は編集・再同期・取り消しを実行できない（`403`）
  - GDG Accounts 管理者（`isAdmin: true`）は招待されていなくても編集・取り消しできる
  - チャプター未所属ユーザーでも、正規化メールが `cohost` の招待者と一致すれば編集・取り消しできる
  - `status === 'canceled'` の会議は編集・再同期・再取り消しできない
- **`sync-members.server.test.ts` / `update-meeting.server.test.ts`**:
  - 役割変更（`participant` → `cohost`、または `cohost` → `participant`）が必ず `deleteSpaceMember` → `createSpaceMember` の順で実行される
  - 外した招待者は Meet のメンバー（`sync_members`）および Calendar `attendees` からは消えるが、Drive 共有権限削除 API は呼ばれない
- **`cleanup-meeting.server.test.ts`**:
  - 取り消し時に `calendar.deleteEvent(sendUpdates: "all")` が呼ばれ、`cleanup_meeting` で全メンバー削除・`RESTRICTED` 設定・`endActiveConference` が実行される（進行中会議が無いときの 404/FAILED_PRECONDITION で失敗しない）

### 4. 手動 E2E（実 Google）

1. Stage 04 で作成した会議（または新規会議）を `cohost` アカウントで開き、`/meetings/:id/edit` から時刻を 30 分後ろへ変更して保存 → 招待者のテスト用アカウントに Calendar 更新通知メールが届くことを確認する。
2. 編集画面でテスト用アカウントの 1 人の役割を `cohost` から `participant` に外して保存（さらに会議中だった場合は入り直す）→ ホスト管理メニューが消えること、およびノックなしで入室できることを確認する。
3. 詳細画面で「チャプターから再同期」を押して正常終了することを確認する。
4. 詳細画面から会議を「取り消し」→ 招待者にキャンセル通知メールが届き、Calendar から予定が消え、Meet リンクへ非オーナーのテスト用アカウントで入室しようとするとノックが必要（`RESTRICTED` かつメンバー削除済み）になることを確認する。
