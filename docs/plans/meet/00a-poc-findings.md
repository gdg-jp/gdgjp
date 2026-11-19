# 00a — PoC（2026-11-18〜19）実 API 検証結果まとめ

本書は `meet.gdgs.jp` 設計にあたり、GCP プロジェクト `gdgs-meet` および `community-support@gdgoc.jp` を用いて **2026-11-18〜19 に実機 API で検証して確定した事実** をまとめた付録である。各ステージの実装時は、推測で Google API 仕様を補わず本書および公式ドキュメントに従うこと。

---

## 1. GCP プロジェクト・認可・スコープ

| 検証項目 | 方法 | 結果 | 設計への影響 |
|---|---|---|---|
| GCP プロジェクト・API 有効化 | `gdgs-meet` プロジェクトで確認 | Meet REST API / Calendar API / Drive API / Workspace Events API / Cloud Pub/Sub API の 5 つを有効化済み | Stage 03 開始前にこれらが有効であることを疎通前提とする |
| OAuth 同意画面の種類 | GCP コンソール設定確認 | 「内部（Internal）」に設定済み | `drive` は制限付き（restricted）スコープだが内部アプリのため Google 審査不要。外部・テスト中だとリフレッシュトークンが 7 日で切れるため内部維持が必須 |
| OAuth クライアント種別 | 検証ではデスクトップ型クライアントでトークン取得 | デスクトップ型で `community-support@gdgoc.jp` のトークン取得に成功 | 本番は Web 型 OAuth クライアント（リダイレクト URI: `https://meet.gdgs.jp/admin/google/callback`, `http://localhost:5193/admin/google/callback`）を利用者が新規作成する |
| 組織外への Drive 共有 | `gdgoc.jp` 管理設定と実 API で確認 | 組織外 Gmail アカウントへの共有が許可されている | 組織外の参加者にも `permissions.create` で問題なく閲覧権限を付与できる |

### スコープの採否

| スコープ | 採否 | 理由 |
|---|---|---|
| `https://www.googleapis.com/auth/meetings.space.created` | **採用** | 方式 B のスペース作成・メンバー管理・conferenceRecords 読み取り・Workspace Events 購読に必要かつ十分 |
| `https://www.googleapis.com/auth/calendar.events` | **採用** | `community-support@gdgoc.jp` の予定作成・添付追加・編集・削除に必要 |
| `https://www.googleapis.com/auth/drive` | **採用** | Meet が生成した録画・ドキュメントのメタデータ取得（`files.get` / `files.list`）と共有（`permissions.create`）に必要 |
| `openid` / `email` | **採用** | `id_token` で接続アカウントが `community-support@gdgoc.jp` であること・`sub` を確認するために必要 |
| `meetings.space.settings` / `meetings.space.readonly` | **不採用** | 方式 B ではアプリ自身が作ったスペースのみ扱うため `meetings.space.created` で足りる |
| `pubsub` | **不採用** | PoC の Pull 検証のみで使用。本番は Pub/Sub Push 受信のため不要 |
| `drive.file` | **不採用** | Meet が生成するファイルは本アプリが作成したファイルではないためアクセス不可 |
| `drive.meet.readonly` | **不採用** | 読み取り専用であり `permissions.create` で共有できない |

---

## 2. 方式 A / B・Meet スペース・co-host・ノック挙動

| 検証項目 | 方法 | 結果 | 設計への影響 |
|---|---|---|---|
| 方式 A（Calendar 先行作成 + Meet API で co-host 追加） | Calendar で Meet を発行し、その後 Meet API `members.create` で `COHOST` 登録して入室確認 | **失敗**: API は 200 を返すが、実機入室時にホスト管理が付与されない | **方式 A を不採用**とし、Meet API 先行作成の**方式 B** を採用 |
| 方式 B（`spaces.create` → `members.create` → `events.insert`） | `spaces.create({ config: { accessType: "RESTRICTED", moderation: "ON" } })` 後に `COHOST` 登録し、Calendar 予定に `conferenceData` で結び付け | **成功**: ホスト管理が正常に動作 | 全作成フローを方式 B に統一 |
| スペース削除の可否 | Meet REST API 仕様および実 API 確認 | スペースの削除 API は存在しない（`endActiveConference` で進行中の会議終了のみ可能） | 作成失敗時や取り消し時はメンバー削除・`RESTRICTED` 化・進行中会議終了で対処する |
| メンバーの役割変更 | Meet REST API 確認 | `members.patch` は存在しない | 役割変更時は `members.delete` → `members.create` で置き換える（Stage 04/05） |
| 会議中の co-host 追加 | 会議参加中のユーザーを `members.create` で `COHOST` に変更して観察 | 変更しても、その参加者が一度退室して入り直すまでホスト管理が付かない | UI に「会議中に co-host に追加された人は、入り直すとホスト管理が使えます」と注意書きを出す |
| Google グループの `COHOST` 登録 | `googlegroups.com` のグループを `COHOST` として `members.create` | API は 200 を返すが**効かない**（グループメンバーはノックが必要で、ホスト管理も付かない） | 最初の版では Google グループを招待先に出さない |
| Calendar UI での予定編集の影響 | 方式 B の予定を Calendar UI からタイトル・時刻・ゲスト変更 | Meet のリンク・設定・メンバーは保たれる。Calendar UI 上には Meet オプション（歯車）が表示されない | D1 を正本とし、Calendar UI 変更は取り込まない。チャット非保存は API 未対応のため仕様とする |
| チャットの保持 | Meet API の `SpaceConfig` と、B の会議中のホスト管理設定を確認 | `SpaceConfig` に保持の項目がない。組織の既定はオフ（ピン留め機能のため）で、会議中は変更できない。Calendar の UI にも設定が出ない | チャットは残さない方針（API が対応したら再検討） |
| 承認（admit）の持続性 | `RESTRICTED` でノック承認した後に別会議（同スペース）へ再入室 | 承認は会議をまたいで引き継がれない（次の会議では再びノックが必要） | 継続して入る参加者はすべて Meet メンバーとして登録する |

### `RESTRICTED` での立場別ノック・ホスト管理（実機確認済み）

| 立場 | ノック | ホスト管理 | 設計への帰結 |
|---|---|---|---|
| Calendar のゲストのみ（Meet メンバー未登録） | **必要** | なし | Calendar のゲストだけではノック回避できないため、**招待者は全員 Meet のメンバーとして API 登録**する |
| Meet のメンバー（`role` 省略） | 不要 | なし | 一般の招待者（`participant`）として `role` なしで `members.create` する |
| Meet のメンバー（`role: "COHOST"`） | 不要 | **あり** | co-host として `role: "COHOST"` で `members.create` する |
| 招待されていない人 | **必要** | なし | `RESTRICTED` 時の想定どおりの保護動作 |

---

## 3. 生成ファイル（録画・文字起こし・Gemini メモ・チャット記録）と Drive / Calendar

| 検証項目 | 方法 | 結果 | 設計への影響 |
|---|---|---|---|
| co-host 開始時の既定共有範囲 | co-host が録画・文字起こし・Gemini メモを開始し、各アカウントでアクセス確認 | **録画・チャット記録**: オーナー（`community-support@gdgoc.jp`）と開始者のみ共有。<br>**文字起こし＋Gemini メモ**: オーナーのみ（開始者にも共有されない）。通知メールもオーナーのみ。他の招待者は一切開けない | 会議終了後にアプリがすべての生成ファイルを招待者全員へ共有し、Calendar 予定へ添付する |
| 方式 B での予定への自動添付 | Calendar 予定を確認 | 方式 B では生成ファイルの Calendar 予定への自動添付が行われない | Stage 06 で `events.patch?supportsAttachments=true` によりアプリが添付する |
| Meet API での生成ファイル取得 | `conferenceRecords?filter=space.name="spaces/xxx"` 配下の `recordings` / `transcripts` / `smartNotes` を確認 | 状態は `STARTED` → `ENDED` → `FILE_GENERATED` に遷移。録画は `driveDestination.file` / `exportUri`、文字起こしと Gemini メモは `docsDestination.document` に格納。**文字起こしと Gemini メモは同一の Google ドキュメント ID** になる | `artifacts` テーブルでは文字起こしと Gemini メモを `kind = 'notes'` の 1 行に統合（`drive_file_id UNIQUE` で自然に重複排除） |
| チャットの記録の特定 | 親 Drive フォルダー内を観察 | チャットの記録は Meet API に出てこない。録画と同じフォルダーに `text/plain` で置かれ、名前は「`<録画ファイル名> - チャットの記録`」（接尾辞は所有者言語依存）。録画の **0.05 秒後** に作られ、`recording` の `fileGenerated` 通知時点で既に存在する | `recording` 処理時に親フォルダーを `files.list` し、`mimeType = 'text/plain'` ＋ 録画ファイル名の前方一致 ＋ 録画の作成時刻に近いことで特定する |
| Drive フォルダーの使い回し | 同じスペースで複数回会議を実施して観察 | オーナーのマイドライブ「Google Meet」フォルダー配下に「`<会議コード> - <最初の録画日時>`」が作られ、**同じスペースの後続の会議でも使い回される** | **フォルダーごと、またはフォルダー中身全部を共有してはならない**（別会議のファイルまで共有される）。Meet API が返したファイルと上記規則のチャット記録のみを共有する |
| Drive 共有とアクセス確認 | `permissions.create(role:"reader", type:"user", sendNotificationEmail=false)` 後に各アカウントで確認 | 組織内のテスト用アカウント（`gdgoc.jp`）、組織外のテスト用 Gmail アカウント、Google グループのいずれも閲覧可能。共有されていない対照用アカウントは拒否。通知メールなし | `sendNotificationEmail=false` で招待者へ順次 `permissions.create` する |
| Gmail アドレスのドット表記揺れ | `permissions.list` の `emailAddress` を観察 | Drive は Gmail アドレスを登録時の表記（ドットの位置など）で返す | 突き合わせには必ず `normalizeEmail`（小文字化、`gmail.com` / `googlemail.com` はローカル部の `.` を削除、`+` 以降は残す）を使う |
| Calendar 予定への添付 | `events.patch?supportsAttachments=true` で `{ fileUrl, title, mimeType }` を送信 | 添付される。`title` と `mimeType` を省くと空欄になる。添付しても Drive 閲覧権限は増えない。patch で上書きされるため既存 `attachments` を残すには事前取得が必要 | `share_artifact` ジョブで必ず Drive 共有を先に行い、`events.get` で既存 `attachments` を取得して追記 patch する（`sendUpdates=none`） |

---

## 4. Workspace Events API と Cloud Pub/Sub 通知

| 検証項目 | 方法 | 結果 | 設計への影響 |
|---|---|---|---|
| ユーザー単位の購読範囲 | `targetResource` を `//cloudidentity.googleapis.com/users/<community-support@ の Google ユーザー ID>` にして作成 | `community-support@gdgoc.jp` が所有する**すべてのスペース（API 作成分含む）**の通知を受信できる。1 購読で全会議をまかなえる | 購読はアプリ全体で 1 つ（`google_subscription` `id=1`）を維持する。なお PoC では `signedinUser.user`（`users/<数値>`）で ID を確認した。OAuth `id_token` の `sub` との一致は **Stage 03 で確認する** |
| 購読作成とイベント型 | `POST https://workspaceevents.googleapis.com/v1/subscriptions`（`payloadOptions: { includeResource: false }`） | 長時間実行オペレーションが返る（検証では即 `done: true`）。必要スコープは `meetings.space.created`（または `readonly`）。13 種のイベント型がある | 本番で購読するのは `conference.v2.ended` と 3 つの `fileGenerated`（`recording` / `transcript` / `smartNote`）の 4 型のみに絞る |
| 購読期限とライフサイクル | 作成した購読の `expireTime` とドキュメントを確認 | リソースデータなしのため最長 **7 日**。延長は `PATCH v1/<subscription>?updateMask=ttl`（`{ ttl: "0s" }` で最大まで延長）。期限切れになると延長も再開もできず再作成が必要。ライフサイクル通知（`expirationReminder` 12h前・1h前 / `expired` / `suspended`）が届く | ライフサイクル通知で即延長・再作成・再有効化しつつ、毎時 cron でも期限（残 2 日未満）と状態を見直す |
| Pub/Sub トピックと Push | `projects/gdgs-meet/topics/meet-events` を確認 | `meet-api-event-push@system.gserviceaccount.com` へ「Pub/Sub パブリッシャー」付与済み。検証用 pull サブスクリプション `meet-events-sub` が存在 | 本番用には利用者が新たに Push サブスクリプション（`https://meet.gdgs.jp/api/google/events`、OIDC トークン付き）を作成する |
| 通知の遅延・挙動（1 分会議実測） | 1 分程度の会議で録画・文字起こし・メモを開始し通知を計測 | 文字起こし＋Gemini メモの `fileGenerated` は終了 3.5 分後、録画は 5.3 分後に生成、通知は数秒で到着。長い会議ではさらに延びる見込み | UI に生成待ち案内を出し、cron で取りこぼしを拾う |
| 通知の順序・重複・ノイズ | 届いた Pub/Sub メッセージを観察 | 1. **発生順に届かない**（後の通知が先着）<br>2. **重複配信される**（同じ `ce-time` で `transcript` / `smartNote` の `fileGenerated` が 2 回ずつ届いた）<br>3. 入室時に数秒で終わる**空の会議記録**が作られる（ファイルなし）<br>4. **アプリ以外で作った会議**（Calendar 直作など）の通知も届く | 1. `conference.ended` に依存せず `fileGenerated` 単体で処理可能にする<br>2. `(ce-type\|リソース名)` で冪等化（`processed_events`）<br>3. ファイルが生まれないので `fileGenerated` 起点なら自然に無視される<br>4. D1 の `meetings.space_name` に無いスペースは即無視し、決して共有しない |
| 通知の中身 | Pub/Sub メッセージを観察 | `attributes` に `ce-type` / `ce-time` / `ce-subject`、`data`（base64 JSON）にはリソース名だけ（例 `{"recording":{"name":"conferenceRecords/<id>/recordings/<id>"}}`）。`includeResource` は Meet では使えない | 詳細（ファイル ID・スペース）は Meet API で取り直す |

### イベント型一覧（全 13 種と本番採用）

- `google.workspace.meet.conference.v2.started`（未使用）
- `google.workspace.meet.conference.v2.ended`（**購読対象**: `conference_records` 記録用）
- `google.workspace.meet.participant.v2.joined` / `left`（未使用）
- `google.workspace.meet.recording.v2.started` / `ended`（未使用）
- `google.workspace.meet.recording.v2.fileGenerated`（**購読対象**）
- `google.workspace.meet.transcript.v2.started` / `ended`（未使用）
- `google.workspace.meet.transcript.v2.fileGenerated`（**購読対象**）
- `google.workspace.meet.smartNote.v2.started` / `ended`（未使用）
- `google.workspace.meet.smartNote.v2.fileGenerated`（**購読対象**）

---

## 5. 検証済み API リクエスト形式

### 5-1. Meet スペース作成・メンバー登録

```json
// POST https://meet.googleapis.com/v2/spaces
{
  "config": {
    "accessType": "RESTRICTED",
    "moderation": "ON"
  }
}

// POST https://meet.googleapis.com/v2/{spaceName}/members
// co-host の場合
{
  "email": "organizer@example.com",
  "role": "COHOST"
}
// 通常の参加者（ノック不要）の場合: role を省略
{
  "email": "participant@example.com"
}
```

### 5-2. Calendar 予定作成（方式 B 結び付け）

```json
// POST https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all
{
  "summary": "会議タイトル",
  "description": "詳細説明\n\n管理ページ: https://meet.gdgs.jp/meetings/<meetingId>",
  "start": { "dateTime": "2026-12-01T19:00:00+09:00", "timeZone": "Asia/Tokyo" },
  "end": { "dateTime": "2026-12-01T20:00:00+09:00", "timeZone": "Asia/Tokyo" },
  "attendees": [
    { "email": "organizer@example.com", "displayName": "Organizer Name" }
  ],
  "guestsCanSeeOtherGuests": false,
  "guestsCanInviteOthers": false,
  "guestsCanModify": false,
  "conferenceData": {
    "conferenceSolution": { "key": { "type": "hangoutsMeet" } },
    "entryPoints": [
      {
        "entryPointType": "video",
        "uri": "https://meet.google.com/xxx-yyyy-zzz",
        "label": "meet.google.com/xxx-yyyy-zzz"
      }
    ]
  },
  "extendedProperties": {
    "private": { "gdgsMeetId": "<meetingId>" }
  }
}
```

### 5-3. Drive 閲覧権限付与

```json
// POST https://www.googleapis.com/drive/v3/files/{fileId}/permissions?sendNotificationEmail=false
{
  "type": "user",
  "role": "reader",
  "emailAddress": "invitee@example.com"
}
```

### 5-4. Calendar 予定へのファイル添付

```json
// PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/{eventId}?supportsAttachments=true&sendUpdates=none
// 既存の attachments を events.get で取得したうえで末尾に追記する
{
  "attachments": [
    {
      "fileUrl": "https://drive.google.com/file/d/...",
      "title": "ファイルタイトル",
      "mimeType": "video/mp4"
    }
  ]
}
```

### 5-5. Workspace Events 購読作成・TTL 延長

```json
// POST https://workspaceevents.googleapis.com/v1/subscriptions
{
  "targetResource": "//cloudidentity.googleapis.com/users/<google_user_id>",
  "eventTypes": [
    "google.workspace.meet.conference.v2.ended",
    "google.workspace.meet.recording.v2.fileGenerated",
    "google.workspace.meet.transcript.v2.fileGenerated",
    "google.workspace.meet.smartNote.v2.fileGenerated"
  ],
  "notificationEndpoint": {
    "pubsubTopic": "projects/gdgs-meet/topics/meet-events"
  },
  "payloadOptions": {
    "includeResource": false
  }
}

// PATCH https://workspaceevents.googleapis.com/v1/{subscriptionName}?updateMask=ttl
{
  "ttl": "0s"
}
```

---

## 6. 今後のステージで確認・追記する事項

- **Stage 03（確認済み 2026-11-19）**: OAuth の `sub` は Cloud Identity のユーザー ID と一致し、`//cloudidentity.googleapis.com/users/<sub>` をそのまま購読対象に使える。詳細は §7-1。
- **Stage 04（確定）**: `gdgoc.jp` は Business Standard。Meet 参加者 150 人、co-host 25 人、Calendar ゲスト 200 人、Drive 直接共有 600 人、Meet API 書き込み 毎分 100 件/ユーザー。これにより `MAX_INVITEES = 150`、`MAX_COHOSTS = 25` とする（出典: support.google.com/meet/answer/7317305, /meet/answer/10885976, /calendar/answer/37161, developers.google.com/workspace/meet/api/guides/limits）。
- **Stage 05 / 06（確認済み 2026-11-19）**: 実機での編集・再同期・取り消しと、生成ファイルの共有・添付・毎時 cron を確認した。本番の Push 受信は未確認。詳細は §7-6、§7-7。

---

## 7. 本実装の手動 E2E（2026-11-19）で判明した事項

### 7-1. Stage 03 共有ホストアカウント接続

- ローカル開発ではデスクトップアプリ種別の OAuth クライアント（リダイレクト URI `http://localhost`）で `http://localhost:5193/admin/google/callback` へのコールバックが受け付けられた。本番は Web アプリ種別のクライアントを別途作成する。
- リフレッシュトークンは AES-GCM（AAD と鍵バージョン 1）で暗号化保存され、復号とアクセストークン更新が成功した。
- `id_token` の `sub` は Cloud Identity のユーザー ID と一致した。

### 7-2. Workspace Events 購読（Stage 06 への申し送り）

- `subscriptions.list` でユーザー対象（`//cloudidentity.googleapis.com/users/<id>`）を絞るには `event_types:"<イベント型>" AND target_resource="<対象>"` の形のフィルタが必要。`target_resource` だけのフィルタは 400（`INVALID_ARGUMENT`）になる。
- 同じユーザー対象に PoC で作成した購読が残っている状態で、別のイベント型（`google.workspace.meet.participant.v2.joined`）を指定して `subscriptions.create` を呼ぶと 409 `ALREADY_EXISTS` になった。ユーザー対象ごとに購読は 1 件と考え、本実装の `ensureSubscription` は既存購読を見つけて採用するか、削除して作り直す必要がある（06-artifacts-events.md §6 に反映済み）。
- 2026-11-19、利用者の承認を得て、本実装の `ensureSubscription` で PoC の購読を置き換えた。PoC の購読は 13 種すべてのイベント型を含んでいたため採用条件（トピックと 4 型が一致）に合わず、409 `ALREADY_EXISTS` → `subscriptions.list` → 削除 → 再作成の経路（結果 `recreated`）を通った。新しい購読は 4 型のみ、状態 `ACTIVE`、有効期限は作成から 7 日後。

### 7-3. Stage 02 / 04 RPC 呼び出し主体の ID

- gdg-lib は RP ごとに独自の UUID を `user.id` として発行し、GDG Accounts のユーザー ID（OIDC `sub`）は `user.oidc_subject` に保存する。
- `ACCOUNTS_DIRECTORY.listChapterMembers` の `actor.user.id` に RP ローカルの ID を渡していたため、accounts 側のメンバーシップ照合が常に一致せず、チャプターメンバーの取得が `forbidden` で失敗していた。単体テストは RPC をモックしていたため検出できなかった。
- `oidc_subject` を引いて accounts のユーザー ID を渡すよう修正した（`fix(meet): pass the accounts user id to the directory RPC`）。

### 7-4. Stage 04 会議作成の実機結果

- 作成した会議は `active` になり、Meet スペースは `accessType=RESTRICTED`、`moderation=ON`。メンバーは作成者が `COHOST`、個別メール招待の参加者は役割なし（`sync_members` ジョブで登録）。
- Calendar 予定は主催者が共有ホストアカウント、ゲストが招待者 2 名、`extendedProperties.private.gdgsMeetId` と会議リンク付きで作成され、両方のテスト用アカウントに招待メールが届いた。
- `RESTRICTED` での入室: co-host はノックなしで入室しホスト管理を使えた。参加者はノックなしで入室しホスト管理は表示されなかった。招待していないアカウントは参加リクエスト（ノック）になった。
- `meet.gdgs.jp` の閲覧権限: 招待していないアカウントで `/meetings/:id` を開くと 404 になった。

### 7-5. Calendar のゲスト一覧と「不明な送信者」

- `guestsCanSeeOtherGuests=false` では、招待者のどちらのアカウントでもゲスト一覧が見えなかった。利用者の判断で、PoC では通常の Google カレンダーと同じく `guestsCanSeeOtherGuests=true` とし、`meet.gdgs.jp` の会議詳細でも閲覧できる全員に招待者全員の名前とメールアドレスを表示する（`feat(meet): show the guest list to everyone invited`、00-overview §2）。
- 外部 Gmail の参加者には招待が「不明な送信者からの招待」として届き、カレンダーに自動追加されなかった。受信者側の設定「カレンダーへの招待状の追加」が「送信者が既知の場合のみ」のときの挙動で、主催者側（Calendar API のパラメータ、Workspace 管理設定）からは変えられない（出典: support.google.com/calendar/answer/13159188、developers.google.com/workspace/calendar/api/v3/reference/events/insert）。招待メールで「はい」と返信すると追加され、送信者を連絡先に追加すると以降は自動で追加される。
- Meet への入室はスペースのメンバー登録で決まるため、カレンダーに追加されていなくてもノックなしで入室できる。会議詳細ページの「ご利用上の注意」にこの対処を案内した。

### 7-6. Stage 06 生成ファイルの共有・添付の実機結果

- ローカルの gcloud アカウントには検証用 pull サブスクリプション `meet-events-sub` の購読者権限が無く（`IAM_PERMISSION_DENIED`）、実際の通知をローカルで受け取れなかった。そこで、実際の会議で生成されたリソース名から Pub/Sub と同じ形の封筒（`attributes` に `ce-type` / `ce-subject` / `ce-time`、`data` はリソース名だけの base64 JSON）を作って `/dev/simulate-event` に送り、毎時 cron はローカルの `http://localhost:5193/cdn-cgi/handler/scheduled?cron=7+*+*+*+*` で起動した。本番の Push 受信（OIDC JWT 検証）は実機では未確認で、Push サブスクリプション作成時に確認する。
- 約 4 分の会議で録画・文字起こし・Gemini メモを開始した。会議終了から約 4 分で 2 種、約 7 分で 3 種すべてが `FILE_GENERATED` になった（30〜40 秒間隔のポーリングで観測）。
- 文字起こしと Gemini メモは同じ Google ドキュメント ID で、`notes` の 1 行に統合された。保存された生成ファイルは録画（`video/mp4`）、Gemini メモ（Google ドキュメント）、チャットの記録（`text/plain`、録画ファイル名の前方一致と作成時刻で特定）の 3 件。
- 通知は順不同・重複ありで送った（録画の `fileGenerated` を 2 回、続いて文字起こし、Gemini メモ、最後に `conference.ended`）。2 回目の録画通知は `messageId` が違っても `(ce-type|リソース名)` のキーで `duplicate` になった。約 10 秒で 3 件とも Drive 共有と Calendar 添付まで完了した。
- Drive の閲覧権限はオーナー以外は招待者だけに付与され、正規化したメールアドレスで招待者一覧と完全に一致した（過不足なし）。Drive の共有通知メールは届かず、招待していない対照用アカウントは開けなかった。
- Calendar 予定には 3 件が添付され、ゲスト一覧の公開設定（`guestsCanSeeOtherGuests` など）は変わらなかった。
- 毎時 cron を実行しても購読は `ACTIVE` のまま維持され、直近の会議記録を補完しても生成ファイル・Drive 権限・Calendar 添付は重複しなかった。会議を取り消した後の cron は、その会議の再共有も再試行もしなかった。

### 7-7. Stage 05 編集・再同期・取り消しの実機結果

- 開始・終了時刻の変更: Calendar 予定は `sendUpdates=all` の patch で更新され、招待者に更新メールが届いた。Stage 06 が `supportsAttachments=true` で付けた添付 3 件は、`attachments` も `supportsAttachments` も指定しない patch の後も残り、ゲスト一覧の公開設定も維持された。
- 参加者の追加: 追加したテスト用アカウントに招待メールが届き（外部 Gmail のため「不明な送信者」として届いた）、会議詳細ページを開けるようになった。生成ファイルの再共有ジョブにより、保存から約 6 秒で 3 件の閲覧権限が付与された。Drive の共有通知メールは届かず、Calendar の添付は重複しなかった。
- co-host への昇格と降格: Meet スペースのメンバーの役割が `COHOST` と役割なしの間で切り替わり、通話に入り直すとホスト管理の表示・非表示が切り替わった。招待者のメールアドレスが変わらないため Calendar 予定の `updated` は変わらなかった。
- チャプターからの再同期: ローカルの Accounts DB でだけ参加者のテスト用アカウントを主催チャプターのオーガナイザーにして再同期すると「変更あり」となり、co-host に昇格した（招待元は `host_chapter_organizers` と `email`、co-host が優先）。オーガナイザーから外して再同期すると参加者に戻り、もう一度再同期すると「変更なし」になった。招待者のメールアドレスが同じ間は Calendar 予定の `updated` は変わらなかった。
- 取り消し: `events.delete`（`sendUpdates=all`）で招待者全員に取り消しメールが届き、各アカウントのカレンダーから予定が消えた。取り消し後の `events.get` は 404 ではなく `status: "cancelled"` を返した。`cleanup_meeting` ジョブで Meet スペースのメンバーは全員削除され、`accessType=RESTRICTED` のまま進行中の会議も無かった。取り消しの数分後には、招待されていたアカウントも入室にノックが必要になった。共有済みの Drive 権限は設計どおり変更されなかった。
