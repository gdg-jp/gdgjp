---
type: rdra-context
id: "BIZ-006"
name: "auth"
display_name: "認証・認可"

value:
  goals: ["GOAL-003"]
  requirements:
    - id: "REQ-601"
      description: "GDG Accounts のチャプタークレームに基づいてアクセスが制御され、所属喪失が即時に反映されること"
      traces_to: ["GOAL-003"]
    - id: "REQ-602"
      description: "Control Plane と Data Plane の間の通信が相互に認証され、インターネットに直接露出しないこと"
      traces_to: ["GOAL-003"]
    - id: "REQ-603"
      description: "複数チャプターに所属するユーザーが、操作対象のチャプターを明示的に選べること"
      traces_to: ["GOAL-003"]

environment:
  business_usecases:
    - id: "BUC-601"
      name: "GDG Accounts でログインする"
      actors: ["ACTOR-001", "ACTOR-002", "ACTOR-003", "ACTOR-004"]
      description: "OIDC Authorization Code + PKCE でサインインし、チャプター所属とロールを得る"
      traces_to: ["REQ-601"]
    - id: "BUC-602"
      name: "操作するチャプターを切り替える"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "複数チャプター所属者が現在のチャプターを選ぶ。以降の画面はその境界で絞られる"
      traces_to: ["REQ-603"]
    - id: "BUC-603"
      name: "Plane 間で相互認証する"
      actors: []
      description: "Data Plane が設定を取得し、状態とログを返す経路を認証する"
      traces_to: ["REQ-602"]

boundary:
  usecases:
    - id: "UC-601"
      name: "OIDC でサインインする"
      actors: ["ACTOR-004"]
      screens: ["SCR-601"]
      events: ["EVT-601"]
      traces_to: ["BUC-601"]
      description: "gdg-lib の initializeRpAuth を使い、chapters スコープ付きで認可コードフローを回す"
    - id: "UC-602"
      name: "チャプターを切り替える"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-602"]
      traces_to: ["BUC-602"]
      description: "chapters クレームの配列から選び、選択を cookie に保持する"
    - id: "UC-603"
      name: "認可判定する"
      actors: []
      traces_to: ["BUC-601"]
      description: "organizer / member / is_admin に応じて操作の可否を決める"
    - id: "UC-604"
      name: "サインアウトする"
      actors: ["ACTOR-004"]
      traces_to: ["BUC-601"]
      description: "ローカルセッションを破棄し、RP-initiated logout で IdP セッションも終了する"
    - id: "UC-605"
      name: "Data Plane からの要求を認証する"
      actors: []
      traces_to: ["BUC-603"]
      description: "サービス間認証で設定取得とログ提供の経路を保護する"
  screens:
    - id: "SCR-601"
      name: "サインイン画面"
      description: "GDG Accounts へのリダイレクト起点"
      information: ["INFO-001"]
    - id: "SCR-602"
      name: "チャプター切替 UI"
      description: "所属チャプターの一覧と現在の選択"
      information: ["INFO-001"]
  events:
    - id: "EVT-601"
      name: "OIDC コールバック受信"
      trigger: "GDG Accounts が redirect_uri に code / state を返す"
      description: "トークン交換とセッション確立の起点"

system:
  information: ["INFO-001"]
  states: []
  conditions:
    - id: "COND-601"
      name: "chapters クレームに対象チャプターが含まれること"
      description: "status=active の所属のみクレームに現れる。pending は含まれない"
      traces_to: ["UC-602", "UC-603"]
    - id: "COND-602"
      name: "編集系は role=organizer であること"
      description: "ルール編集、ギルド紐付け、シークレット操作、手動再送のすべてに要求する"
      traces_to: ["UC-603"]
    - id: "COND-603"
      name: "is_admin の横断アクセスは必ず監査に残すこと"
      description: "全チャプター横断で閲覧・操作できるが、記録なしの行使は許さない"
      traces_to: ["UC-603"]
    - id: "COND-604"
      name: "認可判定でクレームをキャッシュしないこと"
      description: "getFreshClaims を使う。所属喪失が即座に反映されなければならない"
      traces_to: ["UC-603"]
  variations:
    - id: "VAR-601"
      name: "ロール"
      values: ["organizer (編集可)", "member (閲覧のみ)", "is_admin (全チャプター横断)"]
      description: "GDG Accounts から供給される。アプリ側で独自ロールは持たない"
      traces_to: ["UC-603"]
---

# BIZ-006 認証・認可

GDG Accounts (`https://accounts.gdgs.jp`) を IdP とし、チャプター所属とロールを
そのままテナント境界と権限に使う。アプリ独自のユーザー管理は持たない。

## IdP の仕様（調査済みの事実）

| 項目 | 値 | 出典 |
|---|---|---|
| issuer | `https://accounts.gdgs.jp`（discovery 必須、個別 URL はハードコードしない） | `accounts-oidc-client-demo/src/index.ts:163-172` |
| フロー | Authorization Code + PKCE S256 の confidential client (`client_secret_basic`) | `accounts/CLAUDE.md:18-20` |
| スコープ | `openid email profile offline_access https://gdgs.jp/scopes/chapters` | `gdg-lib/src/auth/rp.ts:187` |
| チャプタークレーム | `https://gdgs.jp/claims/chapters` = `{chapterId:number, chapterSlug:string, role:"organizer"\|"member"}[]` | `accounts/app/lib/auth.server.ts:188-202` |
| 横断管理者 | `https://gdgs.jp/claims/is_admin` = boolean | 同上 |
| トークン寿命 | access 1 時間 / refresh 30 日 | `accounts/app/lib/auth.server.ts:174-175` |

## 実装上の必須事項

- **`chapters` 配列を使う。** `gdg-lib` の単数 `chapter` は「プライマリ（organizer 優先 → 最古承認順）」の
  レガシー互換フィールドであり、新規実装は配列を使うよう明記されている
  （`gdg-lib/src/auth/index.ts:24-28`）。**1 ユーザー = 1 チャプターで設計してはならない。**
- **クレームは防御的にパースする。** `chapterId` が number でないエントリを破棄する既存実装を踏襲する
  （`gdg-lib/src/auth/rp.ts:648-675`）。
- **認可判定でクレームをキャッシュしない（COND-604）。** 既存 `stream` アプリのコメントが
  「アクセスを決定する画面にこのキャッシュをコピーするな」と明示的に警告している。`getFreshClaims()` を使う。
- **複数チャプター UX は `sns` を参考にする。** cookie で「現在選択中のチャプター」を切り替える方式
  （`sns/app/lib/access.server.ts:26-59`）。
- **権限プリミティブは `accounts/app/lib/permissions.ts:1-36`**（`canManageChapter` / `requireOrganizerOf`）を再利用する。
- **チャプター名の表示**は公開ディレクトリ API `accounts/app/routes/api.chapters.directory.ts`
  （`{id, slug, name, kind}`）から取得する。メンバーシップは非公開。

## OAuth クライアントの登録形態

**第一者クライアントとしてシードする。** セルフサービス登録（`/developers/apps`）ではなく、
`accounts/app/lib/seed-clients.server.ts` の `collectSpecs()` にエントリを追加し、
`/admin/seed-clients` で投入する。

**理由**: セルフサービス登録したクライアントは、**オーナーが全チャプター所属を失うと
D1 トリガで自動的に無効化され、発行済みトークンも削除される**
（`accounts/schema.sql:148-170`、`UPDATE oauthClient ... WHERE userId = OLD.user_id`）。
常時稼働する共有インフラでこれは許容できない。

一方 `seedClients()` の INSERT は **`userId` 列を含まない**ため、シードされたクライアントの
`userId` は NULL であり、トリガの `WHERE userId = OLD.user_id` に決して一致しない。
**第一者クライアントは構造的にこのリスクを免れる。**

必要な変更は小さい:

| 対象 | 変更 |
|---|---|
| `accounts/app/lib/seed-clients.server.ts` | `collectSpecs()` の `apps` 配列に 1 エントリ追加 |
| `accounts` の環境変数 | `DISCORD_RELAY_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URLS` |
| 投入 | `/admin/seed-clients` を開く |

**注意**: `ON CONFLICT DO UPDATE` は `userId` をクリアしない。既にセルフサービス登録した
clientId を再利用せず、新規の clientId を採番すること。

## 業務フロー: BUC-601 / BUC-602 ログインとチャプター選択

```mermaid
sequenceDiagram
    actor U as 利用者
    participant CP as Control Plane
    participant IDP as ACTOR-004 GDG Accounts

    U->>CP: SCR-601 サインイン
    CP->>CP: PKCE code_verifier / state / nonce 生成
    CP->>IDP: authorization リクエスト<br/>scope: openid email profile offline_access chapters
    IDP-->>U: 認証画面 (skipConsent=1 のため同意はスキップ)
    IDP-->>CP: EVT-601 callback (code, state)
    CP->>IDP: UC-601 トークン交換 (PKCE 検証)
    IDP-->>CP: id_token / access_token / refresh_token
    CP->>IDP: userinfo
    IDP-->>CP: claims (chapters 配列, is_admin)

    alt 所属チャプターが 1 つ
        CP->>CP: そのチャプターを選択
    else 複数所属
        CP-->>U: SCR-602 チャプター選択
        U->>CP: UC-602 チャプターを選ぶ
        CP->>CP: 選択を cookie に保持
    end

    Note over CP: 以降の全画面が<br/>COND-601 の境界で絞られる

    U->>CP: 何らかの操作
    CP->>IDP: COND-604 getFreshClaims (キャッシュしない)
    IDP-->>CP: 最新の chapters / is_admin
    CP->>CP: UC-603 COND-602 role=organizer か判定
```

## ロバストネス図: UC-603 認可判定する

```mermaid
flowchart LR
    U(["利用者"])
    REQ["操作リクエスト"]
    C1["セッション解決"]
    C2["getFreshClaims<br/>COND-604"]
    C3["チャプター境界判定<br/>COND-601"]
    C4["ロール判定<br/>COND-602"]
    C5["admin バイパス<br/>COND-603"]
    INFO001[("INFO-001<br/>Chapter")]
    INFO012[("INFO-012<br/>AuditLog")]
    IDP(["ACTOR-004<br/>GDG Accounts"])

    U --- REQ
    REQ --- C1
    C1 --- C2
    C2 --- IDP
    C2 --- C3
    C3 --- INFO001
    C3 --- C4
    C4 --- C5
    C5 --- INFO012

    classDef actor fill:#e8f0fe,stroke:#4285f4
    classDef boundary fill:#fef7e0,stroke:#fbbc04
    classDef control fill:#e6f4ea,stroke:#34a853
    classDef entity fill:#fce8e6,stroke:#ea4335
    class U,IDP actor
    class REQ boundary
    class C1,C2,C3,C4,C5 control
    class INFO001,INFO012 entity
```

## Plane 間認証 (BUC-603 / UC-605)

Data Plane は OCI 上の常時稼働プロセスで、Control Plane (Cloudflare Workers) と
双方向にやりとりする。

| 方向 | 内容 | 認証 |
|---|---|---|
| CP → DP | 設定（ルール・紐付け・Intent）の伝播 | サービス間認証 |
| DP → CP | 接続状態・配信履歴・メトリクスの提供 | サービス間認証 |

**OCI 側のエンドポイントはインターネットに直接露出しない**（REQ-602）。
Cloudflare Tunnel 経由で公開し、Cloudflare Access のサービストークンまたは
共有シークレット / mTLS で認証する。具体方式は技術スタック検討時に決定する。

## 設計上の注意

- **ロールは organizer / member の 2 値しかない。** 細かい権限が必要になったら
  アプリ側に独自ロールを持つことになるが、本アプリではその必要がないと判断した（D-4）。
- **クレームはトークン発行のたびに D1 から読み直される**（`accounts/CLAUDE.md:30`）。
  キャッシュされた古い所属は返らないので、IdP を信頼してよい。
- **`is_admin` は同じ chapters スコープで付いてくる**。別スコープの取得は不要。
