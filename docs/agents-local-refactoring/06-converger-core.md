# Stage 06 — 収束エンジン中核とファイル/ユーザー系リソース

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 06。**依存: Stage 05。並行可: Stage 11, Stage 13。**

Stage 05 で `gdg agent-host emit-layout` がレイアウトツリーを生成できるようになった。
このステージではそれを一般的な**収束エンジン**（desired state と実状態を比較し、差分だけを適用する）
に育て、`install.sh` のうちファイル・ディレクトリ・ユーザー・sudoers・tmpfiles を扱う部分を移す。

systemd / apparmor / パッケージ取得は Stage 07 の担当。ここでは踏み込まない。

### なぜ Go / `gdg` CLI なのか（決定済み、`docs/agents-local-mvp/adr.md` 参照）

- GitOps の pull 型配信に必要な署名検証・`--dry-run`/`--diff`・冪等収束・ロールバックは bash の仕事ではない
- **収束エンジンの読み取り側は既に `gdg` の中にある**: `cli/internal/wiki/hooks.go:131`
  `inspectInstalledScripts` が `/opt/gdg-agent/lib/*` と内容比較して `"stale %s at %s"` を返す。
  `fileMatches`(:44) も既にある。このステージは**書き込み側を足す**作業であって、ゼロからの実装ではない
- `gdg` は既にホストに入っており（`install.sh:366-393`）、既に特権サブコマンド
  `gdg agent-host workspace-token`（`cli/internal/command/agent_workspace_token.go`）を持つ

### スコープ制限（Ansible の劣化版を作らないための唯一の防御）

パッケージの doc comment に以下を書き、逸脱をレビューで弾く:

> This converger provisions exactly one localhost of exactly one distro.
> No transport, no inventory, no `--limit`, no loops or conditionals in the spec.

**Ansible へ切り替える判断基準**（`adr.md` に記録済み）: 2 台目のホストが要る / inventory が要る /
Go 収束エンジンが約 2,000 行を超えた。いずれかが起きたら再検討する。

### 現状で修正が必要な既知の欠陥

**slot 縮小時の後始末が無い。** `GDG_AGENT_SLOT_COUNT` を下げると sudoers / tmpfiles は再生成で
該当行が消え、`bin/` も `rm -rf` で消えるが、以下が残る:

- `gdgagent-run-N` の OS ユーザーとグループ
- `/home/gdgagent-run-N/`（root 所有 0444 のポリシーファイル群を含む）
- `/run/gdg-agent/N`
- **`/home/gdgagent-run-N/.config/cursor/auth.json`（0600）**

孤児 uid が生きた Cursor 認証情報を保持し続ける。整頓の問題ではなくセキュリティ上の指摘事項であり、
このステージの `--prune` で解決する。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針
- `docs/agents-local-refactoring/05-embed-acl-emit-layout.md` — 前段。`emit-layout` の実装
- `cli/internal/wiki/hooks.go` — `fileMatches`(:44), `inspectInstalledScripts`(:131)
- `agent-host/install.sh` — `create_users`(:231-259), `maybe_reexec_root`(:272-279),
  `as_svc`(:298 付近), `operator_home`(:285-289)
- `git log` で削除された `agent-host/lib/apply-ownership.sh` — chown/chmod の完全な仕様
- `cli/internal/command/agent_workspace_token.go` — 既存サブコマンドの構造とフラグ規約

### 再利用する既存実装

- **`cli/internal/wiki/hooks.go:44` `fileMatches`** — `file` リソースの差分検出の半分。書き直さない
- **`cli/internal/wiki/hooks.go:131` `inspectInstalledScripts`** — 「望ましい状態 vs 実状態」の
  既存パターン。`plan` フェーズの手本にする
- **Stage 05 の `cli/internal/agenthost/layout.go`** — レイアウト生成。これを `file` / `dir` /
  `template` リソースの上に載せ替える
- **`agent-host/install.sh:231-259` `create_users`** — `groupadd --system` / `useradd --system`/
  `usermod -aG` の正確な引数。Go 移植元

## Design — 設計

### 1. エンジンの骨格（約 350 行）

```
cli/internal/agenthost/
  spec.go       — agent-host.json のパース、overlay 適用（agent-host.dev.json）
  plan.go       — desired state を Resource のリストに展開し、実状態と比較して Change を出す
  apply.go      — Change を順序どおり適用、変更追跡（handler 起動用）
  resource.go   — Resource インターフェース
  resource_*.go — 各リソース実装
```

`Resource` インターフェースは最小に保つ:

```go
type Resource interface {
    ID() string
    Plan(ctx context.Context) (Change, error)   // 現状を読み、必要な変更を返す
    Apply(ctx context.Context, c Change) error
}
```

`Change` は「変更なし / 作成 / 更新 / 削除」と、`--diff` 用の人間可読な差分を持つ。

**順序は宣言順の固定**とし、依存解決グラフを作らない（スコープ制限）。
`plan` が全リソースを走査してから `apply` するので、`--dry-run` は `plan` で止めるだけ。

### 2. このステージで実装するリソース

| リソース | 見積 | 内容 |
|---|---|---|
| `file` | ~120 | bytes + mode + uid/gid。**temp-write → rename**（部分書き込みが live にならない） |
| `dir` | ~60 | mode（setgid `2770` / sticky `1775` を含む）+ 所有者 |
| `symlink` | ~30 | `ln -sfn` 相当の収束 |
| `template` | ~0 | `text/template` + `file`。新しい機構を作らない |
| `user` / `group` + **prune** | ~150 | `getent` で読み、`groupadd`/`useradd`/`usermod`。**宣言外の slot ユーザーを削除する** |
| `sudoers` | ~40 | `file` + rename **前**に `visudo -cf <tmp>`。Stage 04 の修正を型として固定 |
| `tmpfiles` | ~30 | `file` + 変更時のみ `systemd-tmpfiles --create` |
| エンジン | ~350 | 上記の骨格 |
| **小計** | **~780** | |

### 3. サブコマンド

```
gdg agent-host apply --spec agent-host.json [--dry-run] [--diff] [--only <resource>] [--prune]
gdg agent-host render --spec agent-host.json --out DIR
```

- `--dry-run` — `plan` のみ。**終了コードで差分の有無を返す**（Stage 10 の drift 検査で使う）
- `--diff` — 変更内容を人間可読に出す
- `--only <resource>` — リソース種別を限定。**`install.sh` からの段階移行に必須**
- `--prune` — 宣言外のリソース（余った slot ユーザーなど）を削除する。**既定は off**

`render` は golden テスト用に、ホストに触れずツリー全体をディレクトリに書き出す。

### 4. `--prune` の設計（セキュリティ修正）

`slotCount` を下げたとき、`gdgagent-run-<N>`（N >= slotCount）について:

1. `/run/gdg-agent/N` を削除
2. `/home/gdgagent-run-N/` を削除（**`~/.config/cursor/auth.json` を含む**）
3. `userdel` / `groupdel`

**既定を off にする理由**: 誤った spec で本番のユーザーを消すのは取り返しがつかない。
`--prune` を明示したときだけ実行し、`--dry-run --prune --diff` で必ず事前確認できるようにする。
削除前に「そのユーザーで動いているプロセスが無いこと」を確認し、あれば失敗させる。

### 5. `install.sh` からの段階移行

各リソース類ごとに以下を回す。**1 リソース種別ごとに本番へ出荷する。**

1. Go 実装 + golden テストを書く
2. Lima VM で `--dry-run --diff` が「変更なし」を報告することを確認（= 既存 bash と等価）
3. 本番で `--dry-run --diff` を確認してから `apply --only <resource>`
4. `install.sh` の該当関数を `gdg agent-host apply --only <resource>` の呼び出しに置換

このステージでの順序: **レイアウトファイル（Stage 05 で完了）→ tmpfiles → sudoers →
users/groups（prune 付き）**。

### 6. 特権とヘルパー

- `install.sh:272-279` `maybe_reexec_root` に相当する root 昇格の扱いを決める。
  bootstrap（Stage 08）が root で `gdg agent-host apply` を exec する前提にし、
  Go 側は「root で無ければ失敗」とするのが単純
- `install.sh` の `as_svc`（`gdgagent-svc` として実行）は Stage 07 の systemd リソースで要る。
  ここでは `user`/`dir` の所有者設定に留める

### 制約

- **`sandbox.json` / `permissions.json` / `hooks.json` の中身をモデル化しない。**
  バックエンド側のスキーマであり、再モデル化すると相手の変更で腐る。
  `.in` + プレースホルダ置換のまま `template` リソースに載せる
- **spec に secrets を入れない。** Stage 07 で `gdg agent-host secrets set` として分離する
- **transport / inventory / `--limit` / spec 内のループや条件分岐を作らない。** スコープ制限
- **3 層の信頼境界を弱めない**（`docs/agents-local-mvp/07-agent-uid-isolation.md`）。
  特に `additionalReadonlyPaths` に親ディレクトリ `/run/gdg-agent` を入れない
  （スロット間分離が壊れる）
- systemd / apparmor / apt / tarball / git / npm は **Stage 07 の担当**。ここでは触らない
- `--prune` の既定を on にしない

## Files to touch — 変更ファイル

### 新規
- `cli/internal/agenthost/spec.go`
- `cli/internal/agenthost/plan.go`
- `cli/internal/agenthost/apply.go`
- `cli/internal/agenthost/resource.go`
- `cli/internal/agenthost/resource_file.go`
- `cli/internal/agenthost/resource_dir.go`
- `cli/internal/agenthost/resource_symlink.go`
- `cli/internal/agenthost/resource_user.go`
- `cli/internal/agenthost/resource_sudoers.go`
- `cli/internal/agenthost/resource_tmpfiles.go`
- `cli/internal/agenthost/*_test.go`
- `cli/internal/agenthost/testdata/golden/`（`render` の出力を固定）

### 更新
- `cli/internal/command/agent_host.go`（`apply` / `render` サブコマンド）
- `cli/internal/agenthost/layout.go`（Stage 05 の実装をリソースの上に載せ替える）
- `agent-host/install.sh`（該当関数を `apply --only` 呼び出しに段階置換）
- `.github/scripts/gdg-agent-layout.test.mjs`（アサーションを golden テストへ移行開始）

## Verification — 完了条件と検証

### 完了条件

- `gdg agent-host apply --dry-run --diff` が Lima VM と本番ホストの両方で**変更なし**を報告する
  （= 既存 bash と等価に収束している）
- `render` の出力が golden ファイルとして固定され、`go test` で差分検査される
- `slotCount` を下げて `--prune` すると、孤児ユーザーと `auth.json` が消える
- `install.sh` からファイル・ユーザー・sudoers・tmpfiles の生成ロジックが消えている

### コマンド

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

```bash
gdg agent-host render --spec agent-host/agent-host.json --out /tmp/golden && diff -r cli/internal/agenthost/testdata/golden /tmp/golden
```

```bash
sudo gdg agent-host apply --spec agent-host/agent-host.json --dry-run --diff
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`apply` を 2 回実行して 2 回目が 0 変更を報告する**（冪等性。収束エンジンの最重要性質であり、
  これが崩れると GitOps の drift 検査が常に差分を出して意味を失う）
- **`slotCount` を 4 → 2 に下げて `--prune` した後、`gdgagent-run-2/3` のユーザー・home・
  `~/.config/cursor/auth.json` が消えている**（現状は孤児 uid が生きた認証情報を保持し続ける）
- **`--prune` 無しでは孤児ユーザーを消さない**（既定 off の担保）
- **不正な sudoers を生成しようとしても稼働中の `/etc/sudoers.d/gdg-agent` が壊れない**
  （validate-then-rename が Go 実装でも効いていること）
- **`file` リソースが部分書き込みを live にしない**（temp-write → rename。
  途中で失敗させたとき、既存ファイルが無傷であること）
- **`render` の出力が `emit-layout`（Stage 05）と一致する**（載せ替えの等価性）
- **意味的不変条件**（パース済み出力に対して。ソースの正規表現ではなく）:
  - sudoers にワイルドカードが無い
  - `additionalReadonlyPaths` が `/run/gdg-agent/N` を含み、**親の `/run/gdg-agent` を含まない**
  - sandbox に `.config/gdg` / `.config/xangi` が含まれない
  - `hooks.preToolUse[0].failClosed === true`

### 手動 E2E

1. Lima VM を起動し、**変更前の状態**で `agent-host/dev/provision.sh` を通す
2. 本ステージを実装する
3. VM で `sudo gdg agent-host apply --dry-run --diff` を実行し、**変更なし**であることを確認する
   （既存の bash が作った状態と Go の desired state が一致していること）
4. `sudo gdg agent-host apply` を実行し、続けてもう一度実行して 2 回目が 0 変更であることを確認する
5. `agent-host.dev.json` の `slotCount` を 2 に下げ、`apply --dry-run --prune --diff` で
   削除対象を確認してから `apply --prune` を実行する
6. `id gdgagent-run-3` が失敗し、`/home/gdgagent-run-3` が存在しないことを確認する
7. `agent-host/lib/verify.sh` の 13 検査がすべて ok になることを確認する
8. **本番 `mincra-srv` では `--dry-run --diff` のみを実行し、変更なしであることを確認してから**
   リソース種別ごとに `apply --only` を進める
