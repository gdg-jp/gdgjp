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
      description: "Data Plane が転送したイベントを Control Plane がルールで評価し、正規化して配信先へ POST する"
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
      description: "Control Plane が tick で受けたイベントを有効ルールと突き合わせる。どのルールにもマッチしなければ即破棄する"
    - id: "UC-402"
      name: "正規化エンベロープに変換する"
      actors: []
      traces_to: ["BUC-401"]
      description: "共通メタ情報で包み、Discord の生ペイロードを raw として同梱する。Control Plane が行う"
    - id: "UC-403"
      name: "永続キューに投入する"
      actors: []
      traces_to: ["BUC-401", "BUC-402"]
      description: "Cloudflare Queues に投入する。tick に 200 を返す前に投入を完了させ、Data Plane がバッファを削れる状態にする"
    - id: "UC-404"
      name: "HTTP POST で配信する"
      actors: ["ACTOR-007"]
      traces_to: ["BUC-401"]
      description: "Queues の consumer が Control Plane から送信する。宛先ごとのレート制限は 429 の Retry-After 尊重による best-effort"
    - id: "UC-405"
      name: "署名を生成する"
      actors: []
      traces_to: ["BUC-401"]
      description: "timestamp を含めた HMAC-SHA256 を計算しヘッダに載せる。署名シークレットは Control Plane を出ない"
    - id: "UC-406"
      name: "リトライをスケジュールする"
      actors: []
      events: ["EVT-402"]
      traces_to: ["BUC-402"]
      description: "message.retry({ delaySeconds }) で段ごとに間隔を指定する。429 は Retry-After がこれを上書きする"
    - id: "UC-407"
      name: "DLQ に隔離する"
      actors: []
      traces_to: ["BUC-402"]
      description: "再試行上限到達、または再試行不能な失敗を Queues の dead_letter_queue へ送り、D1 に記録して可視化する"
    - id: "UC-408"
      name: "バックプレッシャでドロップする"
      actors: []
      traces_to: ["BUC-402"]
      description: "Data Plane の転送バッファ上限と Control Plane のキュー上限の 2 段で、古いものから破棄し件数を記録する"
  screens: []
  events:
    - id: "EVT-401"
      name: "Dispatch イベント受信"
      trigger: "BIZ-001 の EVT-102 を Data Plane が粗くフィルタし、tick で Control Plane に転送する"
      description: "配信パイプラインの入口"
    - id: "EVT-402"
      name: "リトライ時刻到来"
      trigger: "Queues が delaySeconds の経過後にメッセージを再配布する"
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
      description: "Data Plane の転送バッファ上限と Control Plane のキュー上限の両方に適用する。どちらかを超えたら受け入れずドロップする"
      traces_to: ["UC-403", "UC-408"]
    - id: "COND-404"
      name: "配信時にも SSRF ガードを再評価すること"
      description: "登録時に通った URL でも、配信時の DNS 解決結果が内部アドレスなら送信しない。配信が Control Plane に移った後も多層防御として維持する"
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
      description: "最大 6 回、累計約 45 分。429 は Retry-After を優先する。Queues の max_retries = 6 に対応する"
      traces_to: ["UC-406"]
---

# BIZ-004 イベント配信

Data Plane が転送したイベントを Control Plane がルールで評価し、正規化して配信先へ届ける。
本アプリで唯一、人が介在しない完全自動のコンテキスト。

## Plane 担当

[ADR-001](../../../discord-relay/adr.md#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる)
により、**このコンテキストのほぼ全体が Control Plane で動く**。

| 担当 | 内容 |
|---|---|
| Data Plane (OCI) | 粗いフィルタ（登録ギルド + 購読イベント種別）、転送バッファ、tick での転送、UC-408 の 1 段目 |
| Control Plane (Workers) | UC-401 〜 UC-407 のすべて、UC-408 の 2 段目 |

Data Plane は配信先 URL・署名シークレット・カスタムヘッダ・細かいフィルタを一切持たない。

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

`chapter` が入るのは Control Plane で正規化するからである。Data Plane はチャプターを知らない。

## HTTP ヘッダ (UC-405)

| ヘッダ | 値 |
|---|---|
| `Content-Type` | `application/json` |
| `X-Discord-Relay-Event` | `MESSAGE_CREATE` |
| `X-Discord-Relay-Delivery-Id` | 配信試行ごとに一意な ID（リトライで変わる） |
| `X-Discord-Relay-Timestamp` | Unix 秒 |
| `X-Discord-Relay-Signature` | `v1=<hex HMAC-SHA256(timestamp + "." + body)>` |
| `Idempotency-Key` | エンベロープの `id`（リトライでも RESUME 再配送でも変わらない） |
| `User-Agent` | `discord-relay/1.0` |

**timestamp を署名対象に含める**ことでリプレイ攻撃を防ぐ（Stripe と同じ方式）。
受信側は timestamp の鮮度を検査したうえで署名を検証する。

## エンベロープ `id` は決定的でなければならない

**`Idempotency-Key` が必要な理由は RESUME にある。** BIZ-001 の RESUME は切断中のイベントを
再送するため、同じ Discord イベントが 2 回パイプラインに入り得る。受信側がこのキーで
吸収できることを前提に、本アプリは at-least-once に振り切る。

したがって **`id` をランダムに採番してはならない**。同じイベント × 同じルールなら、
何度パイプラインを通っても同じ値でなければキーの意味がない
（[ADR-004](../../../discord-relay/adr.md#adr-004-tick-エンドポイント-1-本に-heartbeatコマンドconfig-バージョンを相乗りさせる)）。

| 識別子 | 生成 | 用途 |
|---|---|---|
| `event_id` | Data Plane が受信時に ULID を採番 | 転送リトライの冪等キー、順序、tick の `ack_through` |
| `dedupe_key` | `sha256(event_type ‖ canonical_json(d))` | RESUME 再配送の同一性判定 |
| エンベロープ `id` | `sha256(dedupe_key ‖ rule_id)` を ULID 形式に整形 | `Idempotency-Key` |

`canonical_json` はキーを再帰的にソートし空白を除いたもの。Discord が再配送時にフィールドを
変えないことに依存する best-effort であり、**完全な重複排除を保証するものではない**。
`Idempotency-Key` は受信側の冪等性を助けるためのもので、本アプリが exactly-once を
主張するものではない。

## 業務フロー: BUC-401 / BUC-402 受信から配信・再送・隔離まで

```mermaid
sequenceDiagram
    participant GW as ACTOR-005 Gateway
    participant DP as Data Plane (OCI)
    participant CP as Control Plane (Worker)
    participant Q as Cloudflare Queues
    participant W as consumer
    participant EP as ACTOR-007 配信先
    participant DLQ as DLQ

    GW-->>DP: Dispatch イベント
    DP->>DP: 粗いフィルタ<br/>(登録ギルド + 購読種別)

    alt 購読仕様に該当しない
        DP->>DP: 即破棄
        Note over DP: 秘匿値を持たない DP でも<br/>ここまでは判定できる
    else 該当する
        DP->>DP: event_id / dedupe_key を採番しバッファへ
        alt COND-403 バッファ残量あり
            DP->>CP: EVT-401 tick で転送
        else 上限超過
            DP->>DP: UC-408 (1 段目) 古いものから破棄
        end
    end

    CP->>CP: UC-401 有効ルールと突合 (COND-401)

    alt どのルールにもマッチしない
        CP->>CP: 即破棄
    else マッチした (複数可)
        loop マッチしたルールごと (fan-out)
            CP->>CP: UC-402 正規化エンベロープに変換
            alt COND-403 キュー残量あり
                CP->>Q: UC-403 投入 (Queued)
            else 上限超過
                CP->>CP: UC-408 (2 段目) 破棄し件数を記録
            end
        end
    end
    CP-->>DP: 200 + ack_through
    Note over DP,CP: 投入完了後に 200 を返す。<br/>DP はここで初めてバッファを削る

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
            W->>Q: UC-406 message.retry({delaySeconds})
            Note over W,Q: VAR-402 1s→5s→30s→2m→10m→30m<br/>429 は Retry-After を優先
        else 上限到達
            W->>DLQ: UC-407 隔離 (DeadLettered)
        end
    else 再試行不能 (429 以外の 4xx)
        EP-->>W: 失敗
        W->>DLQ: UC-407 即隔離
        Note over DLQ: 設定ミスの可能性が高く<br/>再送しても無駄
    end

    W->>W: 配信履歴を D1 に記録 (BIZ-005 へ)
```

## ロバストネス図: UC-401 ルールを評価する

```mermaid
flowchart LR
    DP(["Data Plane<br/>(ACTOR-005 由来)"])
    EVT401["EVT-401<br/>tick で受信"]
    C0["購読仕様の照合<br/>(偽テレメトリ防御)"]
    C1["有効ルール抽出<br/>COND-401"]
    C2["フィルタ評価"]
    C3["fan-out 展開"]
    C4["正規化 UC-402"]
    C5["キュー投入 UC-403"]
    INFO004[("INFO-004<br/>Rule")]
    INFO007[("INFO-007<br/>ReceivedEvent")]
    INFO008[("INFO-008<br/>DeliveryAttempt")]

    DP --- EVT401
    EVT401 --- C0
    C0 --- C1
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
    class DP actor
    class EVT401 boundary
    class C0,C1,C2,C3,C4,C5 control
    class INFO004,INFO007,INFO008 entity
```

## 設計上の注意

- **絞り込みは 2 段になった。** 1 段目は Data Plane の粗いフィルタ（ギルド + イベント種別）で、
  ネットワークを渡る量を決める。2 段目は Control Plane のルール評価で、キューに入る量を決める。
  RDRA が当初から挙げていた「購読者のいないイベントをキューに入れない」という負荷対策は、
  2 段目としてそのまま生きている。さらに上流では BIZ-001 が
  「必要な Intent しか有効にしない」ことで受信自体を絞る。
- **tick に 200 を返す前にキュー投入を完了させる。** これを守らないと、
  Data Plane が「送った」と判断してバッファを削った直後にイベントが消える。
- **順序は保証しない**（非目標）。並列配信するため、同一チャンネルの 2 件が入れ替わり得る。
  Queues も宛先キーごとの順序を持たない。必要になったらチャンネル単位の
  順序保証モードを後付けする設計余地を残す。
- **宛先ごとのレート制限は best-effort**（UC-404）。Queues に同時実行の宛先別制御が無いため、
  当面は 429 の `Retry-After` 尊重で凌ぐ。必要になったら宛先ごとの Durable Object を挟む。
- **配信時にも SSRF ガードを回す（COND-404）。** 配信が Control Plane に移り危険度は下がったが、
  Cloudflare がプライベート宛先への到達不能をセキュリティ保証として文書化しているわけではない。
- **4xx を再試行しない理由**: 設定ミス（URL 誤り、認証ヘッダ不足）が原因である可能性が高く、
  再送しても成功しない。早く DLQ に出して organizer に気づかせるほうが価値がある。
- **ドロップは黙って行わない**。2 段のどちらで捨てたかを区別して記録し、
  BIZ-005 のメトリクスとアラートに出す。Data Plane 側の件数は tick の `dropped_total` で報告する。
- **Control Plane が落ちると配信が止まる。** Data Plane は受信とバッファリングを続けるので、
  バッファ上限に達するまでは復旧後に流れる。「CP 障害が何分続いたら失い始めるか」は
  バッファ上限とイベント流量で決まる設計パラメータであり、監視対象になる。
