---
type: rdra-context
id: "BIZ-003"
name: "rule-management"
display_name: "転送ルール管理"

value:
  goals: ["GOAL-002", "GOAL-003"]
  requirements:
    - id: "REQ-301"
      description: "どのイベントをどこへ流すかを、コードを書かずに画面から管理できること"
      traces_to: ["GOAL-002"]
    - id: "REQ-302"
      description: "本番配信を始める前にルールの動作を検証できること"
      traces_to: ["GOAL-002"]
    - id: "REQ-303"
      description: "配信先 URL と署名シークレットが閲覧権限に応じて保護されること"
      traces_to: ["GOAL-003"]

environment:
  business_usecases:
    - id: "BUC-301"
      name: "転送ルールを作成・変更する"
      actors: ["ACTOR-001"]
      description: "organizer が対象イベント・フィルタ・配信先を組み合わせてルールを作り、有効化する"
      traces_to: ["REQ-301", "REQ-303"]
    - id: "BUC-302"
      name: "ルールの動作を検証する"
      actors: ["ACTOR-001"]
      description: "有効化の前にテスト配信とドライランで、意図通りにマッチし届くかを確かめる"
      traces_to: ["REQ-302"]
    - id: "BUC-303"
      name: "ルールを閲覧する"
      actors: ["ACTOR-002"]
      description: "member が自チャプターのルール構成を確認する。編集はできない"
      traces_to: ["REQ-301", "REQ-303"]

boundary:
  usecases:
    - id: "UC-301"
      name: "ルールを作成する"
      actors: ["ACTOR-001"]
      screens: ["SCR-301"]
      traces_to: ["BUC-301"]
      description: "名前・対象イベント・フィルタ・配信先を指定して新規ルールを作る。初期状態は Draft"
    - id: "UC-302"
      name: "ルールを編集する"
      actors: ["ACTOR-001"]
      screens: ["SCR-301"]
      traces_to: ["BUC-301"]
      description: "既存ルールの構成を変更する。変更は設定バージョンを進める。Data Plane に伝わるのは対象イベント種別とギルドだけで、フィルタと配信先は Control Plane に留まる"
    - id: "UC-303"
      name: "ルールを有効化・無効化する"
      actors: ["ACTOR-001"]
      screens: ["SCR-305"]
      traces_to: ["BUC-301"]
      description: "Enabled / Disabled を切り替える。Suspended からの復帰もここで行う"
    - id: "UC-304"
      name: "ルールを削除する"
      actors: ["ACTOR-001"]
      screens: ["SCR-305"]
      traces_to: ["BUC-301"]
      description: "ルールを削除する。配信履歴は保持期間まで残す"
    - id: "UC-305"
      name: "対象イベントを選ぶ"
      actors: ["ACTOR-001"]
      screens: ["SCR-302"]
      traces_to: ["BUC-301"]
      description: "イベントカタログから選択する。各イベントに必要な Intent と、それが有効かを併記する"
    - id: "UC-306"
      name: "フィルタを設定する"
      actors: ["ACTOR-001"]
      screens: ["SCR-301"]
      traces_to: ["BUC-301"]
      description: "ギルド・チャンネル・ユーザー・Bot 発言の除外・ロールを組み合わせる"
    - id: "UC-307"
      name: "配信先を登録する"
      actors: ["ACTOR-001"]
      screens: ["SCR-303"]
      traces_to: ["BUC-301", "REQ-303"]
      description: "URL・カスタムヘッダ・タイムアウトを登録する。URL は SSRF ガードを通す"
    - id: "UC-308"
      name: "署名シークレットをローテーションする"
      actors: ["ACTOR-001"]
      screens: ["SCR-303"]
      traces_to: ["BUC-301", "REQ-303"]
      description: "新しいシークレットを生成する。平文表示は生成直後の一度だけ"
    - id: "UC-309"
      name: "テスト配信する"
      actors: ["ACTOR-001"]
      screens: ["SCR-304"]
      traces_to: ["BUC-302"]
      description: "サンプルペイロードまたは直近の実イベントを選んで即時配信し、応答を表示する"
    - id: "UC-310"
      name: "ドライランする"
      actors: ["ACTOR-001"]
      screens: ["SCR-304"]
      traces_to: ["BUC-302"]
      description: "有効化せずに、直近 N 件の受信イベントのうち何件がマッチするかを確認する"
    - id: "UC-311"
      name: "ルール一覧を閲覧する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-305"]
      traces_to: ["BUC-303"]
      description: "自チャプターのルールと状態を一覧する。member は秘匿情報がマスクされた状態で見る"
  screens:
    - id: "SCR-301"
      name: "ルール編集画面"
      description: "名前・対象イベント・フィルタ・配信先の指定。対象イベントの変更が Data Plane の購読仕様に反映されるまでの待ち状態を表示する"
      information: ["INFO-004", "INFO-002"]
    - id: "SCR-302"
      name: "イベント選択画面"
      description: "イベントカタログ。必要 Intent とその有効/無効を併記する"
      information: ["INFO-011"]
    - id: "SCR-303"
      name: "配信先編集画面"
      description: "URL・ヘッダ・タイムアウト・署名シークレット"
      information: ["INFO-005"]
    - id: "SCR-304"
      name: "テスト配信・ドライラン画面"
      description: "サンプル送信の結果とマッチ件数"
      information: ["INFO-004", "INFO-007", "INFO-008"]
    - id: "SCR-305"
      name: "ルール一覧画面"
      description: "ルールと状態の一覧。有効化・無効化・削除の起点。Data Plane への購読仕様の反映が保留中であることを併記する"
      information: ["INFO-004"]

system:
  information: ["INFO-001", "INFO-002", "INFO-004", "INFO-005", "INFO-006", "INFO-011"]
  states: ["STATE-004"]
  conditions:
    - id: "COND-301"
      name: "編集系の操作は organizer のみ"
      description: "作成・編集・有効化・削除・配信先変更・シークレットローテーションはすべて organizer に限る"
      traces_to: ["UC-301", "UC-302", "UC-303", "UC-304", "UC-307", "UC-308"]
    - id: "COND-302"
      name: "配信先 URL が SSRF ガードを通過すること"
      description: "プライベート・リンクローカル・ループバック宛を拒否する。配信は Control Plane から出るため多層防御の 1 枚目という位置づけ (ADR-001)"
      traces_to: ["UC-307"]
    - id: "COND-303"
      name: "選択イベントに必要な Intent が有効であること"
      description: "無効な Intent を要するイベントは選べるが、警告を出し、有効化されるまで実際には届かない旨を明示する"
      traces_to: ["UC-305", "UC-303"]
    - id: "COND-304"
      name: "選択できるギルドは自チャプター紐付け分のみ"
      description: "フィルタのギルド候補は BIZ-002 で Claimed 状態のものに限定する"
      traces_to: ["UC-306"]
  variations:
    - id: "VAR-301"
      name: "対象イベント種別"
      values: ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_REACTION_ADD", "GUILD_MEMBER_ADD", "GUILD_MEMBER_REMOVE", "GUILD_SCHEDULED_EVENT_CREATE", "VOICE_STATE_UPDATE", "CHANNEL_CREATE", "THREAD_CREATE"]
      description: "Gateway の Dispatch イベント名。それぞれ必要 Intent が対応する"
      traces_to: ["UC-305"]
    - id: "VAR-302"
      name: "フィルタ種別"
      values: ["ギルド", "チャンネル (スレッド含む/含まない)", "ユーザー", "Bot 発言の除外", "ロール"]
      description: "基本フィルタのみ。正規表現と式言語は非目標"
      traces_to: ["UC-306"]
    - id: "VAR-303"
      name: "秘匿情報の可視レベル"
      values: ["organizer: URL 全体を表示", "member: ホスト名とパス先頭のみ", "シークレット: 生成直後のみ平文、以降は常時マスク"]
      description: "閲覧者のロールにより配信先情報の見え方が変わる"
      traces_to: ["UC-311", "UC-307", "UC-308"]
---

# BIZ-003 転送ルール管理

「どのイベントをどこへ流すか」を画面から管理する。本アプリの主要な価値提供面。

## ルールの構成

```
ルール (INFO-004)
  ├─ 名前 / 状態 (Draft | Enabled | Disabled | Suspended)
  ├─ 所属チャプター
  ├─ 対象イベント種別 (VAR-301, 複数選択)
  ├─ フィルタ (VAR-302)
  │    ├─ ギルド        … COND-304 自チャプター紐付け分のみ
  │    ├─ チャンネル     … スレッドを含むかを選択
  │    ├─ ユーザー
  │    ├─ Bot 発言の除外
  │    └─ ロール
  └─ 配信先 (INFO-005)
       ├─ URL           … COND-302 SSRF ガード
       ├─ カスタムヘッダ
       ├─ タイムアウト
       └─ 署名シークレット … VAR-303 マスキング
```

複数のルールが同じイベントにマッチした場合、**優先順位は設けず、それぞれ独立に配信する**（fan-out）。

## ビジネスコンテキスト図

```mermaid
graph LR
    ORG["ACTOR-001<br/>organizer"]
    MEM["ACTOR-002<br/>member"]
    BIZ006["BIZ-006<br/>認証・認可"]
    BIZ002["BIZ-002<br/>サーバー登録"]
    BIZ003["BIZ-003<br/>転送ルール管理"]
    BIZ001["BIZ-001<br/>接続基盤運用"]
    BIZ004["BIZ-004<br/>イベント配信"]
    BIZ005["BIZ-005<br/>可観測性"]

    ORG -->|作成・編集・検証| BIZ003
    MEM -->|閲覧| BIZ003
    BIZ006 -->|チャプターとロール| BIZ003
    BIZ002 -->|選択可能なギルド| BIZ003
    BIZ001 -->|チャンネル一覧・Intent 状態| BIZ003
    BIZ003 -->|必要 Intent の和集合| BIZ001
    BIZ003 -->|評価対象ルール| BIZ004
    BIZ005 -->|ギルド離脱による自動停止| BIZ003
```

## 業務フロー: BUC-301 / BUC-302 ルールを作って検証し、有効化する

```mermaid
sequenceDiagram
    actor ORG as ACTOR-001 organizer
    participant CP as Control Plane
    participant DP as Data Plane
    participant EP as ACTOR-007 配信先

    ORG->>CP: SCR-301 ルールを新規作成
    CP->>CP: COND-301 organizer か検証
    ORG->>CP: UC-305 対象イベントを選択
    CP-->>ORG: COND-303 必要な Intent と有効/無効を提示
    ORG->>CP: UC-306 フィルタを設定
    CP-->>ORG: COND-304 自チャプター紐付けギルドのみ候補に出す
    ORG->>CP: UC-307 配信先 URL を登録
    CP->>CP: COND-302 SSRF ガードで検証
    CP->>CP: UC-308 署名シークレット生成
    CP-->>ORG: シークレットを平文で一度だけ表示

    Note over ORG,CP: ここまで状態は Draft (未配信)

    ORG->>CP: UC-310 ドライラン
    CP->>CP: D1 に溜まった直近 N 件を評価
    CP-->>ORG: SCR-304 何件マッチしたか

    ORG->>CP: UC-309 テスト配信
    CP->>EP: HTTP POST (署名付き)
    EP-->>CP: レスポンス
    CP-->>ORG: 応答を即時表示
    Note over CP,EP: ADR-006 により Control Plane で完結する。<br/>Data Plane への往復が無いので待たされない

    ORG->>CP: UC-303 有効化
    CP->>CP: 状態を Enabled へ、設定バージョンを進める
    DP->>CP: 次の tick
    CP-->>DP: 新しい設定バージョンを通知
    Note over DP: 対象イベント種別が増えていれば<br/>DP が GET /config で購読仕様を取り直す。<br/>フィルタと配信先は DP に渡らない
```

## ロバストネス図: UC-307 配信先を登録する

```mermaid
flowchart LR
    ORG(["ACTOR-001<br/>organizer"])
    SCR303["SCR-303<br/>配信先編集画面"]
    C1["organizer 検証<br/>COND-301"]
    C2["SSRF ガード<br/>COND-302"]
    C3["シークレット生成"]
    C4["配信先を保存"]
    INFO005[("INFO-005<br/>Destination")]
    INFO012[("INFO-012<br/>AuditLog")]

    ORG --- SCR303
    SCR303 --- C1
    C1 --- C2
    C2 --- C3
    C3 --- C4
    C4 --- INFO005
    C4 --- INFO012

    classDef actor fill:#e8f0fe,stroke:#4285f4
    classDef boundary fill:#fef7e0,stroke:#fbbc04
    classDef control fill:#e6f4ea,stroke:#34a853
    classDef entity fill:#fce8e6,stroke:#ea4335
    class ORG actor
    class SCR303 boundary
    class C1,C2,C3,C4 control
    class INFO005,INFO012 entity
```

## SSRF ガードの要件 (COND-302)

配信先 URL は外部から自由に指定できるため、内部ネットワークへの踏み台になり得る。

[ADR-001](../../../discord-relay/adr.md#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる)
により配信は Control Plane から出るようになった。Cloudflare のネットワークからは
インスタンスメタデータ `169.254.169.254` のようなリンクローカル宛が**そもそも経路上に存在しない**ため、
この要件は「実装が正しくないと危険」から **「多層防御の 1 枚目」** に位置づけが変わった。

**ただし要件自体は残す。** Cloudflare がプライベート宛先への到達不能を
セキュリティ保証として文書化しているわけではなく、将来 fat DP へ戻す判断が
あり得る以上、ガードを外す理由がない。

| チェック | 内容 |
|---|---|
| スキーム | `https` のみ許可（開発環境を除く） |
| 宛先 IP | プライベート (10/8, 172.16/12, 192.168/16)、ループバック (127/8, ::1)、リンクローカル (169.254/16, fe80::/10)、CGNAT (100.64/10) を拒否 |
| DNS 再バインド | 登録時の検証だけでなく、**配信時にも解決結果を再チェック**する |
| リダイレクト | 追跡回数を制限し、リダイレクト先も同じガードを通す |
| ポート | 極端なポートを制限（任意）|

## 設計上の注意

- **秘匿情報の扱い（VAR-303）**: 配信先 URL は「そこへ POST できる」能力そのものなので、
  実質的にシークレット。member にはホスト名とパス先頭のみを見せる。
  署名シークレットは生成直後の一度だけ平文表示し、以降は再表示不可・ローテーションのみ。
- **Intent 未有効でもルールは作れる（COND-303）**: 作成をブロックすると、
  「先にルールを用意して admin に Intent 有効化を依頼する」という自然な運用ができなくなる。
  作成は許し、警告と「まだ届かない」旨の明示で担保する。
- **フィルタは基本のみ**: 正規表現と式言語（CEL / JSONata）は非目標。
  必要になった場合の拡張余地だけ INFO-004 のスキーマに残す。
