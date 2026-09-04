# discord-relay — 実装ステージ分割

要求分析は [`docs/rdra/discord-relay/`](../rdra/discord-relay/overview.md)、実現方式の決定は
[`adr.md`](adr.md) にある。ここにあるのは **どの順で作るか、なぜその順なのか** である。

**この index は delegate しない。** 見出し規約（`## Context` / `## Design` / `## Files to touch` /
`## Verification`）にも従っていない。実装は `00`〜`10` の各ステージファイルを 1 つずつ渡すこと。

> **用語の衝突に注意。** [ADR-007](adr.md#adr-007-低遅延化の-durable-object-ハブは-stage-2-とし正しさの依存にしない) の
> 「Stage 1 / Stage 2」は *Durable Object を入れる前 / 後* という 1 軸だけを指す。
> この文書の `00`〜`10` は実装の順序であって、別の軸である。
> 対応は **ADR-007 の Stage 1 = `00`〜`09`、Stage 2 = `10`**。

## 目指す状態

1. organizer が accounts.gdgs.jp でログインし、自分のチャプターの Discord サーバーに Bot を招待して、
   コードを書かずに転送ルールを作れる（GOAL-001 / GOAL-002）
2. 作ったルールを **本番投入前にテスト配信とドライランで検証できる**（GOAL-002）
3. 配信の成否が履歴に残り、失敗が DLQ に隔離され、手で再送できる（GOAL-004）
4. OCI の 1 台が落ちても、復旧後に人手なしで Gateway セッションへ戻る（GOAL-005）
5. **リポジトリの HEAD にピン留めされたバージョンが、OCI 上で動いているバージョンと一致している**
   （[ADR-011](adr.md#adr-011-デプロイをピン留めした静的バイナリの-pull-型収束としtick-経路をコード配布に使わない)）

現状はこのどれも成立していない。`discord-relay/` も `discord-relay-gateway/` もまだ存在せず、
リポジトリにあるのは RDRA と ADR だけである。

## この分割が効く 3 つの事実

**事実 A: 配信は Gateway 無しに完成する。**
[ADR-001](adr.md#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる) が配信を
Control Plane に寄せ、[ADR-006](adr.md#adr-006-配信基盤に-cloudflare-queues-を採りメタデータは-d1本文は-r2-に置く) が
「テスト配信も Control Plane で完結する」と書いた。結果として
**`05` まででルール編集・テスト配信・履歴・DLQ・再送が動く製品が成立する。**
最も不確実な DP の作業は、動く製品への臨界パス上に無い。

> **事実 A は 1 点に従属していた。決着済みである。** UC-108 は当初「READY / `GUILD_CREATE` /
> `CHANNEL_*` からギルドとチャンネルの一覧を保持し、**ルール編集のセレクタに供給する**」と
> 書いていた。字義どおりに採ると `03` のチャンネルフィルタ UI が `06` に従属し、
> **`03`〜`05` が Gateway 待ちになって事実 A が崩れる。**
>
> **2026-09-05 に [ADR-001](adr.md#adr-001-data-plane-を-gateway-転送専用に絞り配信を-control-plane-に寄せる) 側で決着させた。**
> セレクタの供給元は Discord **HTTP API**（ACTOR-006）とし、UC-108 は
> 「Gateway イベントによるキャッシュの追随」に格下げした。前例は既にリポジトリにある —
> `wiki/app/routes/api/discord/guild-channels.ts` が `env.DISCORD_BOT_TOKEN` で同じことをしている。
> **代償として CP も Bot トークンを持つ。** その帰結は ADR-001 Consequences に記録した。
> **`03` は `06` に従属しない。**

**事実 B: DP が依存するのは契約 1 つだけである。**
DP は配信先 URL も署名シークレットもチャプターの概念も持たない。DP と CP が共有するのは
`GET /api/dp/config` と `POST /api/dp/tick` の JSON スキーマだけであり、その SSoT は OpenAPI に置く
（[ADR-009](adr.md#adr-009-data-plane-を-go-で実装し単一の静的バイナリとして配る) Consequences）。
**`04` が唯一の結節点**であり、そこを越えれば CP 側（`05`）と DP 側（`06`）は並行できる。

**事実 C: IDENTIFY は有限で、セッションは排他である。**
Discord の IDENTIFY は 1000 回/日・同時 1、かつ
[同一トークンで 2 プロセスは接続できない](../rdra/discord-relay/overview.md)。
これは実装ではなく **開発の進め方**への制約である。

- 本番 DP が動き始めた後、同じトークンで開発機の DP を起動すると本番が蹴り落とされる
- クラッシュループはクォータを焼き、焼き切ると復旧手段が無くなる
  （[ADR-010](adr.md#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く) Decision 4・7）

したがって **`06` は「偽 Gateway に対するテスト」を先に作り、実 Gateway への接続を最小回数で済ませる。**
開発用に 2 つ目の Discord Application を建てるかは `00` で決める（SETUP-1 の範囲が変わる）。

## ステージ一覧

| # | ファイル | 内容 | 主な RDRA 要素 | 規模 | 人手が要る外部作業 |
|---|---|---|---|---|---|
| 00 | `00-prerequisites.md` | Discord Application、Accounts の OAuth クライアント、OCI テナンシ、ポート採番、パッケージ登録 | SETUP-1〜5 | 数日 | **Discord Portal / OCI / Accounts** |
| 01 | `01-control-plane-skeleton.md` | `discord-relay/` 新設。OIDC RP、チャプター切替、認可、監査 | BIZ-006 / UC-601〜604 / SCR-601・602 | 数日 | 無 |
| 02 | `02-server-registration.md` | Bot 招待フロー、ギルド↔チャプター紐付け、一覧、移管 | BIZ-002 / UC-201〜207 / SCR-201〜203 | 数日 | 無 |
| 03 | `03-rule-management.md` | ルール CRUD、フィルタ、配信先、署名シークレット、SSRF ガード | BIZ-003 / UC-301〜308・311 / SCR-301〜303・305 | 1〜2 週 | 無 |
| 04 | `04-plane-contract.md` | OpenAPI SSoT、`/api/dp/config`、`/api/dp/tick`、Bearer 2 鍵認証 | UC-605 / REQ-602 | 数日 | 無 |
| 05 | `05-delivery-pipeline.md` | Queues・D1・R2、評価、正規化、署名、リトライ、DLQ、テスト配信 | BIZ-004 / UC-401〜408・309・310 / SCR-304 | 1〜2 週 | 無 |
| 06 | `06-gateway-client.md` | Go モジュール、WebSocket、RESUME、`dedupe_key`、config pull、転送バッファ | BIZ-001 / UC-101〜105・108 | 1〜2 週 | 無 |
| 07 | `07-host-runtime.md` | OCI インスタンス、systemd unit、`LoadCredential`、watchdog、`ENVIRONMENT.md` | REQ-101・103 / INFO-010 | 数日 | **OCI** |
| 08 | `08-release-convergence.md` | `relay-gateway/v*` リリースジョブ、`gdg relay-host`、spec ピン、収束 timer | — | 1 週 | 無 |
| 09 | `09-observability.md` | ライブビューア、履歴、DLQ 一覧、再送、メトリクス、アラート、監査、保持期間、接続と Intent の運用画面 | BIZ-005 / UC-501〜508・106・107 / SCR-501〜505・101・102 | 1〜2 週 | 無 |
| 10 | `10-relay-hub-do.md` | ADR-007 Stage 2: `RelayHub` Durable Object（**任意**） | UC-501 の遅延改善 | 1 週 | 無 |

**`02` と `06` にまたがる 2 つのユースケース**: UC-205（Bot 退出の検知）と UC-207（再参加の検知）は
`GUILD_DELETE` / `GUILD_CREATE` に由来するので、DP が動く `06` の後に `02` へ戻って実装する。
それまで紐付けの解除は UC-204 の手動操作だけになる。

**接続と Intent の運用画面を `09` に置いた理由**: SCR-101（接続ステータス）は DP の heartbeat を、
SCR-102（Intent 管理・admin）は UC-106 の再起動コマンドが DP に届くことを前提にする。
どちらも `06` の後にしか完成しない。ただし **UC-107（必要 Intent の差分算出）の計算そのものは
`04` にある** — `GET /api/dp/config` が返す `intents` は「全チャプターの有効ルールから求めた和集合」
であり、UC-107 と同じ式である。`09` はそれを画面に出すだけになる。

**`10` は入れないという結論もありうる。** ADR-007 は「実際に使われてから判断できる」と書いた。
`09` のライブビューアがポーリングで足りているなら、2 経路を維持する対価を払わない。

## 依存グラフ

```
00 ─┬─→ 01 → 02 → 03 → 04 ─┬─→ 05 ────────→ 09 → 10
    │                       │                 ↑
    │                       └─→ 06 ───────────┘
    │                            │
    └────────────────────────────┴→ 07 → 08

                                 06 → 02'（UC-205 / UC-207）
```

辺の一覧:

| 辺 | 理由 |
|---|---|
| `00 → 01` | Accounts に OAuth クライアントが無いとログインが通らない。`/admin/seed-clients` の再シードが要る |
| `00 → 06`, `00 → 07` | Bot トークンと OCI テナンシは申請・調達の対象であって、実装で作れない |
| `01 → 02` | 紐付けの主体は `(chapter, role)`。認可が無いと「誰のギルドか」が決まらない |
| `02 → 03` | ルールは紐付け済みギルドの上にしか作れない（COND-301） |
| `03 → 04` | `GET /api/dp/config` が返す購読仕様は**有効ルールから導出される値**であり、独立に作れない |
| `04 → 05` | ルール評価と enqueue は tick ハンドラの中にある（[ADR-006](adr.md#adr-006-配信基盤に-cloudflare-queues-を採りメタデータは-d1本文は-r2-に置く) Decision 2） |
| **`04 → 06`** | **契約先行**。DP を書いてから契約を決めると、二重定義が実装の都合で固定される |
| `05 → 09` | 履歴・DLQ・再送は、配信の記録が生まれてからでないと画面を作れない |
| `06 → 09` | ライブビューア（UC-501 / SCR-501）は DP の転送イベントを要る |
| `06 → 07` | 動くバイナリが無いと unit ファイルの正しさを検証できない |
| `07 → 08` | 収束機構の検証には「正しく手で置けた実物」が要る |
| `09 → 10` | DO は `09` で作った tick 経路を高速化するもの。正しさの依存にしない（ADR-007） |

**並行可能**:

- **`05` と `06` は `04` の完了後に並行してよい。** CP と DP で担当を分けるなら、ここが最も効く分岐
- `00` のうち OCI インスタンス作成と予算アラートは、`01`〜`05` と並行して進められる
- `09` は 2 つに割れる。**履歴・DLQ・再送・保持期間は `05` 依存**、**ライブビューアだけが `06` 依存**。
  前者は `06` を待たずに出せる
- `08` のリリースジョブ（`deploy.yml` の `relay-gateway/v*`）は、`06` にタグを打てるものができた時点で書ける

**直列が必須**:

- `00` の SETUP-2（特権 Intent）は、アプリが到達するユニークユーザーが 10,000 を超えるなら
  審査が挟まる（2026-06-10 に閾値が「100 サーバー」から変わった）。**超えない見込みなら
  Portal のトグルだけで、この辺は消える。** どちらかを `00` で見積もる
- `04 → 06` は上記のとおり契約先行
- **`06` の内部順序**: 偽 Gateway に対するテスト → 実 Gateway で IDENTIFY → RESUME の確認 → 常駐化。
  順序を逆にすると、事実 C のクォータをデバッグで焼く
- **`07` の内部順序**: RESUME が通ることを確認してから `Restart=always` を入れる。
  クラッシュループが自動再起動と噛み合うと IDENTIFY を最速で枯らす
- `07 → 08`: 収束が壊れているときの復旧手段は「手で置く」であり、その手順が実証済みである必要がある

## 新規パッケージの登録先

`discord-relay/`（`01`）と `discord-relay-gateway/`（`06`）を足すときに触る場所。
**登録漏れは静かに壊れる** — CI が対象を選ばないだけで、赤くならない。

| 対象 | 場所 | ステージ |
|---|---|---|
| ワークスペース | `pnpm-workspace.yaml` | 01 |
| CI の検査対象 | `.github/scripts/changed-workspaces.mjs` の `CI_WORKSPACES` | 01 |
| デプロイ対象 | 同 `DEPLOY_TARGETS` + `.github/workflows/deploy.yml` の `deploy` ジョブ | 01 |
| pre-commit の絞り込み | `scripts/run-ci.mjs` の `workspaces` Map | 01 |
| dev ポート | `discord-relay/vite.config.ts`。**5173〜5180 と 5185 は使用中。5181 を採る** | 01 |
| パッケージ一覧 | `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` | 01 |
| Go モジュール | `.github/scripts/changed-workspaces.mjs` の `GO_MODULES` に **エントリ 1 個** | 06 |
| リリース | `deploy.yml` の `on.push.tags` に `relay-gateway/v*` + **新規ジョブ** | 08 |

Go の検査レーンは登録簿から導出済みなので、`06` の登録は 1 箇所で済む
（[ADR-009](adr.md#adr-009-data-plane-を-go-で実装し単一の静的バイナリとして配る) Consequences）。
**リリースジョブは共通化しない。** `release-cli` は 6 プラットフォームの zip を利用者に配るもので、
`relay-gateway` が要るのは `linux/{arm64,amd64}` の tar.gz + SHA256 を収束機構に向けて置くことである。

> `scripts/run-ci.mjs` の `workspaces` Map には既に `pay` と `agents` が入っていない。
> 6 箇所が独立に存在する以上ドリフトする。`01` で足すときに併せて埋める。

## 未決事項の行き先

[ADR の「未決事項」](adr.md#未決事項)を、どのステージで決めるかに割り付ける。

| 論点 | 決める場所 | 決め方 |
|---|---|---|
| 初期に有効化する特権 Intent（SETUP-2） | **00** | 到達ユニークユーザー数を見積もる。10,000 未満なら Portal のトグルのみで審査は要らない（2026-06-10 改定） |
| OpenAPI に載せる tick スキーマの範囲 | **04** | 契約の定義そのもの |
| Gateway の transport 圧縮（`zlib-stream`） | **06** | ギルド数が小さいうちは無圧縮で足りる見込み。測ってから |
| DP の転送バッファ上限 | **06** で暫定値、**07** 以降で実測して確定 | 「CP 障害が何分続いたら失い始めるか」を決める値 |
| `169.254.169.254` が VCN DNS を兼ねるか | **07** | **実機確認（未決のまま）**。Oracle の DNS ドキュメントは 169.254.169.254 を *Private DNS Resolver* の待ち受けとしてのみ記述し、既定の VCN リゾルバの所在を明示していない。**ドキュメントでは閉じない。** `IPAddressDeny=link-local` の可否がこれに従属する |
| アラート（EVT-501）の通知経路 | **09** | Discord / メール / その他 |
| 宛先ごとのレート制限 | **09** 以降 | 当面は 429 の `Retry-After` 尊重。必要になったら宛先ごとの DO |

## 既知の不整合

**DP の秘密の渡し方（解消済み）。** ADR-005 Decision 5 は「秘密は環境変数として渡す。DP は
systemd の `EnvironmentFile`」と書いていたが、同日採択の ADR-010 Decision 2 は `LoadCredential=`
を選び「環境変数には置かない」と明記していた。あわせて ADR-010 が「DP は ADR-005 の 2 鍵を持つ」と
書いていた点も、ADR-005 のローテーション手順（CP に新旧両方 → DP を新に切り替え → CP から旧を削除）と
噛み合っていなかった。**2026-09-05 に ADR-010 側へ一本化し、RDRA の SETUP-5 も追随済み。**
`07` の実装者は [ADR-010](adr.md#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く) だけを読めばよい。

**Antigravity のクロスレビュー（2026-09-05・解消済み）。** Gemini に外部事実の検証と
内部整合性のレビューをさせ、12 件を ADR と RDRA に反映した（1 件は指摘の前提が ADR に無い
記述だったため、論点だけを採った）。うち 2 件は **外部の一次情報が変わっていたことによる誤り**
である — OCI の Always Free 枠が 2026-06-15 に半減し、Discord の特権 Intent 審査の閾値が
2026-06-10 に「100 サーバー」から「ユニークユーザー 10,000 人」へ変わっていた。
設計上の最大の穴は「Intent 変更のための再起動が無条件 RESUME に食われ、変更がサイレントに
反映されない」で、[ADR-010](adr.md#adr-010-systemd-の-system-unit-で常駐させ状態は-statedirectory秘密は-loadcredential-に置く) Decision 7 に例外条項を入れて閉じた。
ADR 末尾の 3 番目の影響表がこの回の RDRA 側の変更の一覧である。

**dev ポートの重複（未解消）。** `pay/vite.config.ts` と `website/vite.config.ts` がどちらも 5180 を
要求している。本件とは無関係だが、`01` でポートを採る前に既存の採番表を信用できる状態にしておく。

## リスクと前提

**`00` の Discord Application は取り消しにくい。** 特権 Intent の有効化、100 サーバー到達前の
Bot verification（SETUP-4）は GDG + GDGoC のチャプター数次第で射程に入る。
チャプターへの招待（SETUP-3）が始まった後で Application を建て直すと、全チャプターの再招待になる。

**Control Plane が落ちると配信が止まる。** Gateway 接続と受信バッファは継続するが、
バッファ上限を超えたイベントは失われる。「Cloudflare の可用性 > 無料枠 VM の可用性」という賭けを
[Plane 分割](../rdra/discord-relay/overview.md)で明示的に受け入れている。`09` の監視対象はここである。

**OCI は Pay-as-you-go で、Always Free の上限で止まるガードレールが無い。**
`00` で**予算アラートを設定する**こと。A1 の Always Free 枠は **2026-06-15 に半減して
月 1,500 OCPU 時間 / 9,000 GB 時間（常時 2 OCPU / 12 GB 相当）**になった。
[ADR-008](adr.md#adr-008-data-plane-を専用の-oci-a1flex-インスタンスに置きagent-host-に相乗りさせない) の
1 OCPU / 6 GB は枠内だが、**余白は 1 OCPU / 6 GB 分しかない。**
agent-host も A1 なら同一テナンシで食い合うので、`00` でシェイプを確認する。

**`08` 以降、リポジトリへの push が OCI ホストの構成を変える。**
[ADR-011](adr.md#adr-011-デプロイをピン留めした静的バイナリの-pull-型収束としtick-経路をコード配布に使わない) は
tick 経路をコード配布に使わないと決めたので **CP 侵害が DP の RCE にはならない**が、
リリース署名鍵とタグの保護は `08` の範囲に含める。

**Go の収束エンジンが agent-host 用と relay 用の 2 役になる。**
[ADR-026](../agents-local-mvp/adr.md) の「約 2,000 行を超えたら Ansible を再検討」に近づく。
`08` で行数を計測対象にする。

## 判断の記録

`adr.md` に記録済みで、ステージ実装時に再検討しないもの。

| 論点 | 決定 | ADR |
|---|---|---|
| Plane の境界 | 「Gateway セッションを保持できるか」の一点だけ | 001 |
| Plane 間の TCP | 常に DP → CP。インバウンド経路を作らない | 002 |
| 設定の配り方 | ETag 付き pull。最後に成功した設定をディスクに残す | 003 |
| Plane 間のエンドポイント | tick 1 本に相乗り（`GET /config` だけ分ける） | 004 |
| Plane 間認証 | Bearer 共有シークレット、常に 2 鍵 | 005 |
| 配信基盤 | Cloudflare Queues + D1（メタ）+ R2（本文） | 006 |
| 低遅延化 | Durable Object は任意。正しさの依存にしない | 007 |
| DP のホスト | 専用の OCI A1.Flex（arm64）1 台。agent-host に相乗りしない | 008 |
| DP の言語 | Go の単一静的バイナリ。Discord ライブラリを使わない | 009 |
| DP の常駐 | systemd system unit、`DynamicUser` + `LoadCredential` | 010 |
| DP のデプロイ | ピン留め済みバイナリの pull 型収束。tick をコード配布に使わない | 011 |
