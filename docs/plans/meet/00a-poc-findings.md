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

- **Stage 03**: OAuth `id_token` の `sub` が `//cloudidentity.googleapis.com/users/<id>` に必要な Google ユーザー ID（`signedinUser.user` で確認した数値 ID）と一致することをテスト購読で確認し、結果を本書に追記する。
- **Stage 04**: `community-support@gdgoc.jp` のライセンスにおける Calendar 予定のゲスト数上限、Meet スペースのメンバー数上限、co-host 数上限を確認し、`MAX_INVITEES` の確定値と根拠を本書に追記する。
