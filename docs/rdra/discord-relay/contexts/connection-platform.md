---
type: rdra-context
id: "BIZ-001"
name: "connection-platform"
display_name: "接続基盤運用"

value:
  goals: ["GOAL-001", "GOAL-005"]
  requirements:
    - id: "REQ-101"
      description: "専用 Bot が Discord Gateway に常時接続し、紐付け済みギルドのイベントを受信できること"
      traces_to: ["GOAL-001"]
    - id: "REQ-102"
      description: "切断・再起動から人手を介さず復旧し、復旧できない場合は検知できること"
      traces_to: ["GOAL-005"]
    - id: "REQ-103"
      description: "受信し得る情報の範囲 (Intent) が中央で管理され、利用者に開示されること"
      traces_to: ["GOAL-005"]

environment:
  business_usecases:
    - id: "BUC-101"
      name: "Gateway 接続を維持する"
      actors: ["ACTOR-005"]
      description: "IDENTIFY / HEARTBEAT / RESUME のライフサイクルを回し、切断時は自動再接続する"
      traces_to: ["REQ-101", "REQ-102"]
    - id: "BUC-102"
      name: "Intent を管理する"
      actors: ["ACTOR-003"]
      description: "有効ルールから必要 Intent を算出し、管理者が Developer Portal 側の設定と突き合わせる"
      traces_to: ["REQ-103"]

boundary:
  usecases:
    - id: "UC-101"
      name: "Gateway に接続する"
      actors: ["ACTOR-005"]
      events: ["EVT-101"]
      traces_to: ["BUC-101"]
      description: "HELLO 受信後に IDENTIFY を送り、設定済み Intent でセッションを確立する"
    - id: "UC-102"
      name: "ハートビートを送出し ACK を監視する"
      actors: ["ACTOR-005"]
      events: ["EVT-104"]
      traces_to: ["BUC-101"]
      description: "heartbeat_interval に従い送出。ACK が返らなければ接続を破棄して再接続する"
    - id: "UC-103"
      name: "セッションを再開する"
      actors: ["ACTOR-005"]
      events: ["EVT-103"]
      traces_to: ["BUC-101"]
      description: "resume_gateway_url に session_id と最終 seq で RESUME。失敗時は再 IDENTIFY にフォールバック"
    - id: "UC-104"
      name: "指数バックオフで再接続する"
      actors: ["ACTOR-005"]
      events: ["EVT-103"]
      traces_to: ["BUC-101"]
      description: "ジッタ付き指数バックオフ。Invalid Session の resumable フラグで RESUME/IDENTIFY を切り替える"
    - id: "UC-105"
      name: "接続状態を照会する"
      actors: ["ACTOR-001", "ACTOR-002", "ACTOR-003"]
      screens: ["SCR-101"]
      traces_to: ["BUC-101"]
      description: "接続状態・レイテンシ・session_id・最終 seq・最終イベント受信時刻を Control Plane から参照する"
    - id: "UC-106"
      name: "Intent 設定を変更する"
      actors: ["ACTOR-003"]
      screens: ["SCR-102"]
      traces_to: ["BUC-102"]
      description: "有効化する Intent を選ぶ。変更は再接続を伴うため確認を挟む"
    - id: "UC-107"
      name: "必要 Intent の差分を算出する"
      actors: ["ACTOR-003"]
      screens: ["SCR-102"]
      traces_to: ["BUC-102"]
      description: "全チャプターの有効ルールから必要 Intent の和集合を求め、現在の設定との差分を提示する"
    - id: "UC-108"
      name: "ギルド/チャンネルのキャッシュを更新する"
      actors: ["ACTOR-005"]
      events: ["EVT-102", "EVT-105"]
      traces_to: ["BUC-101"]
      description: "READY / GUILD_CREATE / CHANNEL_* からギルドとチャンネルの一覧を保持し、ルール編集のセレクタに供給する"
  screens:
    - id: "SCR-101"
      name: "接続ステータス画面"
      description: "Gateway 接続の現在状態と直近の切断履歴"
      information: ["INFO-010"]
    - id: "SCR-102"
      name: "Intent 管理画面 (admin)"
      description: "有効 Intent の設定と、有効ルールから算出した必要 Intent の差分表示"
      information: ["INFO-011", "INFO-004"]
  events:
    - id: "EVT-101"
      name: "Gateway HELLO 受信"
      trigger: "WebSocket 接続確立直後に op 10 を受信"
      description: "heartbeat_interval が渡される。IDENTIFY または RESUME の起点"
    - id: "EVT-102"
      name: "Gateway Dispatch 受信"
      trigger: "op 0 の受信"
      description: "t にイベント名、d にペイロード、s にシーケンス番号。BIZ-004 の入力になる"
    - id: "EVT-103"
      name: "切断 / Reconnect / Invalid Session"
      trigger: "WebSocket クローズ、op 7、op 9 のいずれか"
      description: "再接続の起点。op 9 の d が resumable かで RESUME 可否が決まる"
    - id: "EVT-104"
      name: "ハートビート周期タイマー"
      trigger: "heartbeat_interval の経過"
      description: "op 1 を送出し op 11 の ACK を待つ"
    - id: "EVT-105"
      name: "READY 受信"
      trigger: "IDENTIFY 成功"
      description: "session_id と resume_gateway_url、初期ギルド一覧を得る"

system:
  information: ["INFO-002", "INFO-010", "INFO-011"]
  states: ["STATE-001"]
  conditions:
    - id: "COND-101"
      name: "紐付け済みギルドのイベントのみ処理する"
      description: "Bot が在籍していても、どのチャプターにも紐付いていないギルドのイベントは破棄する"
      traces_to: ["UC-108"]
    - id: "COND-102"
      name: "Intent 変更は再接続を要する"
      description: "Intent は IDENTIFY 時にのみ宣言できる。変更は必ずセッション再確立を伴う"
      traces_to: ["UC-106"]
    - id: "COND-103"
      name: "特権 Intent は Developer Portal 側の有効化が前提"
      description: "アプリ側で選択しても Portal で無効なら Used disallowed intents で接続が拒否される"
      traces_to: ["UC-106", "UC-107"]
  variations:
    - id: "VAR-101"
      name: "Gateway Intent"
      values: ["GUILDS", "GUILD_MEMBERS(特権)", "GUILD_MESSAGES", "MESSAGE_CONTENT(特権)", "GUILD_MESSAGE_REACTIONS", "GUILD_VOICE_STATES", "GUILD_SCHEDULED_EVENTS", "GUILD_MODERATION"]
      description: "IDENTIFY で宣言するビットフィールド。特権 Intent は Portal 側の有効化が別途必要"
      traces_to: ["UC-106", "UC-107"]
---

# BIZ-001 接続基盤運用

`discord-relay-gateway`（OCI）が専用 Bot トークンで Discord Gateway に単一セッションを張り、
紐付け済みギルドのイベントを受信し続ける。全チャプターがこの 1 本の接続に依存する。

## ビジネスコンテキスト図

```mermaid
graph LR
    ADM["ACTOR-003<br/>GDG 全体管理者"]
    GW["ACTOR-005<br/>Discord Gateway"]
    BIZ001["BIZ-001<br/>接続基盤運用"]
    BIZ002["BIZ-002<br/>サーバー登録"]
    BIZ003["BIZ-003<br/>転送ルール管理"]
    BIZ004["BIZ-004<br/>イベント配信"]
    BIZ005["BIZ-005<br/>可観測性"]

    ADM -->|Intent 設定| BIZ001
    GW -->|イベント push| BIZ001
    BIZ002 -->|紐付け済みギルド| BIZ001
    BIZ003 -->|必要 Intent の和集合| BIZ001
    BIZ001 -->|受信イベント| BIZ004
    BIZ001 -->|接続状態| BIZ005
    BIZ001 -->|ギルド/チャンネル一覧| BIZ003
```

## 業務フロー: BUC-101 Gateway 接続を維持する

```mermaid
sequenceDiagram
    participant DP as discord-relay-gateway
    participant GW as Discord Gateway
    participant CP as Control Plane

    DP->>GW: WebSocket 接続
    GW-->>DP: EVT-101 HELLO (heartbeat_interval)
    DP->>GW: UC-101 IDENTIFY (token, intents, shard)
    GW-->>DP: EVT-105 READY (session_id, resume_gateway_url)
    DP->>CP: UC-108 ギルド/チャンネル一覧を同期

    loop heartbeat_interval ごと
        DP->>GW: UC-102 op 1 Heartbeat (最終 seq)
        GW-->>DP: op 11 ACK
    end

    loop イベント受信中
        GW-->>DP: EVT-102 Dispatch (t, d, s)
        DP->>DP: seq を更新し BIZ-004 へ渡す
    end

    Note over DP,GW: 異常系
    GW--xDP: EVT-103 切断 / op 7 / op 9
    alt RESUME 可能
        DP->>GW: UC-103 resume_gateway_url へ RESUME
        GW-->>DP: RESUMED (欠落分を再送)
        Note over DP: 重複が起こり得るため<br/>Idempotency-Key で受信側が吸収
    else RESUME 不可 (Invalid Session)
        DP->>DP: UC-104 バックオフ待機
        DP->>GW: UC-101 IDENTIFY からやり直し
        Note over DP: 切断中のイベントは欠損する
    end
    DP->>CP: 接続状態を報告 (SCR-101 へ)
```

## ロバストネス図: UC-106 Intent 設定を変更する

```mermaid
flowchart LR
    ADM(["ACTOR-003<br/>GDG 全体管理者"])
    SCR102["SCR-102<br/>Intent 管理画面"]
    CTRL1["Intent 差分算出<br/>(UC-107)"]
    CTRL2["Intent 設定更新"]
    CTRL3["再接続の指示"]
    INFO011[("INFO-011<br/>IntentConfig")]
    INFO004[("INFO-004<br/>Rule")]
    DP["discord-relay-gateway"]

    ADM --- SCR102
    SCR102 --- CTRL1
    CTRL1 --- INFO004
    CTRL1 --- INFO011
    SCR102 --- CTRL2
    CTRL2 --- INFO011
    CTRL2 --- CTRL3
    CTRL3 --- DP

    classDef actor fill:#e8f0fe,stroke:#4285f4
    classDef boundary fill:#fef7e0,stroke:#fbbc04
    classDef control fill:#e6f4ea,stroke:#34a853
    classDef entity fill:#fce8e6,stroke:#ea4335
    class ADM actor
    class SCR102 boundary
    class CTRL1,CTRL2,CTRL3 control
    class INFO011,INFO004 entity
    class DP boundary
```

## 設計上の注意

- **単一障害点**: この 1 接続が全チャプターの生命線。切断継続は BIZ-005 のアラート対象（VAR-501）。
- **欠損は避けられない**: RESUME の範囲を超えた切断中のイベントは失われる。これは非目標であり、
  「接続している限り at-least-once」が本アプリの保証水準（GOAL-001 の但し書き）。
- **重複は起こる**: RESUME はイベントを再送する。受信側が吸収できるよう BIZ-004 が `Idempotency-Key` を付ける。
- **Intent は最小に保つ**: `TYPING_START` / `PRESENCE_UPDATE` は量が多く、購読するルールが無ければ
  そもそも Intent を有効にしない。これが最も効く負荷削減。
- **シャーディングは当面不要**: 単一シャードは 2500 ギルドまで対応する。ただし
  100 サーバー到達で Bot verification が必要（overview.md の SETUP-4）。
