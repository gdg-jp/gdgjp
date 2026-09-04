---
type: rdra-state-models
models:
  - id: "STATE-001"
    entity: "INFO-010"
    name: "Gateway 接続状態"
    description: "共通 Bot の単一 Gateway セッションのライフサイクル。全チャプターがこの状態に依存する"
    states:
      - name: "Disconnected"
        description: "接続していない。起動直後、または意図的な停止中"
      - name: "Connecting"
        description: "WebSocket を張っている。HELLO 待ち"
      - name: "Identifying"
        description: "IDENTIFY を送り READY を待っている"
      - name: "Resuming"
        description: "resume_gateway_url へ RESUME を送り RESUMED を待っている"
      - name: "Ready"
        description: "セッション確立。イベントを受信しハートビートを維持している"
      - name: "Backoff"
        description: "再接続待機中。指数バックオフ + ジッタ"
    transitions:
      - from: "Disconnected"
        to: "Connecting"
        trigger: "UC-101"
        condition: "プロセス起動、または Intent 変更後の再起動"
      - from: "Connecting"
        to: "Identifying"
        trigger: "EVT-101"
        condition: "有効な session_id を持たない"
      - from: "Connecting"
        to: "Resuming"
        trigger: "EVT-101"
        condition: "有効な session_id と lastSeq を持つ"
      - from: "Identifying"
        to: "Ready"
        trigger: "EVT-105"
      - from: "Resuming"
        to: "Ready"
        trigger: "RESUMED 受信"
      - from: "Resuming"
        to: "Identifying"
        trigger: "EVT-103"
        condition: "Invalid Session (resumable=false)。ここで切断中のイベントが欠損する"
      - from: "Ready"
        to: "Backoff"
        trigger: "EVT-103"
        condition: "WebSocket クローズ、op 7 Reconnect、またはハートビート ACK 欠落"
      - from: "Identifying"
        to: "Backoff"
        trigger: "EVT-103"
        condition: "IDENTIFY 拒否。Used disallowed intents を含む（COND-103）"
      - from: "Backoff"
        to: "Connecting"
        trigger: "UC-104"
        condition: "バックオフ時間の経過"
      - from: "Ready"
        to: "Disconnected"
        trigger: "UC-106"
        condition: "Intent 変更による意図的な再起動（COND-102）"
    traces_to: ["UC-101", "UC-102", "UC-103", "UC-104", "UC-105", "UC-106"]

  - id: "STATE-002"
    entity: "INFO-002"
    name: "ギルド紐付け状態"
    description: "Discord サーバーとチャプターの紐付けのライフサイクル"
    states:
      - name: "Pending"
        description: "claim token を発行し、招待の完了を待っている。実体は INFO-003 GuildClaim"
      - name: "Claimed"
        description: "チャプターに紐付き、Bot が在籍している。ルールを有効化できる"
      - name: "Detached"
        description: "紐付けは残っているが Bot が退出している。ルールは自動停止される"
      - name: "Released"
        description: "紐付けが解除された。同じギルドを他チャプターが claim できる"
    transitions:
      - from: "Pending"
        to: "Claimed"
        trigger: "UC-202"
        condition: "COND-201 かつ COND-202 を満たす"
      - from: "Pending"
        to: "Released"
        trigger: "COND-201"
        condition: "claim token の有効期限切れ。紐付けは成立しない"
      - from: "Claimed"
        to: "Detached"
        trigger: "UC-205"
        condition: "EVT-202 GUILD_DELETE かつ unavailable ではない"
      - from: "Detached"
        to: "Claimed"
        trigger: "UC-207"
        condition: "EVT-203 GUILD_CREATE。ルールは自動再開しない"
      - from: "Claimed"
        to: "Released"
        trigger: "UC-204"
        condition: "organizer による手動解除"
      - from: "Detached"
        to: "Released"
        trigger: "UC-204"
        condition: "organizer による手動解除"
      - from: "Claimed"
        to: "Claimed"
        trigger: "UC-206"
        condition: "admin による他チャプターへの移管。chapterId が変わる"
    traces_to: ["UC-201", "UC-202", "UC-204", "UC-205", "UC-206", "UC-207"]

  - id: "STATE-003"
    entity: "INFO-008"
    name: "配信状態"
    description: "1 件の配信試行が辿る状態。at-least-once を成立させる中核"
    states:
      - name: "Queued"
        description: "永続キューに入り、配信ワーカーの取り出しを待っている"
      - name: "InFlight"
        description: "HTTP POST を実行中"
      - name: "Delivered"
        description: "2xx を受け取った。終端"
      - name: "Retrying"
        description: "再試行可能な失敗。次のバックオフ時刻を待っている"
      - name: "DeadLettered"
        description: "再試行を諦めて隔離した。手動再送の対象。終端"
      - name: "Dropped"
        description: "バックプレッシャで破棄した。終端"
    transitions:
      - from: "Queued"
        to: "InFlight"
        trigger: "UC-404"
        condition: "並列実行数と宛先レート制限に空きがある"
      - from: "Queued"
        to: "Dropped"
        trigger: "UC-408"
        condition: "COND-403 キュー上限を超過した"
      - from: "InFlight"
        to: "Delivered"
        trigger: "UC-404"
        condition: "2xx"
      - from: "InFlight"
        to: "Retrying"
        trigger: "UC-406"
        condition: "COND-402 を満たし、かつ試行回数が上限未満"
      - from: "Retrying"
        to: "Queued"
        trigger: "EVT-402"
        condition: "VAR-402 のバックオフ経過。429 は Retry-After を優先"
      - from: "InFlight"
        to: "DeadLettered"
        trigger: "UC-407"
        condition: "COND-402 を満たさない（429 以外の 4xx）、または試行回数が上限到達"
      - from: "InFlight"
        to: "DeadLettered"
        trigger: "UC-407"
        condition: "COND-404 配信時 SSRF ガードで拒否"
      - from: "DeadLettered"
        to: "Queued"
        trigger: "UC-504"
        condition: "COND-501 organizer による手動再送"
    traces_to: ["UC-403", "UC-404", "UC-406", "UC-407", "UC-408", "UC-504"]

  - id: "STATE-004"
    entity: "INFO-004"
    name: "ルール状態"
    description: "転送ルールの有効性。Suspended は自動停止であり、自動復帰しない点が要"
    states:
      - name: "Draft"
        description: "作成直後。まだ配信しない。ドライランとテスト配信は可能"
      - name: "Enabled"
        description: "有効。実イベントを評価し配信する"
      - name: "Disabled"
        description: "organizer が明示的に止めた"
      - name: "Suspended"
        description: "ギルド離脱や紐付け解除によりシステムが自動停止した"
    transitions:
      - from: "Draft"
        to: "Enabled"
        trigger: "UC-303"
        condition: "COND-301 organizer である"
      - from: "Enabled"
        to: "Disabled"
        trigger: "UC-303"
      - from: "Disabled"
        to: "Enabled"
        trigger: "UC-303"
      - from: "Enabled"
        to: "Suspended"
        trigger: "UC-205"
        condition: "対象ギルドが Detached になった"
      - from: "Enabled"
        to: "Suspended"
        trigger: "UC-204"
        condition: "対象ギルドの紐付けが解除された"
      - from: "Disabled"
        to: "Suspended"
        trigger: "UC-205"
      - from: "Suspended"
        to: "Enabled"
        trigger: "UC-303"
        condition: "ギルドが Claimed に戻り、organizer が明示的に再有効化した。自動復帰はしない"
    traces_to: ["UC-301", "UC-303", "UC-204", "UC-205"]
---

# 状態モデル

## STATE-001 Gateway 接続状態

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Connecting: UC-101 起動
    Connecting --> Identifying: EVT-101 HELLO<br/>(session なし)
    Connecting --> Resuming: EVT-101 HELLO<br/>(session あり)
    Identifying --> Ready: EVT-105 READY
    Resuming --> Ready: RESUMED
    Resuming --> Identifying: Invalid Session<br/>(resumable=false)<br/>※イベント欠損
    Ready --> Backoff: EVT-103 切断 / op7 /<br/>ACK 欠落
    Identifying --> Backoff: IDENTIFY 拒否<br/>(disallowed intents)
    Backoff --> Connecting: UC-104 バックオフ経過
    Ready --> Disconnected: UC-106 Intent 変更

    note right of Ready
        この状態でのみイベントを受信する。
        全チャプターがこの 1 状態に依存する。
    end note
```

## STATE-002 ギルド紐付け状態

```mermaid
stateDiagram-v2
    [*] --> Pending: UC-201 招待リンク発行
    Pending --> Claimed: UC-202 コールバック検証成功<br/>(COND-201 + COND-202)
    Pending --> Released: claim token 期限切れ
    Claimed --> Detached: UC-205 GUILD_DELETE<br/>(unavailable でない)
    Detached --> Claimed: UC-207 GUILD_CREATE<br/>※ルールは自動再開しない
    Claimed --> Released: UC-204 organizer 解除
    Detached --> Released: UC-204 organizer 解除
    Claimed --> Claimed: UC-206 admin 移管<br/>(chapterId 変更)
    Released --> [*]

    note right of Detached
        Bot が外れても紐付けは消さない。
        再招待で復帰できるようにするため。
    end note
```

## STATE-003 配信状態

```mermaid
stateDiagram-v2
    [*] --> Queued: UC-403 投入
    Queued --> InFlight: UC-404 ワーカー取得
    Queued --> Dropped: UC-408 キュー上限<br/>(COND-403)
    InFlight --> Delivered: 2xx
    InFlight --> Retrying: COND-402 かつ<br/>試行 < 上限
    Retrying --> Queued: EVT-402 バックオフ経過<br/>(VAR-402)
    InFlight --> DeadLettered: 4xx (429 以外)<br/>または上限到達
    InFlight --> DeadLettered: COND-404 SSRF 拒否
    DeadLettered --> Queued: UC-504 手動再送<br/>(COND-501)
    Delivered --> [*]
    Dropped --> [*]

    note right of DeadLettered
        終端だが手動再送で
        Queued に戻せる唯一の状態。
    end note
```

## STATE-004 ルール状態

```mermaid
stateDiagram-v2
    [*] --> Draft: UC-301 作成
    Draft --> Enabled: UC-303 有効化
    Enabled --> Disabled: UC-303 無効化
    Disabled --> Enabled: UC-303 有効化
    Enabled --> Suspended: UC-205 ギルド離脱<br/>UC-204 紐付け解除
    Disabled --> Suspended: UC-205 ギルド離脱
    Suspended --> Enabled: UC-303 organizer が<br/>明示的に再有効化
    Draft --> [*]: UC-304 削除
    Enabled --> [*]: UC-304 削除
    Disabled --> [*]: UC-304 削除
    Suspended --> [*]: UC-304 削除

    note right of Suspended
        システムが自動で止めた状態。
        自動復帰させない。黙って配信が
        復活すると事故になるため。
    end note
```

## 状態間の連動

3 つの状態モデルは独立ではなく、上流から下流へ連動する。

```mermaid
graph TD
    S001["STATE-001<br/>Gateway 接続状態"]
    S002["STATE-002<br/>ギルド紐付け状態"]
    S004["STATE-004<br/>ルール状態"]
    S003["STATE-003<br/>配信状態"]

    S001 -->|Ready でなければ<br/>イベントが発生しない| S003
    S002 -->|Detached / Released で<br/>Suspended へ| S004
    S004 -->|Enabled のルールだけが<br/>配信を生む COND-401| S003
```

**「配信が来ない」の切り分けは、この連動を上から辿ることになる。**
BIZ-005 のライブイベントビューア（UC-501）は、この経路のどこで落ちたかを
画面上で示すことを目的としている。
