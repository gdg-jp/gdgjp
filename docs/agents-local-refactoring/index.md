# agent-host リファクタリング — 全体方針

`agents-local` を「本番エージェントそのもの」にするための段階計画の overview。

**この index は delegate しない。** 見出し規約（`## Context` / `## Design` / `## Files to touch` /
`## Verification`）にも従っていない。実装は `01`〜`14` の各ステージファイルを 1 つずつ
`/cursor:from-plan` に渡すこと。

## 目指す状態

1. `agent-host/workspace/.agents/skills/` にスキルを足して push → **本番のエージェントがそのスキルを使えるようになる**
2. spec の `backend.name` を `cursor` → `antigravity` に変えて push → **本番のバックエンドが入れ替わる**
3. リポジトリの HEAD が本番ホストの構成と一致していることが、常に機械的に検証されている
4. **agent-host のプロビジョニング用シェルが bootstrap 1 本（約 40 行）だけになっている**
   （リポジトリ全体ではない。`tinyurl/public/cli/install.sh` や `scripts/migrate-*.sh` などは
   対象外として残る。適用範囲は下の「一本化の到達点」と Stage 08 の allowlist を参照）

現状はこのどれも成立していない。ホストへの反映は operator が `mincra-srv` に ssh して
`sudo ./agents-local/install.sh --reload-config` を手で叩く運用で、デプロイ CI は存在しない。

## 解く 2 つの問題

**問題 A: 現状の構成では GitOps が乗らない。**
宣言的な desired state と冪等な収束が無い。プロビジョニング用シェル 7 本・約 1,755 行が同じホストを構築しており、
`AGENT_MODEL` すら heredoc 内のリテラル。ピン留めも不統一で、`cursor-agent` は第三者の
`releases/latest` を root で `| bash` している。

**問題 B: バックエンド換装は現状「設定変更」ではなく「セキュリティモデルの変更」である。**
`agents-local/README.md` が "none of which is optional in production" と書く 3 層が、
バックエンドによって有無が変わる。

| 層 | cursor | antigravity |
|---|---|---|
| preToolUse ゲート（唯一の workdir 内 ACL 境界） | Cursor CLI の `~/.cursor/hooks.json`, `failClosed: true` | **無い**（xangi `src/hooks.ts` にバックエンド分岐は無い） |
| uid 分離（slot 実行） | `cursor-cli.ts:136-161` の `assertSlotLauncher` → `sudoLauncherArgs` | **無い**（`antigravity-cli.ts` は素の `spawn()`） |
| OS サンドボックス | `cli-config.json` の `sandbox.mode` + `readBoundary: workspace` | **無い**（`antigravity-cli.ts:137` は `--dangerously-skip-permissions` を渡す経路を持つ） |

つまり要求 2 は「spec の 1 行を変える」では実現できず、**バックエンド能力契約**という抽象の新設が要る。

## 一本化の到達点

**プロビジョニング用シェル 7 本・約 1,755 行 → bootstrap 1 本・約 40 行 + `gdg agent-host`（Go）。**

```
scripts/install-gdg-agent-host.sh   ← 残る唯一のシェル
  (a) Ubuntu 判定  (b) apt-get install -y curl ca-certificates
  (c) spec の version + sha256 でピンした gdg を取得
  (d) exec gdg agent-host apply --spec ...
        └─ gdg agent-host（Go）… 以降すべて
```

`install.sh` 側ではなく `gdg` CLI に寄せる理由: GitOps の pull 型配信に必要な署名検証・
`--dry-run`/`--diff`・冪等収束・ロールバックは bash の仕事ではない。加えて**収束エンジンの
読み取り側は既に `gdg` の中にある**（`cli/internal/wiki/hooks.go:131` `inspectInstalledScripts` が
`/opt/gdg-agent/lib/*` と内容比較して stale を報告している）。

bootstrap の 1 本だけは原理的に消せない — `gdg` がホストに存在する前に何かが `gdg` を取ってくる
必要がある。ただし責務はその 40 行に閉じ、public raw URL が要るのもそれだけになる。
**この bootstrap は `install.sh` を削除する前（Stage 07 内）に作り、
まっさらな VM で検証する。**

> **「シェル 1 本」は agent-host のプロビジョニング経路に限った話**であり、リポジトリ全体ではない。
> `tinyurl/public/cli/install.sh`（`url.gdgs.jp/cli/install.sh` の実体。bootstrap が参照する当のもの）、
> `scripts/migrate-*.sh`、`scripts/dump-schema.sh`、`agent-host/config/spawn-slot.sh`（テンプレート）、
> `agent-host/dev/*.sh`（Lima 前準備）は対象外として残る。
> CI の不変条件は `find` の総数ではなく **allowlist との一致**で表現する（Stage 08）。

### スクリプト本数の推移

agent-host のプロビジョニング用スクリプトのみを数える
（`agent-host/dev/*.sh` と `agent-host/config/spawn-slot.sh`（テンプレート）は対象外）。

| 時点 | 増減 | 本数 |
|---|---|---|
| 開始 | `install.sh`(853), `setup.sh`(207), `lib/install-layout.sh`(179), `scripts/gdg-agent/install-layout.sh`(179), `lib/apply-ownership.sh`(54), `agents-index/install.sh`(252), `scripts/setup-gdg-agent.sh`(31) | **7** |
| 03 統合 | −`scripts/gdg-agent/install-layout.sh`（重複）, −`scripts/setup-gdg-agent.sh` | **5** |
| 04 spec | −`setup.sh`, **+`lib/verify.sh`**（13 検査の退避先） | **5** |
| 05 embed | −`lib/install-layout.sh`, −`lib/apply-ownership.sh` | **3** |
| 07 収束 | **+bootstrap**(~40), −`install.sh`, −`lib/verify.sh`（Go の `verify` へ移送） | **2** |
| 08 仕上げ | −`agents-index/install.sh` | **1** |

> **04 で純減がゼロなのは意図的。** `setup.sh:143-185` の 13 検査は固有のロジックなので、
> Go の `gdg agent-host verify`（Stage 07）へ移すまで `lib/verify.sh` として退避する。
> 「`setup.sh` を消した」ことと「本数が減った」ことは別である。

## ステージ一覧

| # | ファイル | 内容 | 規模 | ホストへの影響 |
|---|---|---|---|---|
| 01 | `01-ci-predicate.md` | CI を実際に発火させる | 数時間 | 無 |
| 02 | `02-public-content-review.md` | 公開前コンテンツレビュー（**不可逆・人間の判断**） | 数時間 | 無 |
| 03 | `03-consolidate-agent-host.md` | `agent-host/` へ統合、ミラー解消 | 数日 | 無 |
| 04 | `04-spec-pins-drop-setup-sh.md` | spec 導入・ピン留め・`setup.sh` 削除・sudoers バグ修正 | 数日 | 中 |
| 05 | `05-embed-acl-emit-layout.md` | `acl.ts` を `go:embed`、`emit-layout`、layout 系シェル削除 | 1〜2 週 | 中 |
| 06 | `06-converger-core.md` | 収束エンジン中核 + ファイル/ユーザー系リソース | 2〜3 週 | 中 |
| 07 | `07-converger-runtime.md` | systemd/apparmor/パッケージ系、**bootstrap 新設**、`install.sh` 撤去、`verify` | 2〜3 週 | 大 |
| 08 | `08-unify-bootstrap.md` | `agents-index/install.sh` 吸収、一本化の完成 | 1 週 | 中 |
| 09 | `09-workspace-sync.md` | **署名基盤** + **Tier 1**: スキルを push したら本番に載る | 2 週 | 中 |
| 10 | `10-control-plane-release.md` | **Tier 2**: リリース世代管理 + pull 型適用 + ロールバック | 2 週 | 大 |
| 11 | `11-backend-capability-contract.md` | バックエンド能力契約（fail closed） | 1 週 | 小 |
| 12 | `12-xangi-slot-isolation.md` | slot 分離をアダプタから引き剥がす（xangi 側） | 1〜2 週 | 中 |
| 13 | `13-xangi-packaging.md` | `gdg-lib` publish、org 移管、`dist/` 化 | 1〜2 週 | 大 |
| 14 | `14-antigravity-backend.md` | Antigravity 対応（**疎通確認がブロッキング**） | 未確定 | 大 |

## 依存グラフ

```
01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10
                      │                        ↑
                      └→ 11 ───────────────────┘
                          ├→ 12 ─┐
                          └──────┴→ 14

                      04 → 13   （/opt/gdgjp 削除のみ 07・08 の完了が前提）
```

辺の一覧:

| 辺 | 理由 |
|---|---|
| `01 → 02 → 03 → 04` | CI が動く → 公開判断 → 統合 → spec |
| `04 → 05 → 06 → 07 → 08` | 収束エンジンの構築順序 |
| `08 → 09 → 10` | 一本化 → 署名基盤 + Tier 1 → Tier 2 |
| `04 → 11` | 能力契約は spec スキーマの上に載る |
| **`11 → 10`** | Stage 10 のリリース CI が `backend.isolation` 検査・`productionMinimum` 検査・`environment` ゲートを要求する。**11 無しに 10 を始めると、その 3 つが無いまま自動 publish が動く** |
| **`11 → 12`** | Stage 12 は `cli/internal/agenthost/backend.go` の能力レジストリを更新する。そのファイルは Stage 11 が作る |
| `07 → 12` | slot 起動の契約（`exec-spawn.ts`）が固まっていること |
| `11 → 14`, `12 → 14` | Antigravity は能力契約と slot 分離の両方を前提とする |
| **`07 → 13`, `08 → 13`** | `/opt/gdgjp` の**削除だけ**は、langfuse-forwarder（07）と agents-index（08）のパッケージ化が前提。**xangi の org 移管と `gdg-lib` publish 自体は 04 の後すぐ始めてよい** |

**並行可能**:
- `11`（能力契約）は `05`〜`08` と並行してよい。`06` の spec 型定義と衝突するので、
  スキーマ定義だけ先に `04` 直後に固めるのが安全。**ただし `10` と `12` の開始前に完了していること**
- `13`（xangi packaging）の org 移管と `gdg-lib` publish は `05`〜`08` と並行可。
  **`/opt/gdgjp` の削除だけは `07`・`08`・`13` の 3 つすべてが終わって初めて成立する**
- `12`（xangi の slot 分離引き上げ）は `08`〜`10` と並行可（`11` の完了後）

**直列が必須**:
- `01` は全体の前提。これ無しに以降の変更は一切検証されない
- `02` は不可逆なゲート。`03` の squash import より前に必ず終える
- `06 → 07` はリソース移行の順序そのもの（`07` は `06` のエンジンに乗る）
- **`07` の内部順序**: bootstrap 作成 → まっさらな VM で検証 → `install.sh` 削除。
  順序を逆にすると `gdg` をホストに持ち込む手段が無くなる
- `09 → 10` は Tier 1 で配信機構を検証してから Tier 2 の大きいブラスト半径に進む。
  **署名・検証・鍵管理の共通基盤は `09` が提供し、`10` が再利用する**
  （SHA-256 のみのマニフェストは真正性を与えないので暫定手段にもならない）
- **`11 → 10`**: 能力契約・`productionMinimum`・`environment` ゲートが無いまま自動 publish を動かさない
- **`07`・`08` → `13` の `/opt/gdgjp` 削除**: langfuse-forwarder と agents-index が
  チェックアウトから実行される限り、clone を消すと本番が止まる

## リスクと前提

**本番ホストは稼働中で、デプロイ CI が無い。** したがって各ステージは単独で出荷可能であり、
完了時点でホストは常に動く状態を保つこと。本番 `mincra-srv` へ触る前に必ず
`gdg agent-host apply --dry-run --diff` で差分をレビューする。

**`02` は取り消せない。** リポジトリを public にすると git 履歴も公開される。
`ENVIRONMENT.md`（ホスト名・operator アカウント・パス台帳）、Discord サーバー/チャンネル ID、
**未公開の DevFest タイムテーブル草案（private Google Sheets の URL 付き）**が含まれている。

**`10` 以降、リポジトリへの push は本番ホストの root 相当になる。** branch protection、
署名コミット、リリース署名鍵の管理を `02` の公開判断と同格で扱う。あわせて
「エージェントから到達できるどの経路もリリース生成リポジトリへ push できない」を
不変条件としてテストで固定する（`10`）。

**`14` は疎通確認がブロッキング。** `agy` CLI に fail-closed なプログラム的 pre-tool フックが
無い場合、ACL 境界の強度が下がる。下がることを受け入れるかは別途判断が要る。
確認せずに実装を始めない。

## 判断の記録

以下は決定済み。`docs/agents-local-mvp/adr.md` に追記すること（`04` の担当）。

| 論点 | 決定 | 理由 |
|---|---|---|
| 収束エンジン | `gdg` CLI の Go サブコマンド | 読み取り側が既に存在、単一バイナリ、TS+Go の既存構成に収まる |
| Ansible / NixOS | 不採用 | NixOS は cursor-agent の AppArmor がパス固定・sudoers/sandbox allowlist が安定パス前提・xangi が packaging 未解決で詰む |
| Ansible への切替基準 | 2 台目のホスト / inventory が要る / Go 収束エンジンが約 2,000 行超 | いずれかが起きたら再検討する |
| リポジトリ | agents-local を完全に public 化 | `03` で monorepo へ統合 |
| 配信方式 | pull 型 | public repo で self-hosted runner は fork PR からのコード実行経路。ssh デプロイは CI に root 相当を持たせる |
| xangi | ref ピン + `gdg-jp` org 移管 + `gdg-lib` publish | `04` / `13` |
