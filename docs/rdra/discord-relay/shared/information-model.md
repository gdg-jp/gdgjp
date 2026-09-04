---
type: rdra-information-model
entities:
  - id: "INFO-001"
    name: "Chapter"
    description: "GDG チャプター。テナント境界そのもの。SSoT は GDG Accounts であり、ローカルには表示用のキャッシュのみ保持する"
    attributes:
      - name: "chapterId"
        type: "number"
        required: true
        description: "GDG Accounts の chapters クレームが返す数値 ID。主キー"
      - name: "slug"
        type: "string"
        required: true
        description: "tokyo などの識別子"
      - name: "name"
        type: "string"
        required: false
        description: "表示名。api.chapters.directory から取得してキャッシュする"
      - name: "kind"
        type: "'gdg' | 'gdgoc'"
        required: false
        description: "チャプター種別。ディレクトリ API 由来"
    relations:
      - target: "INFO-002"
        type: "1:N"
        label: "所有する"
      - target: "INFO-004"
        type: "1:N"
        label: "所有する"
    traces_to: ["UC-602", "UC-603", "SCR-602"]

  - id: "INFO-002"
    name: "Guild"
    description: "チャプターに紐付いた Discord サーバー。1 チャプターが複数保持できる"
    attributes:
      - name: "guildId"
        type: "string (Discord snowflake)"
        required: true
        description: "主キー。全チャプターを通じて一意（COND-202）"
      - name: "chapterId"
        type: "number"
        required: true
        description: "所有チャプター"
      - name: "name"
        type: "string"
        required: false
        description: "GUILD_CREATE 由来のキャッシュ"
      - name: "membershipState"
        type: "STATE-002 の状態"
        required: true
        description: "Claimed / Detached / Released"
      - name: "claimedAt"
        type: "timestamp"
        required: true
        description: "紐付け確定時刻"
      - name: "claimedByUserId"
        type: "string"
        required: true
        description: "招待を実行した organizer の sub"
      - name: "detachedAt"
        type: "timestamp"
        required: false
        description: "Bot 退出を検知した時刻"
    relations:
      - target: "INFO-001"
        type: "N:1"
        label: "所属する"
      - target: "INFO-007"
        type: "1:N"
        label: "イベントの発生元"
    traces_to: ["UC-202", "UC-203", "UC-204", "UC-205", "UC-206", "UC-207", "SCR-202"]

  - id: "INFO-003"
    name: "GuildClaim"
    description: "招待フローのワンタイム claim token。紐付けの一時状態を保持する"
    attributes:
      - name: "tokenHash"
        type: "string"
        required: true
        description: "主キー。平文は保存しない"
      - name: "chapterId"
        type: "number"
        required: true
        description: "束縛先チャプター。token が漏れても他チャプターには使えない"
      - name: "issuedByUserId"
        type: "string"
        required: true
        description: "発行した organizer の sub"
      - name: "expiresAt"
        type: "timestamp"
        required: true
        description: "発行から 15 分（COND-201）"
      - name: "usedAt"
        type: "timestamp"
        required: false
        description: "単回使用の記録"
      - name: "resultGuildId"
        type: "string"
        required: false
        description: "確定した guild_id"
    relations:
      - target: "INFO-001"
        type: "N:1"
        label: "束縛される"
    traces_to: ["UC-201", "UC-202", "SCR-201"]

  - id: "INFO-004"
    name: "Rule"
    description: "転送ルール。イベント種別・フィルタ・配信先の組"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "主キー"
      - name: "chapterId"
        type: "number"
        required: true
        description: "所有チャプター"
      - name: "name"
        type: "string"
        required: true
        description: "利用者がつける識別名"
      - name: "state"
        type: "STATE-004 の状態"
        required: true
        description: "Draft / Enabled / Disabled / Suspended"
      - name: "eventTypes"
        type: "string[]"
        required: true
        description: "対象 Gateway イベント名（VAR-301）"
      - name: "destinationId"
        type: "string"
        required: true
        description: "配信先"
      - name: "storePayload"
        type: "boolean"
        required: true
        description: "配信履歴に本文を保存するか（COND-503）。既定 true"
      - name: "retentionDays"
        type: "number"
        required: true
        description: "履歴保持日数（VAR-502）。既定 30"
      - name: "configVersion"
        type: "number"
        required: true
        description: "Data Plane への伝播判定に使う"
      - name: "updatedByUserId"
        type: "string"
        required: true
        description: "最終更新者"
    relations:
      - target: "INFO-001"
        type: "N:1"
        label: "所属する"
      - target: "INFO-006"
        type: "1:N"
        label: "絞り込む"
      - target: "INFO-005"
        type: "N:1"
        label: "配信先を持つ"
      - target: "INFO-008"
        type: "1:N"
        label: "配信を生む"
    traces_to: ["UC-301", "UC-302", "UC-303", "UC-304", "UC-311", "UC-401", "SCR-301", "SCR-305"]

  - id: "INFO-005"
    name: "Destination"
    description: "配信先エンドポイント。URL 自体が実質的なシークレット"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "主キー"
      - name: "chapterId"
        type: "number"
        required: true
        description: "所有チャプター"
      - name: "url"
        type: "string"
        required: true
        description: "SSRF ガードを通過した URL（COND-302）"
      - name: "headers"
        type: "Record<string,string>"
        required: false
        description: "カスタムヘッダ"
      - name: "timeoutMs"
        type: "number"
        required: true
        description: "配信タイムアウト"
      - name: "signingSecretHash"
        type: "string"
        required: true
        description: "HMAC 用シークレット。平文は生成直後の一度だけ表示（VAR-303）"
      - name: "signingSecretVersion"
        type: "number"
        required: true
        description: "ローテーション世代"
      - name: "rotatedAt"
        type: "timestamp"
        required: false
        description: "最終ローテーション時刻"
    relations:
      - target: "INFO-004"
        type: "1:N"
        label: "使われる"
    traces_to: ["UC-307", "UC-308", "UC-405", "SCR-303"]

  - id: "INFO-006"
    name: "Filter"
    description: "ルールの絞り込み条件。1 ルールに複数付き、すべてを満たしたものがマッチする"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "主キー"
      - name: "ruleId"
        type: "string"
        required: true
        description: "所属ルール"
      - name: "kind"
        type: "'guild' | 'channel' | 'user' | 'bot' | 'role'"
        required: true
        description: "フィルタ種別（VAR-302）"
      - name: "operator"
        type: "'include' | 'exclude'"
        required: true
        description: "含める / 除外する"
      - name: "values"
        type: "string[]"
        required: true
        description: "対象 ID の集合。kind=bot では真偽値相当"
      - name: "includeThreads"
        type: "boolean"
        required: false
        description: "kind=channel のときのみ。スレッドを含むか"
    relations:
      - target: "INFO-004"
        type: "N:1"
        label: "所属する"
    traces_to: ["UC-306", "UC-401"]

  - id: "INFO-007"
    name: "ReceivedEvent"
    description: "Gateway から受信したイベント。マッチしたもののみ保存する"
    attributes:
      - name: "id"
        type: "string (ULID)"
        required: true
        description: "主キー。配信の Idempotency-Key になる"
      - name: "type"
        type: "string"
        required: true
        description: "Gateway の Dispatch イベント名"
      - name: "guildId"
        type: "string"
        required: true
        description: "発生元ギルド"
      - name: "channelId"
        type: "string"
        required: false
        description: "発生元チャンネル"
      - name: "actorId"
        type: "string"
        required: false
        description: "イベントを起こしたユーザー"
      - name: "occurredAt"
        type: "timestamp"
        required: true
        description: "Discord 側のイベント発生時刻"
      - name: "receivedAt"
        type: "timestamp"
        required: true
        description: "Data Plane が受信した時刻"
      - name: "gatewaySeq"
        type: "number"
        required: true
        description: "RESUME に使うシーケンス番号"
      - name: "matchedRuleIds"
        type: "string[]"
        required: true
        description: "マッチしたルール。ライブビューアのデバッグ表示に使う"
      - name: "payload"
        type: "json"
        required: false
        description: "Discord の d フィールド。storePayload=false のルールのみに紐づく場合は保存しない"
    relations:
      - target: "INFO-002"
        type: "N:1"
        label: "発生する"
      - target: "INFO-008"
        type: "1:N"
        label: "配信される"
    traces_to: ["UC-401", "UC-402", "UC-501", "SCR-501"]

  - id: "INFO-008"
    name: "DeliveryAttempt"
    description: "1 回の配信試行。リトライごとに 1 レコード増える"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "主キー。X-Discord-Relay-Delivery-Id になる"
      - name: "eventId"
        type: "string"
        required: true
        description: "対象イベント"
      - name: "ruleId"
        type: "string"
        required: true
        description: "この配信を生んだルール"
      - name: "attempt"
        type: "number"
        required: true
        description: "1 始まりの試行回数"
      - name: "state"
        type: "STATE-003 の状態"
        required: true
        description: "Queued / InFlight / Delivered / Retrying / DeadLettered / Dropped"
      - name: "responseStatus"
        type: "number"
        required: false
        description: "HTTP ステータス"
      - name: "responseBody"
        type: "string"
        required: false
        description: "レスポンス本文（長さ上限あり）"
      - name: "durationMs"
        type: "number"
        required: false
        description: "所要時間"
      - name: "errorKind"
        type: "VAR-401 の値"
        required: false
        description: "失敗の分類"
      - name: "scheduledAt"
        type: "timestamp"
        required: true
        description: "この試行の実行予定時刻。リトライのバックオフを表現する"
    relations:
      - target: "INFO-007"
        type: "N:1"
        label: "対象とする"
      - target: "INFO-004"
        type: "N:1"
        label: "生まれる"
      - target: "INFO-009"
        type: "1:1"
        label: "隔離される"
    traces_to: ["UC-403", "UC-404", "UC-406", "UC-502", "UC-505", "SCR-502", "SCR-504"]

  - id: "INFO-009"
    name: "DeadLetter"
    description: "再試行を諦めた配信の隔離レコード"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "主キー"
      - name: "deliveryAttemptId"
        type: "string"
        required: true
        description: "最後の試行"
      - name: "reason"
        type: "string"
        required: true
        description: "上限到達 / 再試行不能 (4xx) / SSRF ガード拒否 など"
      - name: "deadLetteredAt"
        type: "timestamp"
        required: true
        description: "隔離時刻"
      - name: "resentAt"
        type: "timestamp"
        required: false
        description: "手動再送した時刻"
      - name: "resentByUserId"
        type: "string"
        required: false
        description: "再送を実行した organizer"
    relations:
      - target: "INFO-008"
        type: "1:1"
        label: "由来する"
    traces_to: ["UC-407", "UC-503", "UC-504", "SCR-503"]

  - id: "INFO-010"
    name: "GatewaySession"
    description: "Gateway 接続の現在状態。全チャプターで 1 レコード（将来のシャード化で N になる）"
    attributes:
      - name: "shardId"
        type: "number"
        required: true
        description: "主キー。当面は 0 のみ"
      - name: "state"
        type: "STATE-001 の状態"
        required: true
        description: "接続ライフサイクルの現在位置"
      - name: "sessionId"
        type: "string"
        required: false
        description: "RESUME に使う"
      - name: "resumeGatewayUrl"
        type: "string"
        required: false
        description: "READY で渡される再開先"
      - name: "lastSeq"
        type: "number"
        required: false
        description: "最後に受けたシーケンス番号"
      - name: "latencyMs"
        type: "number"
        required: false
        description: "Heartbeat から ACK までの往復"
      - name: "lastHeartbeatAckAt"
        type: "timestamp"
        required: false
        description: "ACK 欠落の検知に使う"
      - name: "lastEventAt"
        type: "timestamp"
        required: false
        description: "無音状態の検知に使う"
    relations: []
    traces_to: ["UC-101", "UC-102", "UC-103", "UC-104", "UC-105", "SCR-101", "SCR-504"]

  - id: "INFO-011"
    name: "IntentConfig"
    description: "IDENTIFY で宣言する Intent の設定。admin が中央管理する単一レコード"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "主キー（シングルトン）"
      - name: "enabledIntents"
        type: "string[]"
        required: true
        description: "有効化する Intent（VAR-101）"
      - name: "updatedByUserId"
        type: "string"
        required: true
        description: "最終更新した admin"
      - name: "updatedAt"
        type: "timestamp"
        required: true
        description: "変更時刻。再接続の起点になる"
    relations: []
    traces_to: ["UC-106", "UC-107", "UC-305", "SCR-102", "SCR-302"]

  - id: "INFO-012"
    name: "AuditLog"
    description: "設定変更と特権操作の記録"
    attributes:
      - name: "id"
        type: "string"
        required: true
        description: "主キー"
      - name: "actorUserId"
        type: "string"
        required: true
        description: "操作者の sub"
      - name: "actorRole"
        type: "VAR-601 の値"
        required: true
        description: "操作時のロール。is_admin の行使を判別できるようにする"
      - name: "chapterId"
        type: "number"
        required: false
        description: "対象チャプター。admin の横断操作では対象側を記録する"
      - name: "action"
        type: "string"
        required: true
        description: "rule.create / guild.claim / secret.rotate / delivery.resend など"
      - name: "targetType"
        type: "string"
        required: true
        description: "対象エンティティ種別"
      - name: "targetId"
        type: "string"
        required: true
        description: "対象 ID"
      - name: "occurredAt"
        type: "timestamp"
        required: true
        description: "操作時刻"
    relations: []
    traces_to: ["UC-206", "UC-307", "UC-308", "UC-504", "UC-507", "UC-603", "SCR-505"]
---

# 情報モデル

コンテキスト横断のエンティティ定義。

## SSoT の分担

| 区分 | 保持先 | 対象 |
|---|---|---|
| チャプターと所属 | **GDG Accounts** | INFO-001 の実体。本アプリは表示用キャッシュのみ持つ |
| 設定 | **Control Plane (D1)** | INFO-002 〜 INFO-006、INFO-011、INFO-012 |
| 実行時データ | **Data Plane (OCI)** | INFO-007 〜 INFO-010 |

設定は低頻度・整合性重視で画面から編集するため Workers 側に、
配信ログは高頻度・大量で OCI 側に置く。画面は Data Plane の read API 経由で履歴を表示する。

## ER 図

```mermaid
erDiagram
    Chapter ||--o{ Guild : "所有する"
    Chapter ||--o{ Rule : "所有する"
    Chapter ||--o{ Destination : "所有する"
    Chapter ||--o{ GuildClaim : "束縛する"

    Guild ||--o{ ReceivedEvent : "発生元"
    Rule ||--o{ Filter : "絞り込む"
    Destination ||--o{ Rule : "配信先"

    ReceivedEvent ||--o{ DeliveryAttempt : "配信される"
    Rule ||--o{ DeliveryAttempt : "生む"
    DeliveryAttempt ||--o| DeadLetter : "隔離される"

    Chapter {
        number chapterId PK
        string slug
        string name
        string kind
    }
    Guild {
        string guildId PK
        number chapterId FK
        string name
        string membershipState
        timestamp claimedAt
        string claimedByUserId
        timestamp detachedAt
    }
    GuildClaim {
        string tokenHash PK
        number chapterId FK
        string issuedByUserId
        timestamp expiresAt
        timestamp usedAt
        string resultGuildId
    }
    Rule {
        string id PK
        number chapterId FK
        string name
        string state
        string_array eventTypes
        string destinationId FK
        boolean storePayload
        number retentionDays
        number configVersion
    }
    Filter {
        string id PK
        string ruleId FK
        string kind
        string operator
        string_array values
        boolean includeThreads
    }
    Destination {
        string id PK
        number chapterId FK
        string url
        json headers
        number timeoutMs
        string signingSecretHash
        number signingSecretVersion
    }
    ReceivedEvent {
        string id PK
        string type
        string guildId FK
        string channelId
        string actorId
        timestamp occurredAt
        number gatewaySeq
        string_array matchedRuleIds
        json payload
    }
    DeliveryAttempt {
        string id PK
        string eventId FK
        string ruleId FK
        number attempt
        string state
        number responseStatus
        number durationMs
        string errorKind
        timestamp scheduledAt
    }
    DeadLetter {
        string id PK
        string deliveryAttemptId FK
        string reason
        timestamp deadLetteredAt
        timestamp resentAt
        string resentByUserId
    }
    GatewaySession {
        number shardId PK
        string state
        string sessionId
        string resumeGatewayUrl
        number lastSeq
        number latencyMs
        timestamp lastHeartbeatAckAt
    }
    IntentConfig {
        string id PK
        string_array enabledIntents
        string updatedByUserId
        timestamp updatedAt
    }
    AuditLog {
        string id PK
        string actorUserId
        string actorRole
        number chapterId
        string action
        string targetType
        string targetId
        timestamp occurredAt
    }
```

`GatewaySession` / `IntentConfig` / `AuditLog` は他エンティティと外部キーで結ばれない
独立レコードのため、リレーション線を持たない。

## 既存テーブルとの関係

`wiki.discord_guild_settings`（`guild_id` → `chapter_id`、`chapter_id` に UNIQUE）は
**共有しない**。目的が「リマインダー送信先チャンネル」であり、UNIQUE 制約により
1 チャプター 1 ギルドに固定されている。本アプリの INFO-002 は 1 チャプターに複数ギルドを許すため、
制約が両立しない。将来的に統合するなら `gdg-lib` への切り出しが前提になる。
