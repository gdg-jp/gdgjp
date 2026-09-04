# Stage 08 — agents-index を吸収して一本化を完成させる

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 08。**依存: Stage 07。**

一本化の最終ステージ。bootstrap は Stage 07 で作成・検証済みなので、
ここでは**最後に残った 3 つ目のインストーラ**を吸収する。

**`agents-index/install.sh`（252 行）は同一ホスト上の 3 つ目のインストーラである。**

双方向に結合しており、暗黙の実行順序がある:

- agents-index → agents-local 方向: `agents-index/install.sh:18-20` のコメントが
  「OS ユーザー作成、index-proxy 配置、xangi 起動はやらない。それらは agents-local/install.sh（Stage 07）から来る」
  と明記。実際 `:156-158` は `gdgagent-svc` 不在で hard-fail し（エラー文言は
  "Run agents-local/install.sh first"）、`:160-162` は `/opt/gdg-agent/bin/index-proxy` 不在で hard-fail する
- agents-local → agents-index 方向: `agents-index/src/proxy.ts` は旧 `install-layout.sh:87-97` が
  `/opt/gdg-agent/lib/index-proxy.ts` へ配置し、`/opt/gdg-agent/bin/index-proxy` シムを作る
  （Stage 05 で `gdg agent-host emit-layout` に移送済み）

インストールするもの: `/opt/gdg-agent/bin/agents-index`、`/var/lib/agents-index/`（0700 `gdgagent-svc`）、
systemd unit `agents-index.service`（`gdgagent-svc` として実行、
`SupplementaryGroups=gdgwiki gdgagent-run-0..3`、`--run-root /run/gdg-agent --slots 4`）。

**`--slots 4` が spec の `slotCount` と二重管理になっている。** 1 つの spec に統合すれば
この不整合の余地自体が消える。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針
- `docs/agents-local-refactoring/07-converger-runtime.md` — 前段
- `agents-index/install.sh` — 全体（このステージで削除する）
- `agents-index/README.md` — サービスの役割
- `.github/scripts/agents-index-install.test.mjs` — 既存の drift テスト（置き換える）

### 再利用する既存実装

- **`cli/internal/agenthost/` の全リソース**（Stage 06/07）— agents-index の要素はすべて
  既存のリソース型（`file` / `dir` / `systemd` / `exec`）で表現できる。新しいリソース型を足さない

## Design — 設計

### 1. agents-index を spec と収束エンジンに吸収する

`agent-host/agent-host.json` に追加:

```jsonc
{
  "agentsIndex": {
    "enabled": true,
    "dataDir": "/var/lib/agents-index",
    "dbPath": "/var/lib/agents-index/index.db"
  }
}
```

`--slots` と `--run-root` は **spec の `slotCount` と `paths.runRoot` から導出する**。
二重管理をやめる。

収束エンジンに追加するリソース（すべて既存の型で表現する）:

- `dir` — `/var/lib/agents-index`（0700 `gdgagent-svc`）
- `file` — `/opt/gdg-agent/bin/agents-index`
- `systemd` — `agents-index.service`（`SupplementaryGroups` はスロット数から生成）
- 既に Stage 05 で移送済み: `/opt/gdg-agent/lib/index-proxy.ts` と `bin/index-proxy` シム

**順序依存が消えることが本質。** 1 つの `plan` の中で全リソースが展開されるので、
「agents-local を先に走らせろ」という hard-fail 自体が不要になる。

`agents-index/install.sh` と `.github/scripts/agents-index-install.test.mjs` を削除し、
アサーションは golden テスト（Stage 06/07 で確立）に統合する。

### 2. ドキュメント更新

- `agent-host/README.md` — `install.sh --activate` / `--reload-config` の記述を
  Stage 07 の対応表（`secrets import` / `apply --only`）に書き換える
  （bootstrap URL の復活は Stage 07 で完了済み）
- `agents-index/README.md` — 独立インストーラが無くなったことを反映
- `docs/agents-local-mvp/adr.md` — 一本化の完了を記録

### 制約

- **agents-index に新しいリソース型を作らない。** 既存の `dir` / `file` / `systemd` で表現する
- **`--slots` を spec から導出する。** リテラルで持たない（二重管理の再発防止）
- 第三者スクリプトの `| bash` を復活させない
- GitOps の配信機構（署名リリース、タイマー、ロールバック）は **Stage 09/10 の担当**

## Files to touch — 変更ファイル

### 新規
- `cli/internal/agenthost/agentsindex.go`（agents-index のリソース展開）

### 削除
- `agents-index/install.sh`（252 行）
- `.github/scripts/agents-index-install.test.mjs`（golden テストへ統合）

### 更新
- `agent-host/agent-host.json`, `agent-host/agent-host.schema.json`（`agentsIndex` セクション）
- `cli/internal/agenthost/testdata/golden/`（agents-index の unit とファイルを含む全量に拡張）
- `agent-host/README.md`（モード対応表。bootstrap URL は Stage 07 で復活済み）
- `agents-index/README.md`
- `docs/agents-local-mvp/adr.md`

## Verification — 完了条件と検証

### 完了条件

- **agent-host のプロビジョニング用シェルが `scripts/install-gdg-agent-host.sh` 1 本だけ**
  （**2 本 → 1 本**。開始時点の 7 本からの到達点。
  下の allowlist の節を参照。リポジトリ全体のシェルがゼロになるわけではない）
- `agents-index/install.sh` が存在しない
- `gdg agent-host apply` 1 コマンドで agents-index を含む全体が収束する
- `agents-index.service` の `--slots` が spec の `slotCount` から導出されている
- **agents-index が `/opt/gdgjp` を参照せず、自己完結した成果物から起動する**
  （Stage 13 の `/opt/gdgjp` 撤去の前提）
- `agent-host/README.md` の bootstrap URL が実在し、まっさらな Ubuntu で動く

### シェル一本化の適用範囲（allowlist）

「シェル 1 本」は **agent-host のプロビジョニング経路に限った話**であり、リポジトリ全体ではない。
実際に tracked な `.sh` は統合前で 10 本あり、以下は本計画の対象外として**残る**:

| ファイル | 残る理由 |
|---|---|
| `tinyurl/public/cli/install.sh` | `url.gdgs.jp/cli/install.sh` として配信される `gdg` CLI インストーラ。**bootstrap が参照する当のもの** |
| `scripts/dump-schema.sh` | スキーマダンプ。agent-host と無関係 |
| `scripts/migrate-cf-{1-export,2-import}.sh` | Cloudflare 移行スクリプト。無関係 |
| `scripts/migrate-wiki-{1-export,2-import}.sh` | wiki 移行スクリプト。無関係 |
| `agent-host/config/spawn-slot.sh` | **テンプレート**。`spawn-slot-<N>` として配置される実行対象であり、削除対象ではない |
| `agent-host/dev/{provision,activate,seed-iam,seed-gws-fake-token}.sh` | Lima 固有の前準備。Stage 07 で中身を `apply` 呼び出しに縮めるが、VM の起動手順として残る |

したがって CI の不変条件は `find` の総数ではなく、**明示的な allowlist との一致**で表現する。

### コマンド

```bash
git ls-files '*.sh' | sort
```

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

```bash
gdg agent-host render --spec agent-host/agent-host.json --out /tmp/golden && diff -r cli/internal/agenthost/testdata/golden /tmp/golden
```

```bash
sudo gdg agent-host apply --dry-run --diff && sudo gdg agent-host verify
```

### 回帰として固定すべきテスト

- **`git ls-files '*.sh'` の結果が checked-in の allowlist と完全一致する**
  （一本化の回帰防止。総数ではなく allowlist との一致で判定する。
  これが無いと「とりあえずスクリプトを足す」で元に戻る。
  新しいシェルを足したい場合は allowlist の変更が PR の diff に現れる）
- **allowlist に `agent-host/*.sh`（`dev/` と `config/spawn-slot.sh` を除く）が現れない**
  （agent-host のプロビジョニングが bootstrap 1 本であることの担保）
- **`slotCount` を変えると `agents-index.service` の `--slots` と `SupplementaryGroups` が追随する**
  （二重管理の再発防止）
- **agents-index のリソースが `apply` の単一の plan に含まれ、実行順序に依存しない**
  （旧 hard-fail が不要になったこと）
- **`agents-index.service` の `ExecStart` に `/opt/gdgjp` が現れない**
  （チェックアウト依存の断ち切り。ここが残ると Stage 13 で clone を消した瞬間に
  agents-index が起動しなくなる。`--dry-run --diff` では検出できない静かな経路）
- **`/opt/gdgjp` を削除した状態で `agents-index.service` が起動する**
- **`apply` を 2 回実行して 2 回目が 0 変更**（冪等性）

### 手動 E2E

1. Lima VM を**破棄して作り直す**（まっさらな Ubuntu から始める）
2. `curl -fsSL <bootstrap URL> | sudo bash` 相当を VM 内で実行する
   （ローカルファイルを使ってよいが、経路は同じにする）
3. `gdg` が `/usr/local/bin/gdg` に入り、`git-remote-gdg-wiki` symlink が作られていることを確認する
4. `gdg agent-host apply` が完走し、agents-index を含む全サービスが収束することを確認する
5. `sudo gdg agent-host verify` が 13 項目すべて ok を返すことを確認する
6. `systemctl --user status agents-index.service`（`gdgagent-svc` として）が active であることを確認する
6a. **`/opt/gdgjp` を一時的にリネームし**、`agents-index.service` を再起動して
    なお active であることを確認する（チェックアウト依存が残っていないこと）
7. `apply` をもう一度実行して 0 変更であることを確認する
8. `git ls-files '*.sh'` の結果が allowlist と一致し、
   `agent-host/` 配下に `dev/*.sh` と `config/spawn-slot.sh` 以外のシェルが無いことを確認する
9. **本番 `mincra-srv` では `--dry-run --diff` で agents-index 部分の差分がゼロであることを
   確認してから** `agents-index/install.sh` を削除する
