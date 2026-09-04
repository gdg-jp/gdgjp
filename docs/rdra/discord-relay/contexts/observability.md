---
type: rdra-context
id: "BIZ-005"
name: "observability"
display_name: "可観測性・障害対応"

value:
  goals: ["GOAL-004", "GOAL-005"]
  requirements:
    - id: "REQ-501"
      description: "配信の成否を後から確認でき、失敗したものを再送できること"
      traces_to: ["GOAL-004"]
    - id: "REQ-502"
      description: "接続と配信の異常が、人が見に行かなくても検知されること"
      traces_to: ["GOAL-005"]
    - id: "REQ-503"
      description: "ルールが意図通りにマッチしない理由を、設定者が自力で特定できること"
      traces_to: ["GOAL-004"]

environment:
  business_usecases:
    - id: "BUC-501"
      name: "配信状況を確認する"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "何が届き、何が失敗したかを一覧し、必要なら再送する"
      traces_to: ["REQ-501"]
    - id: "BUC-502"
      name: "障害を検知して対処する"
      actors: ["ACTOR-001", "ACTOR-003"]
      description: "接続断や DLQ 増加をアラートで受け取り、原因を切り分ける"
      traces_to: ["REQ-502"]
    - id: "BUC-503"
      name: "ルールの挙動をデバッグする"
      actors: ["ACTOR-001"]
      description: "受信中のイベントを見ながら、なぜマッチしたか・しなかったかを確かめる"
      traces_to: ["REQ-503"]

boundary:
  usecases:
    - id: "UC-501"
      name: "ライブイベントを閲覧する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-501"]
      traces_to: ["BUC-503"]
      description: "自チャプターのギルドで受信中のイベントを tail し、マッチしたルールと非マッチ理由を併記する"
    - id: "UC-502"
      name: "配信履歴を検索する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-502"]
      traces_to: ["BUC-501"]
      description: "ルール・期間・結果種別で絞り込み、リクエストとレスポンスを確認する"
    - id: "UC-503"
      name: "失敗と DLQ を一覧する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-503"]
      traces_to: ["BUC-501"]
      description: "隔離された配信を件数と理由の内訳で見る"
    - id: "UC-504"
      name: "手動で再送する"
      actors: ["ACTOR-001"]
      screens: ["SCR-503"]
      traces_to: ["BUC-501"]
      description: "DLQ・失敗分を個別または一括で再投入する。organizer のみ"
    - id: "UC-505"
      name: "メトリクスを閲覧する"
      actors: ["ACTOR-001", "ACTOR-002", "ACTOR-003"]
      screens: ["SCR-504"]
      traces_to: ["BUC-501", "BUC-502"]
      description: "受信・マッチ・配信成功/失敗・レイテンシ・ドロップを時系列で見る"
    - id: "UC-506"
      name: "アラートを受け取る"
      actors: ["ACTOR-001", "ACTOR-003"]
      events: ["EVT-501"]
      traces_to: ["BUC-502"]
      description: "閾値超過を通知する。宛先はチャプター organizer と admin"
    - id: "UC-507"
      name: "監査ログを閲覧する"
      actors: ["ACTOR-001", "ACTOR-003"]
      screens: ["SCR-505"]
      traces_to: ["BUC-502"]
      description: "設定変更・紐付け操作・シークレット更新・手動再送の記録を追う"
    - id: "UC-508"
      name: "保持期間を過ぎたログを削除する"
      actors: []
      events: ["EVT-502"]
      traces_to: ["BUC-501"]
      description: "配信履歴とペイロードを保持期間に従って削除する"
  screens:
    - id: "SCR-501"
      name: "ライブイベントビューア"
      description: "受信イベントの tail。マッチしたルールと非マッチ理由を併記する"
      information: ["INFO-007", "INFO-004"]
    - id: "SCR-502"
      name: "配信履歴画面"
      description: "配信試行の一覧と詳細 (リクエスト/レスポンス/所要時間/試行回数)"
      information: ["INFO-008"]
    - id: "SCR-503"
      name: "DLQ 一覧画面"
      description: "隔離された配信と再送操作"
      information: ["INFO-009"]
    - id: "SCR-504"
      name: "メトリクスダッシュボード"
      description: "受信/マッチ/成功/失敗/ドロップとレイテンシ"
      information: ["INFO-008", "INFO-010"]
    - id: "SCR-505"
      name: "監査ログ画面"
      description: "誰がいつ何を変えたか"
      information: ["INFO-012"]
  events:
    - id: "EVT-501"
      name: "アラート閾値超過"
      trigger: "接続断の継続、DLQ 件数の増加、特定ルールの連続失敗"
      description: "通知の起点"
    - id: "EVT-502"
      name: "保持期間経過"
      trigger: "定期バッチ"
      description: "配信履歴とペイロードの削除"

system:
  information: ["INFO-004", "INFO-007", "INFO-008", "INFO-009", "INFO-010", "INFO-012"]
  states: ["STATE-003"]
  conditions:
    - id: "COND-501"
      name: "手動再送は organizer のみ"
      description: "再送は外部へ実際に POST する副作用があるため member には許さない"
      traces_to: ["UC-504"]
    - id: "COND-502"
      name: "閲覧は自チャプター分に限る"
      description: "ライブビューア・履歴・DLQ はすべてチャプターで絞る。admin のみ横断可"
      traces_to: ["UC-501", "UC-502", "UC-503", "UC-505"]
    - id: "COND-503"
      name: "ペイロード非保存ルールでは本文を残さない"
      description: "ルール単位でペイロード保存をオプトアウトできる。その場合メタ情報のみ記録する"
      traces_to: ["UC-502", "UC-508"]
  variations:
    - id: "VAR-501"
      name: "アラート種別"
      values: ["Gateway 切断の継続", "DLQ 件数の増加", "特定ルールの連続失敗", "ドロップ発生"]
      description: "検知対象。宛先と緊急度が種別ごとに異なる"
      traces_to: ["UC-506"]
    - id: "VAR-502"
      name: "ログ保持期間"
      values: ["7 日", "30 日", "90 日"]
      description: "チャプターまたはルール単位で設定する。既定は 30 日"
      traces_to: ["UC-508"]
---

# BIZ-005 可観測性・障害対応

配信は人の目に触れない場所で起きるため、「動いているか」「なぜ動かないか」が
見えることそのものが機能になる。

## 中核はライブイベントビューア (UC-501)

設定のデバッグで最も困るのは「ルールを作ったのにイベントが来ない」状況で、原因が
Intent 未有効・フィルタの絞りすぎ・ギルド未紐付け・Bot 権限不足のどれかを切り分けられない点にある。

ライブビューアは受信イベントを tail しながら、各イベントについて
**どのルールにマッチしたか / しなかった場合はどの条件で落ちたか**を併記する。
これにより上記の切り分けが画面内で完結する。

## ビジネスコンテキスト図

```mermaid
graph LR
    ORG["ACTOR-001<br/>organizer"]
    MEM["ACTOR-002<br/>member"]
    ADM["ACTOR-003<br/>admin"]
    BIZ001["BIZ-001<br/>接続基盤運用"]
    BIZ004["BIZ-004<br/>イベント配信"]
    BIZ005["BIZ-005<br/>可観測性"]
    BIZ003["BIZ-003<br/>転送ルール管理"]
    BIZ002["BIZ-002<br/>サーバー登録"]

    BIZ001 -->|接続状態・受信イベント| BIZ005
    BIZ004 -->|配信結果・DLQ・ドロップ| BIZ005
    BIZ002 -->|紐付け状態の変化| BIZ005
    BIZ005 -->|再送| BIZ004
    BIZ005 -->|ギルド離脱によるルール停止| BIZ003
    BIZ005 -->|閲覧・再送| ORG
    BIZ005 -->|閲覧| MEM
    BIZ005 -->|横断閲覧・アラート| ADM
```

## 業務フロー: BUC-502 障害を検知して対処する

```mermaid
sequenceDiagram
    participant DP as Data Plane
    participant CP as Control Plane
    actor ORG as ACTOR-001 organizer
    actor ADM as ACTOR-003 admin

    Note over DP: 異常の発生
    alt Gateway 切断が継続
        DP->>CP: 接続状態を報告 (Disconnected が閾値超過)
        CP->>ADM: EVT-501 UC-506 アラート (全チャプター影響)
        ADM->>CP: SCR-101 接続状態を確認
        Note over ADM: 単一障害点のため<br/>admin が一次対応
    else DLQ が増加
        CP->>CP: DLQ の滞留を検知 (Queues DLQ + D1)
        CP->>ORG: EVT-501 UC-506 アラート (該当チャプター)
        ORG->>CP: SCR-503 DLQ を確認
        ORG->>CP: 原因を特定 (4xx なら設定ミス)
        ORG->>CP: BIZ-003 で配信先を修正
        ORG->>CP: UC-504 手動再送 (COND-501)
        CP->>CP: D1 の記録から再 enqueue (DP を経由しない)
    else 特定ルールが連続失敗
        CP->>CP: ルール単位の失敗率を集計
        CP->>ORG: EVT-501 UC-506 アラート
        ORG->>CP: SCR-502 履歴でレスポンス本文を確認
    end
```

## ロバストネス図: UC-504 手動で再送する

```mermaid
flowchart LR
    ORG(["ACTOR-001<br/>organizer"])
    SCR503["SCR-503<br/>DLQ 一覧画面"]
    C1["organizer 検証<br/>COND-501"]
    C2["チャプター境界検証<br/>COND-502"]
    C3["再投入"]
    C4["監査記録"]
    INFO009[("INFO-009<br/>DeadLetter")]
    INFO008[("INFO-008<br/>DeliveryAttempt")]
    INFO012[("INFO-012<br/>AuditLog")]

    ORG --- SCR503
    SCR503 --- C1
    C1 --- C2
    C2 --- INFO009
    C2 --- C3
    C3 --- INFO008
    C3 --- C4
    C4 --- INFO012

    classDef actor fill:#e8f0fe,stroke:#4285f4
    classDef boundary fill:#fef7e0,stroke:#fbbc04
    classDef control fill:#e6f4ea,stroke:#34a853
    classDef entity fill:#fce8e6,stroke:#ea4335
    class ORG actor
    class SCR503 boundary
    class C1,C2,C3,C4 control
    class INFO009,INFO008,INFO012 entity
```

## プライバシー上の扱い

配信履歴には**メンバーのメッセージ本文が含まれ得る**。

- 既定では member も自チャプター分の履歴を閲覧できる。チャプターの Discord の内容は
  そのチャプターのメンバーが見られて自然である、という判断による。
- ただし**ルール単位で「ペイロードを保存しない」オプション**を用意する（COND-503）。
  この場合、メタ情報（イベント種別・時刻・結果）のみを記録し本文は残さない。
- 保持期間（VAR-502）を過ぎたペイロードは UC-508 で削除する。
- admin の横断閲覧は必ず監査ログに残す（BIZ-006 COND-603）。

## 設計上の注意

- **メトリクスはチャプター別とグローバルの両方**を持つ。organizer は自分の影響範囲を、
  admin は接続の健全性を見る。
- **Gateway 切断アラートの宛先は admin**。単一接続が全チャプターの単一障害点であり、
  個々の organizer には対処できない。
- **DLQ アラートの宛先は該当チャプターの organizer**。設定ミスが原因のことが多く、
  直せるのは organizer だけ。
