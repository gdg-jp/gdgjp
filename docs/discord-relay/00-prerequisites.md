# Stage 00 — 外部前提の調達と採番: Discord Application、Accounts クライアント、OCI テナンシ

## Context — 背景とリポジトリ状況

[`index.md`](index.md) の最初のステージ。**依存なし。`01`・`06`・`07` の共通前提。**

このステージの成果物は大半が**リポジトリの外**にある — Discord Developer Portal のアプリケーション、
OCI テナンシのクォータと予算アラート、Accounts の D1 に入る OAuth クライアント。
リポジトリ側で書くコードは Accounts の `collectSpecs()` に 1 エントリと、
既存の dev ポート採番の食い違いの解消だけである。

**取り消しにくい作業がここに集まっている。** SETUP-3（各チャプターへの Bot 招待）が始まった後で
Application を建て直すと、全チャプターの再招待になる（[`index.md` §リスクと前提](index.md#リスクと前提)）。
特権 Intent の有効化と Bot verification も同じ Application に紐づく。

現状、`discord-relay/` も `discord-relay-gateway/` も存在しない。リポジトリにあるのは
[RDRA](../rdra/discord-relay/overview.md) と [ADR](adr.md) だけである。

### 読むべきもの

- [`index.md`](index.md) — ステージ分割の全体像。とくに
  [§新規パッケージの登録先](index.md#新規パッケージの登録先) と
  [§未決事項の行き先](index.md#未決事項の行き先)
- [`../rdra/discord-relay/overview.md`](../rdra/discord-relay/overview.md) — SETUP-1〜5 の一覧と
  **D-9（専用 Discord Application を建てる）**、および「Gateway セッションの排他」
- [`../rdra/discord-relay/contexts/auth.md`](../rdra/discord-relay/contexts/auth.md) —
  §OAuth クライアントの登録形態。**第一者クライアントとしてシードする理由**（D1 トリガによる自動無効化）
- [`../rdra/discord-relay/contexts/connection-platform.md`](../rdra/discord-relay/contexts/connection-platform.md) —
  VAR-101（Intent の一覧）、COND-103（特権 Intent は Portal 側の有効化が前提）
- [ADR-005](adr.md#adr-005-plane-間認証を-2-鍵ローテーション可能な-bearer-共有シークレットにする) — 2 鍵の持ち主が CP 側であること
- [ADR-008](adr.md#adr-008-data-plane-を専用の-oci-a1flex-インスタンスに置きagent-host-に相乗りさせない) — シェイプと Always Free 枠の改定（2026-06-15）
- `accounts/app/lib/seed-clients.server.ts:73-112` — `collectSpecs()` の `apps` 配列（現在 8 エントリ）
- `accounts/app/lib/auth.server.ts:137-147` — `trustedOAuthClientIds()`。`cachedTrustedClients`（`:236`）の供給元
- `accounts/.dev.vars.example:12-19,26-39` — `<APP>_CLIENT_SECRET` と `<APP>_CLIENT_ID` / `_REDIRECT_URLS` の命名規約
- `accounts/wrangler.toml:23-25` — `[vars]` 側の `*_CLIENT_ID`
- `agent-host/ENVIRONMENT.md` — 「実機に実際に何があるか」を書く文書の手本。**中身を写さない**（後述の制約）

### 再利用する既存実装

- **`collectSpecs()` の `apps` 配列**（`accounts/app/lib/seed-clients.server.ts:74-93`）— 9 個目を足すだけ。
  `requirePKCE: true` / `public: false` / `SEEDED_SCOPES` は全アプリ共通で、分岐を増やさない
- **`accounts/app/lib/seed-clients.server.test.ts`** — `collectSpecs` の期待値を固定する既存テスト。
  同じ形で discord-relay 用のケースを足す
- **`/admin/seed-clients`**（`accounts/app/routes/admin.seed-clients.tsx`）— 投入経路。新規に作らない
- **既存 8 アプリの redirect URI の形**: `<origin>/api/auth/callback/gdgjp`
  （`gdg-lib/src/auth/rp.ts` の `callbackUrl()` が組み立てる固定パス）

### なぜ専用 Application なのか（決定済み、[overview.md D-9](../rdra/discord-relay/overview.md) 参照）

wiki / agents の Application も xangi のトークンも再利用しない。**同一 Bot トークンで
Gateway セッションは 1 つ**しか張れず、2 プロセスが IDENTIFY すると互いを蹴り落とし合う。
xangi が同じ Application を使っているかはリポジトリから判断できない以上、確認漏れが
そのまま本番の再接続ループになる。理由の全文は overview.md にある。ここでは繰り返さない。

### スコープ制限

- **OCI インスタンスを作らない。** テナンシ・クォータ・シェイプの確認と予算アラートまで。
  インスタンス作成と systemd は [`07-host-runtime.md`](07-host-runtime.md)
- **Bot をチャプターへ招待しない。** SETUP-3 は `02` の招待フロー（UC-201 / UC-202）で吸収する
- **`discord-relay/` のコードを書かない。** ワークスペース新設は [`01-control-plane-skeleton.md`](01-control-plane-skeleton.md)
- **Plane 間シークレットの検証実装を書かない。** 発行と手順書だけ。CP 側の実装は
  [`04-plane-contract.md`](04-plane-contract.md)

## Design — 設計

### 1. SETUP-1: 専用 Discord Application と Bot ユーザー

Developer Portal で新規 Application を作り、Bot ユーザーを足す。得られる 3 つの値の置き場は
Plane ごとに違う。

| 値 | CP (`discord-relay/`) | DP (`discord-relay-gateway/`) | 使う場所 |
|---|---|---|---|
| `DISCORD_RELAY_CLIENT_ID` | `wrangler.toml` の `[vars]`（秘密ではない） | 不要 | Bot 招待 URL の組み立て（`02`） |
| `DISCORD_RELAY_CLIENT_SECRET` | `wrangler secret put` | 不要 | 招待コールバックの code 交換（`02`） |
| `DISCORD_RELAY_BOT_TOKEN` | `wrangler secret put` | `/etc/discord-relay-gateway/bot-token` を `LoadCredential=`（`07`） | CP: チャンネル一覧の取得（`03`）／ DP: IDENTIFY（`06`） |

**Bot トークンが両 Plane に載るのは [ADR-001](adr.md#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる) の帰結である。**
ルール編集のチャンネルセレクタは Discord HTTP API（ACTOR-006）の
`GET /guilds/{guild.id}/channels` から引き、これは Bot 認証を要求する。
既存の `wiki/app/routes/api/discord/guild-channels.ts:53` が `env.DISCORD_BOT_TOKEN` で
同じことをしている。**DP 側は環境変数に置かない**（[ADR-010](adr.md#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く) Decision 2）。

Portal 側の redirect URI には **Discord OAuth2 の招待コールバック**を登録する。
Accounts の OIDC redirect とは別物なので混同しない。

```
https://relay.gdgs.jp/api/discord/callback
http://localhost:5181/api/discord/callback
```

**このステージで決めること: 開発用に 2 つ目の Application を建てるか。**

[`index.md` §事実 C](index.md#この分割が効く-3-つの事実) のとおり、IDENTIFY は 1000 回/日・同時 1 で、
同一トークンの 2 プロセスは共存できない。本番 DP が動き始めた後に開発機で同じトークンの DP を
起動すると本番が蹴り落とされる。判断材料:

| | 1 つで通す | 開発用をもう 1 つ建てる |
|---|---|---|
| SETUP-2 の作業 | 1 回 | 2 回（特権 Intent は Application ごと） |
| SETUP-3 の招待 | 本番のみ | 開発用 Bot も検証用サーバーに招待が要る |
| `06` の実 Gateway 検証 | 本番 DP を止めてから行う | 並行できる |
| 事故 | 開発機の起動で本番が落ちる | 起きない |

`06` は「偽 Gateway に対するテストを先に作り、実 Gateway への接続を最小回数で済ませる」方針
（[`index.md` §直列が必須](index.md#依存グラフ)）なので、1 つで通す判断もありうる。
**どちらを採ったかを `docs/discord-relay/setup.md` に理由つきで書く。**

### 2. SETUP-2: 特権 Intent — **このステージで決める**

[VAR-101](../rdra/discord-relay/contexts/connection-platform.md) の 8 種のうち、初期に有効化する
ものを決める。判断は VAR-301（対象イベント種別）から逆算する。

| Intent | 特権 | これを要する VAR-301 のイベント | 初期に有効化するか |
|---|---|---|---|
| `GUILDS` | — | `CHANNEL_CREATE` / `THREAD_CREATE`、および `GUILD_CREATE` / `GUILD_DELETE` | **必須**（在籍追跡が従属する） |
| `GUILD_MESSAGES` | — | `MESSAGE_CREATE` / `MESSAGE_UPDATE` / `MESSAGE_DELETE` | **必須** |
| `MESSAGE_CONTENT` | ○ | 上記の本文フィルタと転送 | **必須**（本文が無ければ GOAL-001 が成立しない） |
| `GUILD_MEMBERS` | ○ | `GUILD_MEMBER_ADD` / `GUILD_MEMBER_REMOVE` | 見積もり次第 |
| `GUILD_MESSAGE_REACTIONS` | — | `MESSAGE_REACTION_ADD` | 見積もり次第 |
| `GUILD_VOICE_STATES` | — | `VOICE_STATE_UPDATE` | 見積もり次第 |
| `GUILD_SCHEDULED_EVENTS` | — | `GUILD_SCHEDULED_EVENT_CREATE` | 見積もり次第 |
| `GUILD_MODERATION` | — | （VAR-301 に対応するイベントなし） | 有効化しない |

**審査の閾値は 2026-06-10 に「100 サーバー」から「アプリが到達するユニークユーザー 10,000 人」へ
変わっている。** 10,000 未満なら Developer Portal のトグルだけで足り、申請は要らない。
したがってこのステージの作業は次の 2 つになる。

1. **到達ユニークユーザー数を見積もる。** GDG + GDGoC のチャプター数 × 各サーバーのメンバー数の
   概算。Bot が入る全サーバーの合算であって、1 サーバーあたりではない
2. 10,000 未満なら Portal でトグルする。超えるなら申請の所要時間を見積もり、
   `06` の実 Gateway 検証の前倒しが要るかを判断する

**特権 Intent を最小に保つ。** `TYPING_START` / `PRESENCE_UPDATE` は量が多く、購読するルールが
無ければ Intent 自体を有効にしない — これが最も効く負荷削減である
（[connection-platform.md §設計上の注意](../rdra/discord-relay/contexts/connection-platform.md)）。
`GUILD_MODERATION` は VAR-301 に対応イベントが無いので、有効化する理由が現時点で無い。

決めた集合は `06` の IDENTIFY の初期値になり、`09` の SCR-102（Intent 管理画面）が
UC-107 の差分算出でこれと突き合わせる。**INFO-011 の初期レコードの値がこれである。**

### 3. SETUP-4: Bot verification の見張り

100 サーバー到達前に verification を申請する。SETUP-2 の閾値改定とは**別枠で存続している**。
見張り方は `09` に持たせる — tick の heartbeat が `guild_count` を運ぶ
（[ADR-004](adr.md#adr-004-tick-エンドポイント-1-本に-heartbeatコマンドconfig-バージョンを相乗りさせる)）ので、
メトリクス（UC-505）にこの値を出し、閾値を VAR-501 のアラート種別に足せばよい。
**このステージでは「そういう見張りが要る」ことを `09` への申し送りとして記録するだけ。**

### 4. Accounts の OAuth クライアント登録（`00 → 01` の辺そのもの）

`01` のログインが通るために必要。**セルフサービス登録（`/developers/apps`）を使わない。**
セルフサービス登録したクライアントは、オーナーが全チャプター所属を失うと D1 トリガで
自動的に無効化され、発行済みトークンも削除される（`accounts/schema.sql` の
`UPDATE oauthClient ... WHERE userId = OLD.user_id`）。常時稼働する共有インフラでこれは許容できない。
`seedClients()` の INSERT は `userId` 列を含まないので、シードされたクライアントは
構造的にこのリスクを免れる。理由の全文は
[auth.md §OAuth クライアントの登録形態](../rdra/discord-relay/contexts/auth.md)。

`clientId` は **`discord-relay`** とする。既にセルフサービス登録した clientId を再利用しない
（`ON CONFLICT DO UPDATE` は `userId` をクリアしないため、再利用すると上のトリガが残る）。

| 対象 | 変更 |
|---|---|
| `accounts/app/lib/seed-clients.server.ts:74-93` | `apps` 配列に `["Discord Relay", env.DISCORD_RELAY_CLIENT_ID, env.DISCORD_RELAY_CLIENT_SECRET, env.DISCORD_RELAY_REDIRECT_URLS]` |
| `accounts/app/lib/auth.server.ts:137-147` | `trustedOAuthClientIds()` に `env.DISCORD_RELAY_CLIENT_ID` |
| `accounts/wrangler.toml` の `[vars]` | `DISCORD_RELAY_CLIENT_ID = "discord-relay"` |
| `accounts/.dev.vars.example` | `DISCORD_RELAY_CLIENT_SECRET=""` と `DISCORD_RELAY_CLIENT_ID` / `_REDIRECT_URLS` |
| 本番 | `wrangler secret put DISCORD_RELAY_CLIENT_SECRET`（accounts worker 側） |
| 投入 | `/admin/seed-clients` を開く |

redirect URI:

```
https://relay.gdgs.jp/api/auth/callback/gdgjp
http://localhost:5181/api/auth/callback/gdgjp
```

> **`trustedOAuthClientIds()` は既にドリフトしている。** `OST_CLIENT_ID` が `collectSpecs()` には
> あるのに `trustedOAuthClientIds()`（`accounts/app/lib/auth.server.ts:137-147`）には無く、
> `cachedTrustedClients`（同 `:236`）に載っていない。`index.md` が数えた 6 箇所の外側にある
> **7 つ目の登録先**である。discord-relay を足すついでに ost の欠落も埋める。

### 5. SETUP-5: Plane 間共有シークレットの発行とローテーション手順

`openssl rand -base64 48` で生成する。持ち方は Plane で非対称である
（[ADR-005](adr.md#adr-005-plane-間認証を-2-鍵ローテーション可能な-bearer-共有シークレットにする) Decision 1、
[ADR-010](adr.md#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く) Decision 2）。

| Plane | 名前 | 個数 | 渡し方 |
|---|---|---|---|
| CP | `DP_SHARED_SECRET_CURRENT` / `DP_SHARED_SECRET_PREVIOUS` | **2** | `wrangler secret put` |
| DP | `cp-shared-secret` | **1**（常に現行鍵） | `/etc/discord-relay-gateway/cp-shared-secret` を `LoadCredential=` |

ローテーション手順を `docs/discord-relay/setup.md` に書く。**順序が全部である。**

1. CP に新鍵を `DP_SHARED_SECRET_CURRENT` として置き、旧鍵を `DP_SHARED_SECRET_PREVIOUS` へ移す
2. DP の `/etc/discord-relay-gateway/cp-shared-secret` を新鍵に差し替え、`systemctl restart`
3. tick が 200 を返していることを確認してから、CP の `DP_SHARED_SECRET_PREVIOUS` を空にする

**DP には「認証に失敗したら別の鍵で再試行する」経路が無い。** 順序を誤って CP から旧鍵を先に
消すと、DP の tick が全滅する。手順書はこの順序を守らせるためだけに存在する。

`.env.example` は作らない。DP 側に置く資格情報ファイルの一覧は `setup.md` に書く。

### 6. OCI テナンシの確認と予算アラート

インスタンスは作らない。確認と設定だけ行う。

**このステージで決めること: `agent-host` の OCI シェイプ。**
[ADR-008](adr.md#adr-008-data-plane-を専用の-oci-a1flex-インスタンスに置きagent-host-に相乗りさせない) が
「agent-host のシェイプがどこにも記録されていない」と書いている。agent-host も A1 なら
**同一テナンシで Always Free 枠を食い合う。**

Always Free の A1 枠は 2026-06-15 に半減し、**月 1,500 OCPU 時間 / 9,000 GB 時間
（常時 2 OCPU / 12 GB 相当）**になった。ブロックストレージは合計 200 GB で据え置き。
ADR-008 が DP に割り当てた 1 OCPU / 6 GB は改定後も枠内だが、**残る余白は 1 OCPU / 6 GB 分しかない。**

| 確認項目 | 結果の書き場所 |
|---|---|
| 契約が Pay-as-you-go であること | `setup.md` |
| `agent-host` のシェイプと OCPU / メモリ | `setup.md`（ホスト名は書かない。`agent-host/ENVIRONMENT.md` を参照する） |
| A1 の残枠が 1 OCPU / 6 GB 以上あるか | `setup.md` |
| ブロックストレージの使用量 | `setup.md` |

**予算アラートを設定する。** PAYG には Always Free の上限で止まるガードレールが無い。
agent-host が A1 で枠を食っていると、DP を建てた瞬間から課金が始まる。

### 7. dev ポートの採番と、採番表の信用回復

`discord-relay/` は **5181** を採る（`01` で `vite.config.ts` に書く）。
ただし採る前に、既存の採番が 3 箇所で食い違っている状態を解消する。

実測値（各 `vite.config.ts` の `server.port`）:

| ポート | アプリ | `strictPort` |
|---|---|---|
| 5173 | accounts | ○ |
| 5174 | tinyurl | — |
| 5175 | img | — |
| 5176 | scheduler | — |
| 5177 | wiki | ○ |
| 5178 | sns | ○ |
| 5179 | connpass | ○ |
| 5180 | **pay** | ○ |
| 5180 | **website** | — |
| 5185 | ost | ○ |

食い違いは 3 つある。**いずれも本件とは無関係だが、5181 を採る前に採番表を信用できる状態にする。**

1. `pay/vite.config.ts:9` と `website/vite.config.ts:9` がどちらも 5180 を要求している。
   pay 側は `strictPort: true` なので、website を先に起動すると pay が起動に失敗する
2. `pay/.dev.vars.example:12` の `APP_URL` が `http://localhost:5179` — **connpass のポート**である。
   同ファイル `:7` の Google redirect URI も 5179 を指している
3. `CONTRIBUTING.md:39-41` の一覧に **pay が無く**、5180 を website のものとしている

このステージでは 5181 を予約し、上の 3 点を突き合わせて 1 つの表に直す。

**解消の方針（このステージで決める）:**

- **website を 5182 へ動かし、`strictPort: true` を付ける。** 動かすのは pay ではなく
  website である。pay の 5180 は `.dev.vars.example` の `APP_URL` と Google の
  redirect URI に紐づいており、website には外部登録された URI が無いためこちらのほうが安い
- **`strictPort` の無い tinyurl / img / scheduler / website に `strictPort: true` を足す。**
  これは「他アプリのポートを動かさない」に反しない — 採番を動かさず、**沈黙して隣を奪う経路を塞ぐ**。
  これをやらないと 5181 は守れない。vite は塞がっているポートを黙って +1 するので、
  pay が 5180 で走っているときに website を起動すると website が **5181 を取る**。
  そのあと `strictPort: true` の discord-relay は起動に失敗する。
  **原因が「website が犯人」だと分かるまでに時間を溶かす類の失敗である**
- `pay/.dev.vars.example` の 5179 を 5180 に直す（pay のポートは動かさない）
- `CONTRIBUTING.md` の一覧を実測に合わせて作り直す（pay の追加、website の 5182、
  discord-relay の 5181）

### 8. 新規パッケージの名前を確定する

登録先は `01` / `06` / `08` に散るが、**名前はここで決めておく。**
決めずに `01` を始めると、6 箇所（+ 上で見つけた 7 箇所目）に別々の名前が入る。

| 対象 | 名前 |
|---|---|
| CP ディレクトリ / pnpm ワークスペース | `discord-relay/` / `@gdgjp/discord-relay` |
| CP の Worker | `gdgjp-discord-relay` |
| CP の D1 | `gdgjp-discord-relay-db` |
| CP のホスト名 | `relay.gdgs.jp` |
| CP の dev ポート | 5181 |
| CP の cookie prefix | `gdgjp-discord-relay` |
| 配信キュー / DLQ | `gdgjp-discord-relay-deliveries` / `gdgjp-discord-relay-dlq` |
| R2 バケット | `gdgjp-discord-relay-payloads` |
| DP ディレクトリ | `discord-relay-gateway/`（**pnpm ワークスペースにしない**） |
| DP の Go モジュール | `github.com/gdg-jp/gdgjp/discord-relay-gateway` |
| DP の systemd unit | `discord-relay-gateway.service` |
| リリースタグ | `relay-gateway/v*` |

### 制約

- **`agent-host/ENVIRONMENT.md` と `docs/agents-local-mvp/adr.md` の内容をこの文書群へ写さない。**
  本番ホスト名・運用アカウント名・uid・ホームディレクトリの配置台帳が書かれている。
  `setup.md` からは**参照だけ**する
- **Bot トークン・クライアントシークレット・Plane 間シークレットの実値をリポジトリに置かない。**
  `.dev.vars` / `.env` をコミットしない。`.dev.vars.example` に入れるのはキー名と空文字だけ
- **Application を建て直す前提で進めない。** SETUP-3 が始まった後の建て直しは全チャプター再招待になる
- **wiki / agents / xangi の Application と Bot トークンを共有しない**（D-9）
- **OCI インスタンスを作らない。** `07` の担当
- **Discord OAuth2 の redirect URI と Accounts の OIDC redirect URI を混同しない。**
  前者は `/api/discord/callback`（`02`）、後者は `/api/auth/callback/gdgjp`（`01`）
- ポートの整理は上の 3 点に限る。他アプリのポートを動かさない

## Files to touch — 変更ファイル

### 新規

- `docs/discord-relay/setup.md` — SETUP-1〜5 の実施記録、決定（開発用 Application の有無 /
  初期 Intent 集合 / agent-host のシェイプ）、Plane 間シークレットのローテーション手順、
  DP の資格情報ファイル一覧。**秘密の実値と本番ホスト名を書かない**

### 更新

- `accounts/app/lib/seed-clients.server.ts`（`collectSpecs()` の `apps` に 1 エントリ）
- `accounts/app/lib/seed-clients.server.test.ts`（discord-relay のスペックを固定）
- `accounts/app/lib/auth.server.ts`（`trustedOAuthClientIds()` に discord-relay。**ost の欠落も併せて埋める**）
- `accounts/wrangler.toml`（`[vars]` の `DISCORD_RELAY_CLIENT_ID`）
- `accounts/.dev.vars.example`（`DISCORD_RELAY_CLIENT_SECRET` / `_CLIENT_ID` / `_REDIRECT_URLS`、
  および `PAY_REDIRECT_URLS` のポート不整合）
- `website/vite.config.ts`（5180 → 5182、`strictPort: true`）
- `tinyurl/vite.config.ts` / `img/vite.config.ts` / `scheduler/vite.config.ts`
  （`strictPort: true` を足すだけ。ポート番号は動かさない）
- `pay/.dev.vars.example`（`APP_URL` と Google redirect URI の 5179 → 5180）
- `CONTRIBUTING.md:39-41`（dev ポート一覧を実測で作り直す。pay の追加、website の 5182、
  discord-relay の 5181）
- `docs/discord-relay/adr.md`（[§未決事項](adr.md#未決事項) から「初期に有効化する特権 Intent」の行を落とし、
  決定を `setup.md` へのリンクに置き換える）
- `docs/discord-relay/index.md`（[§未決事項の行き先](index.md#未決事項の行き先) の該当 2 行を決着済みにする）

## Verification — 完了条件と検証

### 完了条件

- [ ] Developer Portal に discord-relay 専用の Application と Bot ユーザーがあり、
      `DISCORD_RELAY_CLIENT_ID` / `_CLIENT_SECRET` / `_BOT_TOKEN` の 3 値が手元にある
- [ ] 開発用に 2 つ目の Application を建てるかの判断が、理由つきで `setup.md` に書かれている
- [ ] 初期に有効化する特権 Intent が決まり、到達ユニークユーザーの見積もりとともに
      `setup.md` に書かれている。10,000 を超える見込みなら申請の所要時間も書かれている
- [ ] Portal 側で決めた Intent が実際にトグルされている
- [ ] `accounts` に `discord-relay` の OAuth クライアントがシードされ、`/admin/seed-clients` の
      結果に `discord-relay` が `written` として現れる
- [ ] `trustedOAuthClientIds()` に `discord-relay` と **`ost`** の両方が入っている
- [ ] Plane 間シークレットが生成され、CP 側に `DP_SHARED_SECRET_CURRENT` として置かれている。
      ローテーション手順（3 手順の順序）が `setup.md` にある
- [ ] `agent-host` のシェイプが確認され、A1 の残枠が 1 OCPU / 6 GB 以上あることが `setup.md` にある
- [ ] OCI に予算アラートが設定されている
- [ ] dev ポート 5181 が予約され、`CONTRIBUTING.md` の一覧・各 `vite.config.ts`・
      各 `.dev.vars.example` の 3 者が一致している。全ワークスペースの `vite.config.ts` が
      `strictPort: true` を持つ
- [ ] `docs/discord-relay/adr.md` の未決事項から `00` 担当の 2 行が消えている

### コマンド

```bash
pnpm --filter @gdgjp/accounts test
```

```bash
pnpm --filter @gdgjp/accounts typecheck
```

```bash
pnpm ci:quick
```

dev ポートの実測（3 者の一致を機械的に確かめる）:

```bash
grep -rn "server: *{ *port" --include=vite.config.ts .
```

### 回帰として固定すべきテスト

- **`collectSpecs()` が `DISCORD_RELAY_CLIENT_ID` / `_CLIENT_SECRET` から
  `requirePKCE: true` / `public: false` / `chapters` スコープ付きの spec を返す**
  （`accounts/app/lib/seed-clients.server.test.ts` の agents ケースと同じ形）
- **`DISCORD_RELAY_CLIENT_SECRET` が空のとき spec を返さない**（未設定環境で壊れないこと）
- **`trustedOAuthClientIds()` が `discord-relay` と `ost` を含む**
  （ost は現に欠けている。回帰として固定しないと同じ穴がまた空く）
- **各 `vite.config.ts` の `server.port` が全ワークスペースで一意で、かつ全部が
  `strictPort: true` を持つ**（現状 pay と website が衝突しており、`strictPort` の無い
  4 本は塞がっていると黙って隣のポートを取る。ここを固定しないと 5181 も同じ経路で奪われる）

### 手動 E2E

1. Developer Portal で Application と Bot を作り、Bot タブで決めた Intent をトグルする。
   **`MESSAGE_CONTENT` を含むこと**を目視で確認する
2. Portal の OAuth2 に redirect URI `http://localhost:5181/api/discord/callback` を登録する
   （`02` の招待フローで使う。本番 URL は `01` のデプロイ後に追加してよい）
3. `accounts/.dev.vars` に `DISCORD_RELAY_CLIENT_ID=discord-relay` /
   `DISCORD_RELAY_CLIENT_SECRET=<生成値>` /
   `DISCORD_RELAY_REDIRECT_URLS=http://localhost:5181/api/auth/callback/gdgjp` を書く
4. `pnpm --filter @gdgjp/accounts dev` を起動し、`/admin/seed-clients` を開いて
   `discord-relay` が `written` に現れることを確認する
5. 本番側で `wrangler secret put DISCORD_RELAY_CLIENT_SECRET`（accounts worker）を実行し、
   本番の `/admin/seed-clients` を開いて同じことを確認する
6. OCI コンソールで agent-host のシェイプを開き、OCPU とメモリを控える。
   A1 なら Always Free の使用量ページで残枠を確認する
7. OCI の Budgets で予算アラートを作り、通知先が届くことをテスト送信で確認する
8. `pnpm --filter @gdgjp/pay dev` と `pnpm --filter @gdgjp/website dev` を**同時に**起動し、
   どちらも起動することを確認する（現状は pay が `strictPort` で落ちる）
