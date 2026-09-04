---
type: rdra-context
id: "BIZ-004"
name: "event-delivery"
display_name: "イベント配信"

value:
  goals: ["GOAL-001", "GOAL-004"]
  requirements:
    - id: "REQ-401"
      description: "マッチしたイベントを、受信側が扱いやすく改ざん検知できる形で HTTP 配信すること"
      traces_to: ["GOAL-001"]
    - id: "REQ-402"
      description: "一時障害では失われず、恒久障害は隔離され、過負荷でも system が倒れないこと"
      traces_to: ["GOAL-004"]

environment:
  business_usecases:
    - id: "BUC-401"
      name: "受信イベントを配信先へ届ける"
      actors: ["ACTOR-005", "ACTOR-007"]
      description: "Gateway から受けたイベントをルールで評価し、正規化して配信先へ POST する"
      traces_to: ["REQ-401"]
    - id: "BUC-402"
      name: "失敗した配信を再試行し隔離する"
      actors: ["ACTOR-007"]
      description: "再試行可能な失敗はバックオフ再送、上限到達分は DLQ へ隔離する"
      traces_to: ["REQ-402"]

boundary:
  usecases:
    - id: "UC-401"
      name: "ルールを評価する"
      actors: ["ACTOR-005"]
      events: ["EVT-401"]
      traces_to: ["BUC-401"]
      description: "受信直後に有効ルールと突き合わせる。どのルールにもマッチしなければ即破棄する"
    - id: "UC-402"
      name: "正規化エンベロープに変換する"
      actors: []
      traces_to: ["BUC-401"]
      description: "共通メタ情報で包み、Discord の生ペイロードを raw として同梱する"
    - id: "UC-403"
      name: "永続キューに投入する"
      actors: []
      traces_to: ["BUC-401", "BUC-402"]
      description: "プロセス再起動でも失われないよう永続化してから配信に進む"
    - id: "UC-404"
      name: "HTTP POST で配信する"
      actors: ["ACTOR-007"]
      traces_to: ["BUC-401"]
      description: "並列実行数と宛先ごとのレート制限を守りながら送信する"
    - id: "UC-405"
      name: "署名を生成する"
      actors: []
      traces_to: ["BUC-401"]
      description: "timestamp を含めた HMAC-SHA256 を計算しヘッダに載せる"
    - id: "UC-406"
      name: "リトライをスケジュールする"
      actors: []
      events: ["EVT-402"]
      traces_to: ["BUC-402"]
      description: "再試行可能な失敗を指数バックオフで再投入する。429 は Retry-After に従う"
    - id: "UC-407"
      name: "DLQ に隔離する"
      actors: []
      traces_to: ["BUC-402"]
      description: "再試行上限到達、または再試行不能な失敗を隔離し可視化する"
    - id: "UC-408"
      name: "バックプレッシャでドロップする"
      actors: []
      traces_to: ["BUC-402"]
      description: "キュー上限超過時に古いものから破棄し、ドロップ件数を記録する"
  screens: []
  events:
    - id: "EVT-401"
      name: "Dispatch イベント受信"
      trigger: "BIZ-001 の EVT-102 から渡される"
      description: "配信パイプラインの入口"
    - id: "EVT-402"
      name: "リトライ時刻到来"
      trigger: "スケジュールされた再送時刻の経過"
      description: "再送の起点"

system:
  information: ["INFO-004", "INFO-005", "INFO-006", "INFO-007", "INFO-008", "INFO-009"]
  states: ["STATE-003"]
  conditions:
    - id: "COND-401"
      name: "いずれかの有効ルールにマッチすること"
      description: "Enabled 状態のルールのみ評価対象。Draft / Disabled / Suspended は無視する"
      traces_to: ["UC-401"]
    - id: "COND-402"
      name: "再試行可能な失敗であること"
      description: "5xx / 408 / 429 / ネットワークエラー / タイムアウトは再試行する。429 以外の 4xx は即 DLQ"
      traces_to: ["UC-406", "UC-407"]
    - id: "COND-403"
      name: "キュー残量が上限未満であること"
      description: "チャプターごとのキュー上限を超えたら新規投入を拒否しドロップする"
      traces_to: ["UC-403", "UC-408"]
    - id: "COND-404"
      name: "配信時にも SSRF ガードを再評価すること"
      description: "登録時に通った URL でも、配信時の DNS 解決結果が内部アドレスなら送信しない"
      traces_to: ["UC-404"]
  variations:
    - id: "VAR-401"
      name: "配信結果種別"
      values: ["成功 (2xx)", "再試行可能な失敗", "恒久失敗 (DLQ)", "ドロップ (バックプレッシャ)"]
      description: "配信試行の終端状態。メトリクスと履歴の分類軸になる"
      traces_to: ["UC-404", "UC-406", "UC-407", "UC-408"]
    - id: "VAR-402"
      name: "バックオフ間隔"
      values: ["1s", "5s", "30s", "2m", "10m", "30m"]
      description: "最大 6 回、累計約 45 分。429 は Retry-After を優先する"
      traces_to: ["UC-406"]
---

# BIZ-004 イベント配信

Gateway から受けたイベントをルールで評価し、正規化して配信先へ届ける。
本アプリで唯一、人が介在しない完全自動のコンテキスト。

## 正規化エンベロープ (UC-402)

```json
{
  "id": "01JBX8Z9K2M4N6P8Q0R2S4T6V8",
  "type": "discord.MESSAGE_CREATE",
  "occurred_at": "2026-09-03T12:34:56.789Z",
  "chapter": { "id": 12, "slug": "tokyo" },
  "guild":   { "id": "123456789012345678", "name": "GDG Tokyo" },
  "channel": { "id": "234567890123456789", "name": "general", "type": 0, "parent_id": null },
  "actor":   { "id": "345678901234567890", "username": "someone", "global_name": "Someone", "bot": false },
  "rule":    { "id": "rule_01JBX...", "name": "新規投稿を n8n へ" },
  "raw":     { "...Discord の d フィールドをそのまま..." }
}
```

共通メタで包みつつ `raw` に生データを同梱するため、受信側は用途に応じてどちらも使える。

## HTTP ヘッダ (UC-405)

| ヘッダ | 値 |
|---|---|
| `Content-Type` | `application/json` |
| `X-Discord-Relay-Event` | `MESSAGE_CREATE` |
| `X-Discord-Relay-Delivery-Id` | 配信試行ごとに一意な ID |
| `X-Discord-Relay-Timestamp` | Unix 秒 |
| `X-Discord-Relay-Signature` | `v1=<hex HMAC-SHA256(timestamp + "." + body)>` |
| `Idempotency-Key` | イベント一意キー (エンベロープの `id`) |
| `User-Agent` | `discord-relay/1.0` |

**timestamp を署名対象に含める**ことでリプレイ攻撃を防ぐ（Stripe と同じ方式）。
受信側は timestamp の鮮度を検査したうえで署名を検証する。

**`Idempotency-Key` は必須の設計要素**である。BIZ-001 の RESUME はイベントを再送するため、
同じイベントが 2 回配信され得る。受信側がこのキーで吸収できることを前提に、
本アプリは at-least-once に振り切る。

## 業務フロー: BUC-401 / BUC-402 受信から配信・再送・隔離まで

```mermaid
sequenceDiagram
    participant GW as ACTOR-005 Gateway
    participant EV as ルール評価
    participant Q as 永続キュー
    participant W as 配信ワーカー
    participant EP as ACTOR-007 配信先
    participant DLQ as DLQ

    GW-->>EV: EVT-401 Dispatch イベント
    EV->>EV: UC-401 有効ルールと突合 (COND-401)

    alt どのルールにもマッチしない
        EV->>EV: 即破棄
        Note over EV: 最大の負荷削減。<br/>キューに入れない
    else マッチした (複数可)
        loop マッチしたルールごと (fan-out)
            EV->>EV: UC-402 正規化エンベロープに変換
            alt COND-403 キュー残量あり
                EV->>Q: UC-403 投入 (Queued)
            else 上限超過
                EV->>EV: UC-408 古いものから破棄
                Note over EV: ドロップ件数を記録し<br/>BIZ-005 のメトリクスへ
            end
        end
    end

    Q->>W: 取り出し (InFlight)
    W->>W: UC-405 署名生成
    W->>W: COND-404 配信時 SSRF 再評価
    W->>EP: UC-404 HTTP POST

    alt 2xx
        EP-->>W: 成功
        W->>W: Delivered
    else COND-402 再試行可能 (5xx / 408 / 429 / ネットワーク)
        EP-->>W: 失敗
        alt 試行回数 < 上限
            W->>Q: UC-406 バックオフ後に再投入 (Retrying)
            Note over W,Q: VAR-402 1s→5s→30s→2m→10m→30m<br/>429 は Retry-After を優先
        else 上限到達
            W->>DLQ: UC-407 隔離 (DeadLettered)
        end
    else 再試行不能 (429 以外の 4xx)
        EP-->>W: 失敗
        W->>DLQ: UC-407 即隔離
        Note over DLQ: 設定ミスの可能性が高く<br/>再送しても無駄
    end

    W->>W: 配信履歴を記録 (BIZ-005 へ)
```

## ロバストネス図: UC-401 ルールを評価する

```mermaid
flowchart LR
    GW(["ACTOR-005<br/>Discord Gateway"])
    EVT401["EVT-401<br/>Dispatch 受信"]
    C1["有効ルール抽出<br/>COND-401"]
    C2["フィルタ評価"]
    C3["fan-out 展開"]
    C4["正規化 UC-402"]
    C5["キュー投入 UC-403"]
    INFO004[("INFO-004<br/>Rule")]
    INFO007[("INFO-007<br/>ReceivedEvent")]
    INFO008[("INFO-008<br/>DeliveryAttempt")]

    GW --- EVT401
    EVT401 --- C1
    C1 --- INFO004
    C1 --- C2
    C2 --- C3
    C3 --- C4
    C4 --- INFO007
    C4 --- C5
    C5 --- INFO008

    classDef actor fill:#e8f0fe,stroke:#4285f4
    classDef boundary fill:#fef7e0,stroke:#fbbc04
    classDef control fill:#e6f4ea,stroke:#34a853
    classDef entity fill:#fce8e6,stroke:#ea4335
    class GW actor
    class EVT401 boundary
    class C1,C2,C3,C4,C5 control
    class INFO004,INFO007,INFO008 entity
```

## 設計上の注意

- **評価は受信直後、キュー投入の前**（UC-401 → UC-403 の順序）。
  購読者のいないイベントをキューに入れないことが、最も効く負荷対策。
  さらに上流では BIZ-001 が「必要な Intent しか有効にしない」ことで受信自体を絞る。
- **順序は保証しない**（非目標）。並列配信するため、同一チャンネルの 2 件が入れ替わり得る。
  必要になったらチャンネル単位の順序保証モードを後付けする設計余地を残す。
- **配信時にも SSRF ガードを回す（COND-404）**。登録時のみの検証は DNS 再バインドで破られる。
- **4xx を再試行しない理由**: 設定ミス（URL 誤り、認証ヘッダ不足）が原因である可能性が高く、
  再送しても成功しない。早く DLQ に出して organizer に気づかせるほうが価値がある。
- **ドロップは黙って行わない**。件数を必ず記録し、BIZ-005 のメトリクスとアラートに出す。
