---
type: rdra-overview
project: "discord-relay (Discord outgoing webhook)"
actors:
  - id: "ACTOR-001"
    name: "チャプター運営者 (organizer)"
    type: human
    description: "GDG Accounts の chapters クレームで role=organizer を持つ。ギルド登録・ルール編集・秘匿情報の管理を行う"
  - id: "ACTOR-002"
    name: "チャプターメンバー (member)"
    type: human
    description: "role=member。ルールと配信履歴を閲覧する。編集はできない"
  - id: "ACTOR-003"
    name: "GDG 全体管理者 (is_admin)"
    type: human
    description: "is_admin クレーム保持者。共通 Discord Application と Intent を中央管理し、全チャプター横断で閲覧・介入する"
  - id: "ACTOR-004"
    name: "GDG Accounts"
    type: system
    description: "https://accounts.gdgs.jp。OIDC IdP。ユーザー識別とチャプター所属・ロールの供給元"
  - id: "ACTOR-005"
    name: "Discord Gateway"
    type: system
    description: "WebSocket でイベントを push する。共通 Bot が単一セッションで接続する"
  - id: "ACTOR-006"
    name: "Discord HTTP API"
    type: system
    description: "Bot 招待の OAuth2 コード交換、ギルド/チャンネルのメタ取得"
  - id: "ACTOR-007"
    name: "配信先エンドポイント"
    type: system
    description: "変換済みイベントを HTTP POST で受け取る外部システム (Slack / n8n / GAS / 自作 API 等)"
goals:
  - id: "GOAL-001"
    name: "Discord イベントの外部転送"
    description: "Discord の標準 Webhook は受信専用であり、その逆が存在しない。イベントを Discord 側の追加開発なしに任意の HTTP エンドポイントへ届ける"
    actors: ["ACTOR-001", "ACTOR-005", "ACTOR-007"]
  - id: "GOAL-002"
    name: "ノーコードでの転送設定"
    description: "チャプター運営者がコードを書かずに転送設定を管理し、本番投入前に検証できる"
    actors: ["ACTOR-001", "ACTOR-002"]
  - id: "GOAL-003"
    name: "チャプター単位の分離"
    description: "イベントと設定がチャプター単位で分離され、他チャプターに漏れない"
    actors: ["ACTOR-001", "ACTOR-004"]
  - id: "GOAL-004"
    name: "配信の追跡と回復"
    description: "配信の成否が追跡でき、失敗を検知して再送できる。設定が黙って死なない"
    actors: ["ACTOR-001", "ACTOR-002"]
  - id: "GOAL-005"
    name: "無停止運用と自己復旧"
    description: "OCI 無料枠 1 台構成で常時稼働し、切断・再起動から人手を介さず復旧する"
    actors: ["ACTOR-003"]
contexts:
  - id: "BIZ-001"
    name: "connection-platform"
    description: "共通 Bot の Gateway 接続、Intent 管理、再接続、ギルド/チャンネルのキャッシュ"
    primary_actors: ["ACTOR-003"]
    goals: ["GOAL-001", "GOAL-005"]
  - id: "BIZ-002"
    name: "server-registration"
    description: "Bot 招待フローによるギルド ↔ チャプター紐付けと在籍追跡"
    primary_actors: ["ACTOR-001"]
    goals: ["GOAL-003", "GOAL-004"]
  - id: "BIZ-003"
    name: "rule-management"
    description: "転送ルールの CRUD、配信先と署名シークレットの管理、テスト配信"
    primary_actors: ["ACTOR-001", "ACTOR-002"]
    goals: ["GOAL-002", "GOAL-003"]
  - id: "BIZ-004"
    name: "event-delivery"
    description: "ルール評価、正規化、キューイング、HTTP 配信、リトライ、DLQ"
    primary_actors: []
    goals: ["GOAL-001", "GOAL-004"]
  - id: "BIZ-005"
    name: "observability"
    description: "ライブビューア、配信履歴、失敗一覧と再送、メトリクス、アラート、監査ログ"
    primary_actors: ["ACTOR-001", "ACTOR-002", "ACTOR-003"]
    goals: ["GOAL-004", "GOAL-005"]
  - id: "BIZ-006"
    name: "auth"
    description: "GDG Accounts での OIDC ログイン、チャプター切替、organizer/member/admin の認可、Plane 間認証"
    primary_actors: ["ACTOR-004"]
    goals: ["GOAL-003"]
---

# discord-relay — 全体概観

Discord 上で発生したイベントを、外向き Webhook として任意の HTTP エンドポイントへ転送する。
Discord が提供する Webhook は **受信専用**（外部 → Discord）で、その逆は存在しない。本アプリはその欠落を埋める。

## リポジトリ内の既存資産との関係

本アプリは白紙から始まらない。upstream に以下が既に存在する。

| 既存 | 内容 | 本アプリでの扱い |
|---|---|---|
| 共通 Discord Application | `docs/discord-source-setup.md`。wiki のリマインダーと agents のクエリ Bot が同一 Application を共有する運用が確立している | **再利用しない（D-9）。** discord-relay 専用の Application と Bot トークンを新規に建てる。理由は下記「Gateway セッションの排他」 |
| `MESSAGE_CONTENT` Intent | 上記 §1-2 で wiki/agents の Application では既に有効化済み | 専用 Application では**改めて有効化が必要**（運用手順 SETUP-2） |
| Bot 招待 + ギルドピッカー | `wiki/app/routes/api/discord/{auth,callback,guilds,guild-channels}.ts`、`wiki/app/features/discord/`、`DiscordChannelDialog.tsx`。`botInstalled` フラグ付きのサーバー一覧と bitfield `66560` の招待 URL 生成 | **BIZ-002 の下敷きにする。** 実装パターンを踏襲する |
| `wiki.discord_guild_settings` | `guild_id` → `chapter_id` の 1:1 マッピング（`chapter_id` に UNIQUE） | **共有しない。** 目的が「リマインダー送信先チャンネル」であり、かつ 1 チャプター 1 ギルドに固定されているため、本アプリの複数ギルド要件と噛み合わない |
| `agents/` | Discord **Interactions webhook**（Ed25519 検証、Vercel/Next.js/Redis） | 機構が異なる。`docs/agents-setup.md:37` が "no Discord Gateway listener" と明記。**衝突しない** |
| **xangi**（agents-local） | `github.com/Harineko0/xangi` フォーク。`/opt/xangi` に systemd 常駐。**discord.js で Gateway 接続を保持**し、`Guilds` / `GuildMessages` / `GuildMembers` / `MessageContent` を要求、`MessageCreate` ベースで動く | **衝突源。** 下記参照 |

### Gateway セッションの排他（設計制約）

Discord は **同一 Bot トークン・同一シャードにつき Gateway セッションを 1 つ**しか許さない。
2 プロセスが同じトークンで IDENTIFY すると互いを蹴り落とし合い、再接続ループに陥る。
GDG はこれを既に経験しており、記録が残っている
（`docs/agents-local-mvp/07-ubuntu-host-install-2026-08-20.md:155`
「操作者の個人 xangi を同じ `DISCORD_TOKEN` で enable し直すと、本番 svc と取り合う」）。

**シャーディングでは解決しない。** シャードはギルドを排他的に分割するため、
xangi と本アプリの双方が全ギルドのイベントを必要とする以上、分割は両者の要件を壊す。

したがって **`discord-relay-gateway` は、他の Gateway クライアントが使っていないトークンを専有しなければならない。**
D-2「共通 Bot 1 つ」の決定はここでも有効だが、これは「**全チャプターで 1 つ**」の意味であり、
「GDG の他アプリと共有する」という意味ではない。

### D-9: 専用 Discord Application を建てる

`discord-relay-gateway` は **専用の Discord Application と Bot トークン**を持つ。
wiki/agents の Application も xangi のトークンも再利用しない。

**理由**
- xangi が同じ Application を使っているかはリポジトリから判断できない（`~/.config/xangi/secrets.json` の値は未記載）。
  再利用すると、確認漏れがそのまま本番の再接続ループになる。
- 将来 wiki/agents 側が Gateway を使い始めた時点で壊れる依存を作らない。
- 本アプリが必要とする Intent（`GUILD_SCHEDULED_EVENTS` / `GUILD_MESSAGE_REACTIONS` / `GUILD_VOICE_STATES` 等）は
  xangi の 4 Intent と一致しない。Intent 変更は再接続を伴うため、他アプリと共有すると互いの運用を乱す。

**代償として発生する運用タスク**
| ID | タスク | 備考 |
|---|---|---|
| SETUP-1 | 専用 Application と Bot ユーザーを Developer Portal で作成 | `DISCORD_RELAY_CLIENT_ID` / `_CLIENT_SECRET` / `_BOT_TOKEN` |
| SETUP-2 | 特権 Intent（`MESSAGE_CONTENT` ほか必要分）を有効化 | wiki/agents の Application とは別に申請が要る |
| SETUP-3 | 各チャプターの Discord サーバーへ招待 | BIZ-002 の招待フローで吸収する。追加実装は不要 |
| SETUP-4 | 100 サーバー到達前に Bot verification を申請 | GDG + GDGoC のチャプター数次第で射程に入る |
| SETUP-5 | Plane 間共有シークレットの発行とローテーション手順の整備 | **CP が**新旧 2 鍵を常に受け付け、DP は現行 1 鍵だけを持つ（[ADR-005](../../discord-relay/adr.md#adr-005-plane-間認証を-2-鍵ローテーション可能な-bearer-共有シークレットにする)）。CP は `wrangler secret put`、DP は systemd の `LoadCredential=`（[ADR-010](../../discord-relay/adr.md#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く)）。環境変数には置かない |

## システムコンテキスト図

```mermaid
graph TB
    subgraph Human["利用者"]
        ORG["ACTOR-001<br/>チャプター運営者<br/>(organizer)"]
        MEM["ACTOR-002<br/>チャプターメンバー<br/>(member)"]
        ADM["ACTOR-003<br/>GDG 全体管理者<br/>(is_admin)"]
    end

    subgraph SUT["discord-relay"]
        CP["Control Plane<br/>discord-relay<br/>(Cloudflare Workers)"]
        DP["Data Plane<br/>discord-relay-gateway<br/>(OCI)"]
    end

    IDP["ACTOR-004<br/>GDG Accounts<br/>accounts.gdgs.jp"]
    GW["ACTOR-005<br/>Discord Gateway"]
    API["ACTOR-006<br/>Discord HTTP API"]
    EP["ACTOR-007<br/>配信先エンドポイント"]

    ORG -->|ルール編集・ギルド登録| CP
    MEM -->|閲覧| CP
    ADM -->|Intent 管理・横断介入| CP
    CP -->|OIDC 認証| IDP
    CP -->|Bot 招待の code 交換| API
    DP -->|tick: イベント転送 / heartbeat<br/>接続は常に DP 発| CP
    CP -.->|tick 応答: 購読仕様の版 / コマンド| DP
    GW -->|イベント push| DP
    CP -->|HTTP POST| EP
```

**矢印の向きが設計判断そのものである。** Plane 間の TCP は常に DP から CP へ張られ、
CP → DP の情報はすべて tick の応答に相乗りする（[ADR-002](../../discord-relay/adr.md#adr-002-plane-間通信をアウトバウンド片方向に限定しoci-にインバウンド経路を作らない)、
[ADR-004](../../discord-relay/adr.md#adr-004-tick-エンドポイント-1-本に-heartbeatコマンドconfig-バージョンを相乗りさせる)）。
配信先への HTTP POST は Control Plane から出る（[ADR-001](../../discord-relay/adr.md#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる)）。

## コンテキスト間関係図

```mermaid
graph LR
    BIZ006["BIZ-006<br/>認証・認可"]
    BIZ002["BIZ-002<br/>サーバー登録"]
    BIZ003["BIZ-003<br/>転送ルール管理"]
    BIZ001["BIZ-001<br/>接続基盤運用"]
    BIZ004["BIZ-004<br/>イベント配信"]
    BIZ005["BIZ-005<br/>可観測性"]

    BIZ006 -->|チャプターと権限を供給| BIZ002
    BIZ006 -->|チャプターと権限を供給| BIZ003
    BIZ002 -->|紐付け済みギルドを供給| BIZ003
    BIZ002 -->|受信対象ギルドを確定| BIZ001
    BIZ003 -->|有効ルールと必要 Intent を供給| BIZ001
    BIZ003 -->|評価対象ルールを供給| BIZ004
    BIZ001 -->|受信イベントを供給| BIZ004
    BIZ004 -->|配信結果を供給| BIZ005
    BIZ001 -->|接続状態を供給| BIZ005
    BIZ005 -->|ギルド離脱によるルール停止| BIZ003
```

## Plane 分割

境界は「Gateway セッションを保持できるか」の一点だけで引く
（[ADR-001](../../discord-relay/adr.md#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる)）。

| Plane | パッケージ | 実行環境 | 責務 |
|---|---|---|---|
| Control Plane | `discord-relay/` | Cloudflare Workers (React Router v7) | ダッシュボード、OIDC RP、設定の SSoT (D1)、Bot 招待コールバック、**ルール評価・正規化・キュー・配信・リトライ・DLQ・配信ログの SSoT** |
| Data Plane | `discord-relay-gateway/` | OCI `VM.Standard.A1.Flex`（arm64）1 台・常時稼働 | Gateway 接続、RESUME、**粗いフィルタ（ギルド + イベント種別）**、転送バッファ、Control Plane への転送 |

Workers は常時 WebSocket クライアントを保持できないため Gateway は OCI に置く。
一方 `gdg-lib` の `initializeRpAuth` は Workers + D1 前提なので、認証は Control Plane 側に置いて再利用する。
それ以外の責務は Control Plane に寄せた。

**Data Plane に渡す設定は秘匿値を含まない。** 配信先 URL・署名シークレット・カスタムヘッダ・
細かいフィルタ（チャンネル / 投稿者 / キーワード）はすべて Control Plane に留まる。
DP が持つ秘密は **Discord Bot トークン 1 つだけ**であり、**DP は GDG のチャプターという概念を知らない**。

**Plane 間の TCP 接続は常に DP から CP へ張る**
（[ADR-002](../../discord-relay/adr.md#adr-002-plane-間通信をアウトバウンド片方向に限定しoci-にインバウンド経路を作らない)）。
OCI にインバウンド経路を作らないため、REQ-602 は「露出しない設定にする」ではなく
「露出する経路が存在しない」で満たされる。

代償として **Control Plane が落ちると配信が止まる**（Gateway 接続と受信バッファは継続する）。
Cloudflare の可用性を無料枠 VM のそれより高いと見なす賭けを、明示的に受け入れている。

## カバレッジサマリ

`traceability.yaml` を参照。孤立要素（GOAL に到達しないチェーン）は 0 件を維持する。
