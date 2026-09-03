# Stage 05 — acl.ts を go:embed し、レイアウト生成を gdg へ移す

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 05。**依存: Stage 04。**

ピン留めに次いでリスクを大きく下げるステージ。ホストから node・pnpm・corepack・monorepo clone を外す。

### なぜホストが monorepo clone を必要としているのか

`cli/internal/wiki/hooks.go:12-31` は既に hook スクリプトを `//go:embed` している:

```go
//go:embed hooks/acl-gate.ts
//go:embed hooks/wk.ts
//go:embed hooks/acl-core.ts
//go:embed hooks/shell-allowlist.ts
//go:embed hooks/commit-tripwire.ts
//go:embed hooks/acl-insert-core.ts
//go:embed hooks/package.json
```

**`acl.ts` だけが embed されていない。** 理由は単純で、これは gitignore 対象のビルド生成物だから
（`cli/internal/wiki/hooks/.gitignore` の中身は `acl.ts` の 1 行）。
生成元は `gdg-lib/package.json:21`:

```
"build:acl": "esbuild src/acl/agent.ts --bundle --format=esm --platform=neutral --banner:js='// @ts-nocheck' --outfile=../cli/internal/wiki/hooks/acl.ts"
```

この 1 点のために `agent-host/install.sh` は以下をすべて抱えている:

| 関数 | 行 | 役割 |
|---|---|---|
| `ensure_gdgjp` | :86-114 | `/opt/gdgjp` へ monorepo を clone し submodule を init |
| `resolve_layout_dir` | :64-72 | gdgjp チェックアウトの位置解決 |
| `ensure_pnpm` | :141-152 | `corepack enable` + `corepack prepare pnpm@9.15.0` |
| `build_acl` | :212-229 | `pnpm install --frozen-lockfile --filter @gdgjp/gdg-lib...` + `pnpm build:acl` |
| `install_node_if_needed` | :123-139 | NodeSource から Node 22 を入れる |

加えて `GDG_SKIP_CLONE` / `GDG_SKIP_BUILD` というテスト用の脱出ハッチも存在する。

### 正直に書いておくべき制約

**`/opt/gdgjp` は clone がビルド入力であると同時に、xangi の実行時依存でもある。**
`agent-host/ENVIRONMENT.md:36` の通り、xangi の `@gdgjp/gdg-lib` は
`file:../gdgjp/gdg-lib` → `/opt/gdgjp/gdg-lib` に解決される。

したがって **このステージ単独では `/opt/gdgjp` は消えない。** 消えるのは
「hook 配置経路からの monorepo 依存」まで。clone の完全撤去は Stage 13（xangi packaging）完了後。
これを勘違いして `ensure_gdgjp` を丸ごと削ると xangi が起動しなくなる。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針
- `cli/internal/wiki/hooks.go` — 全体（`//go:embed` 群 :12-31、`fileMatches` :44、
  `inspectInstalledScripts` :131）
- `agent-host/lib/install-layout.sh` — 全体（このステージで削除する）
- `agent-host/lib/apply-ownership.sh` — 全体（同上）
- `docs/agents-local-mvp/01-acl-evaluator-gdg-lib.md:123-136` — esbuild の出力先が
  `cli/internal/wiki/hooks/acl.ts` である理由（相対 import 解決のため load-bearing）
- `agent-host/ENVIRONMENT.md:36, 184-187` — `/opt/gdgjp` が xangi の実行時依存である記述

### 再利用する既存実装

- **`cli/internal/wiki/hooks.go` の `//go:embed` 群と `fileMatches`(:44)** — 同じ形式で `acl.ts` を追加する
- **`cli/internal/wiki/hooks.go:131` `inspectInstalledScripts`** — `/opt/gdg-agent/lib/*` と
  内容比較して `"stale %s at %s"` を返す既存の**差分検出**。Stage 06 の収束エンジンの読み取り側でもある。
  このステージの `emit-layout` はこの逆操作にあたる
- **`agent-host/lib/install-layout.sh`** — 生成すべきツリーの完全な仕様。Go への移植元。
  特に :83 の 9 ファイル manifest、:110-134 の sudoers/tmpfiles、:137-170 のスロット別ファイル
- **`agent-host/lib/apply-ownership.sh`** — chown/chmod/apparmor/tmpfiles/linger の仕様。同じく移植元
- `cli/internal/command/agent_workspace_token.go` — 既存の特権 `gdgagent-svc` サブコマンド。
  `gdg agent-host` の配置とフラグ規約はこれに合わせる

## Design — 設計

### 1. `acl.ts` を embed する

1. `cli/internal/wiki/hooks.go` に `//go:embed hooks/acl.ts` を追加する
2. `gdg` のリリースビルドで `pnpm build:acl` を**先に走らせる**ようにする。
   既に `.github/workflows/ci.yml:121` と `deploy.yml:60` が Go テスト前に `pnpm build:acl` を
   実行しているので、リリースビルドにも同じステップを入れる
3. **esbuild の出力先は変えない。** `docs/agents-local-mvp/01-acl-evaluator-gdg-lib.md:123-136` の通り、
   兄弟の hook ファイルが `./acl.ts` を相対 import しており、リポジトリ内と
   `/opt/gdg-agent/lib/` の両方で同じ specifier が解決される必要がある

### 2. `gdg agent-host emit-layout --prefix DIR`

`agent-host/lib/install-layout.sh` が生成するツリーと**同一の出力**を、node・pnpm・monorepo clone
無しで生成するサブコマンドを作る。

移植対象（`install-layout.sh` の全体）:

| 生成物 | 元 | 備考 |
|---|---|---|
| `/opt/gdg-agent/lib/` の 9 ファイル | :83 | `acl-gate.ts wk.ts gws.ts acl-core.ts shell-allowlist.ts commit-tripwire.ts acl-insert-core.ts acl.ts exec-spawn.ts` + `package.json`。**`gws.ts` と `exec-spawn.ts` は現在 embed されていない**ので追加が要る |
| `/opt/gdg-agent/lib/index-proxy.ts` | :87-97 | `agents-index/src/proxy.ts` から。**embed 方法は下の「2a」を参照** |
| `/opt/gdg-agent/bin/{wk,gws,index-proxy}` | :93-109 | インライン heredoc のラッパー |
| `/opt/gdg-agent/bin/spawn-slot-<N>` | :166 | `config/spawn-slot.sh` の `__SLOT__` 置換 |
| `~gdgagent-run-N/.cursor/sandbox.json` | :156 | `config/sandbox.json.in` の `__RUN_SLOT_DIR__` 置換 |
| `~gdgagent-run-N/.cursor/mcp.json` | :159-160 | `config/mcp.json.in` の `__INDEX_SOCKET__` 置換 + `config/extra-mcp.json` の Node マージ（base 優先） |
| `~gdgagent-run-N/.cursor/{hooks,cli-config,permissions}.json` | :154-163 | `config/` から配置 |
| `/etc/sudoers.d/gdg-agent` | :110-123 | **Stage 04 の validate-then-rename を Go でも維持する** |
| `/etc/tmpfiles.d/gdg-agent.conf` | :125-135 | |

**冪等性の既存工夫を引き継ぐ**: `install-layout.sh:70-72` の `writable()`（0444 のファイルを
上書きする前に `chmod u+w` する）と、:77 の `rm -rf "$AGENT_ROOT/bin"`（退役した
`google-workspace-mcp` ラッパーを消すための converge-by-deletion）。
Go 側では前者は「temp-write → rename」で自然に解決し、後者は「宣言された bin 以外を削除する」
明示的な収束として実装する。

### 2a. パッケージ外のソースをどう embed するか

**`go:embed` はパッケージディレクトリの外を参照できない。** パターンに `..` は書けず、
モジュール境界も越えられない。`cli/go.mod` のモジュールルートは `cli/` なので、
`cli/internal/agenthost/` から `agents-index/src/proxy.ts` を直接 embed することは**できない**。

`acl.ts` が成立しているのは、esbuild が**パッケージディレクトリの中に**出力しているからである
（`gdg-lib/package.json:21` の `--outfile=../cli/internal/wiki/hooks/acl.ts`）。
`hooks.go` は同じディレクトリのファイルを embed しているにすぎない。

**同じ方式を踏襲する**: パッケージ内に正本のアセット置き場を作り、
**決定的なコピー/生成ステップ**でそこへ配置し、**CI で同一性を検査する**。

| ファイル | 正本 | パッケージ内の配置先 | 配置方法 |
|---|---|---|---|
| `acl.ts` | `gdg-lib/src/acl/agent.ts` | `cli/internal/wiki/hooks/acl.ts` | 既存の `pnpm build:acl`（esbuild）。**変更しない** |
| `proxy.ts` | `agents-index/src/proxy.ts` | `cli/internal/agenthost/assets/index-proxy.ts` | 決定的コピー（`pnpm sync:agent-host-assets` 等） |
| `gws.ts` / `exec-spawn.ts` | `cli/internal/wiki/hooks/` | 同左（既にパッケージ内） | `//go:embed` を追加するだけ |

- コピーは**生成物**として `.gitignore` するか、commit して CI で同一性を検査するかを選ぶ。
  **`acl.ts` は gitignore されている**ので、揃えるなら gitignore + ビルド時生成が一貫する。
  ただしその場合、`go build` 単体では失敗するようになるため、
  **リリースビルドとローカル開発の手順にコピーステップを明記すること**
- **CI で「コピー先が正本と一致する」ことを検査する。** ずれると、
  ホストに配置される `index-proxy.ts` が `agents-index` 本体と食い違い、
  JSON-RPC の nonce 注入（`proxy.ts:23`）が壊れても気づけない

### 3. `emit-layout` を `install.sh` から呼ぶ

このステージでは**まだ収束（chown/systemd/users）はしない**。`install.sh` の
レイアウト生成部分だけを `gdg agent-host emit-layout` の呼び出しに置き換える。

- `apply-ownership.sh` の chown/chmod/apparmor/tmpfiles/linger も Go に移す
  （`emit-layout` が `--apply-ownership` フラグで行うか、`gdg agent-host apply --only layout` とするかは実装判断。
  Stage 06 のリソースモデルに素直に繋がる形を選ぶ）

### 4. プロビジョニング用シェル 5 本 → 3 本

- `agent-host/lib/install-layout.sh`（179 行）を削除
- `agent-host/lib/apply-ownership.sh`（54 行）を削除
- `install.sh` から `ensure_pnpm` / `build_acl` / `GDG_SKIP_BUILD` を削除
- `install.sh` から `install_node_if_needed` を削除できるかは、**xangi が node を要るので不可**。
  ただし「hook 実行のための node」と「xangi のための node」を分離して記述し、
  Stage 13 後にどちらが残るかを明確にしておく
- **`ensure_gdgjp` / `resolve_layout_dir` は残す。** xangi の `file:` 依存のため。
  ただし用途を「xangi の gdg-lib 解決のみ」に縮小し、コメントで Stage 13 での撤去を明記する

### 5. `gdg` の doctor 経路を更新

`cli/internal/wiki/hooks.go:160-162` は `missing acl.ts at ... (run pnpm build:acl before setup.sh)` を
警告として出す。embed 後はホスト側で `acl.ts` が欠けることは無くなるので、
メッセージを実態に合わせる（`setup.sh` は Stage 04 で消えている）。

### 制約

- **esbuild の出力先を変えない**（相対 import 解決が load-bearing）
- **`ensure_gdgjp` を丸ごと削らない。** xangi の実行時依存であり、削ると xangi が起動しない。
  完全撤去は Stage 13 の担当
- **生成物を変えない。** これは生成の**手段**を bash から Go に移すステージ。
  ファイルの内容・モード・所有者は 1 バイトも変えない
- **sudoers の validate-then-rename（Stage 04）を Go 実装でも維持する**
- `sandbox.json` / `permissions.json` / `hooks.json` の中身をモデル化しない。
  `.in` + プレースホルダ置換のまま移植する
- 収束エンジンの一般的なリソース抽象は作らない。それは Stage 06 の担当。
  ここは「`install-layout.sh` と同じ出力を出す」ことに集中する

## Files to touch — 変更ファイル

### 新規
- `cli/internal/command/agent_host.go`（`emit-layout` サブコマンド）
- `cli/internal/agenthost/layout.go`（レイアウト生成本体）
- `cli/internal/agenthost/testdata/golden/`（Stage 06 で本格化する golden 出力の置き場）

### 更新
- `cli/internal/wiki/hooks.go` — `//go:embed hooks/acl.ts`、`hooks/gws.ts`、`hooks/exec-spawn.ts` の追加、
  および :160-162 のメッセージ
- `cli/internal/agenthost/assets/index-proxy.ts`（新規。`agents-index/src/proxy.ts` の決定的コピー）
- `scripts/sync-agent-host-assets.mjs`（新規。コピーと同一性検査）
- `package.json`（コピーステップを `build:acl` と同じ位置づけで追加）
- `agent-host/install.sh` — レイアウト部分を `gdg agent-host emit-layout` 呼び出しに置換、
  `ensure_pnpm` / `build_acl` / `GDG_SKIP_BUILD` 削除
- `.github/workflows/` — リリースビルドに `pnpm build:acl` を前置
- `.github/scripts/gdg-agent-layout.test.mjs` — `install-layout.sh` を実行していた箇所を
  `gdg agent-host emit-layout` に切り替え

### 削除
- `agent-host/lib/install-layout.sh`（179 行）
- `agent-host/lib/apply-ownership.sh`（54 行）

## Verification — 完了条件と検証

### 完了条件

- `gdg agent-host emit-layout --prefix DIR` が `install-layout.sh` と**バイト単位で同一のツリー**を出す
- ホストの hook 配置経路が node / pnpm / corepack / monorepo clone を必要としない
- `agent-host/lib/install-layout.sh` と `agent-host/lib/apply-ownership.sh` が存在しない
  （**プロビジョニング用シェル 5 本 → 3 本**）
- **`agent-host/lib/verify.sh` は残る。** Stage 04 で退避した 13 検査であり、
  Go の `gdg agent-host verify` へ移すのは Stage 07。残る 3 本は
  `agent-host/install.sh`, `agent-host/lib/verify.sh`, `agents-index/install.sh`
- `/opt/gdgjp` は xangi のためだけに残っており、その旨がコード上に明記されている

### コマンド

```bash
pnpm build:acl && (cd cli && go build ./... && go test ./internal/agenthost/...)
```

**ベースラインの取得（実装を始める前に実行し、成果物を保存しておくこと）**:

```bash
GDG_SETUP_PREFIX=/tmp/sh-layout agent-host/lib/install-layout.sh
```

> `GDG_SETUP_PREFIX` を**必ず同じコマンドの環境変数として渡す**こと。
> `install-layout.sh` は prefix が無いと live の `/opt/gdg-agent`、`/etc/sudoers.d/gdg-agent`、
> `/etc/tmpfiles.d/gdg-agent.conf` に書き込む。**稼働中のホストで prefix 無しに実行しない。**
> `git stash` と組み合わせて過去版を復元する形にしない（stash の前後で prefix が外れる事故が起きる）。
> 実装後にベースラインを取り直す必要が生じたら、削除済みスクリプトを
> `git show <ref>:agent-host/lib/install-layout.sh > /tmp/legacy-layout.sh` で一時ファイルに取り出し、
> `GDG_SETUP_PREFIX=... bash /tmp/legacy-layout.sh` として明示的に prefix を渡して実行する。

```bash
gdg agent-host emit-layout --prefix /tmp/go-layout && diff -r /tmp/sh-layout /tmp/go-layout
```

```bash
node --test .github/scripts/*.test.mjs
```

### 回帰として固定すべきテスト

- **`emit-layout` の出力が `install-layout.sh` の出力とバイト一致する**（移植の等価性。
  このステージの唯一かつ最重要の担保。移行完了後は golden ファイルとして固定する）
- **`emit-layout` を 2 回実行して 2 回目が何も変更しない**（冪等性。
  `install-layout.sh` の `writable()` 相当が Go 側でも効いていること）
- **`emit-layout` が `/opt/gdg-agent/bin` の宣言外ファイルを削除する**
  （`install-layout.sh:77` の `rm -rf bin/` が担っていた converge-by-deletion。
  これが抜けると退役したラッパーが残り続ける）
- **`acl.ts` が embed バイナリから展開され、ホストに `pnpm` が無くても配置される**
- **`cli/internal/agenthost/assets/index-proxy.ts` が `agents-index/src/proxy.ts` と一致する**
  （コピーがずれると、配置される `index-proxy.ts` が `agents-index` 本体と食い違い、
  nonce 注入が壊れても気づけない。**CI で必ず検査する**）
- **`go build ./...` が、アセットのコピーステップを踏まずに実行されたとき明確に失敗する**
  （黙って古いアセットで通らないこと）
- **sudoers の validate-then-rename が Go 実装でも効いている**（Stage 04 の修正の維持）
- **生成された `mcp.json` のキーが `["gdg-index"]` のみで、ソケットパスがスロットに対応する**
  （`extra-mcp.json` のマージで base が優先されること。現行 `gdg-agent-layout.test.mjs:101-108` の
  アサーションを移植する）

### 手動 E2E

1. **実装を始める前に** `GDG_SETUP_PREFIX=/tmp/before agent-host/lib/install-layout.sh` を実行して保存する
   （prefix を同じコマンドで渡すこと。prefix 無しの実行は live のホストを書き換える）
2. 本ステージを実装する
3. `gdg agent-host emit-layout --prefix /tmp/after` を実行する
4. `diff -r /tmp/before /tmp/after` が**差分ゼロ**であることを確認する
5. `find /tmp/after -type f -exec stat -f '%N %Sp %Su:%Sg' {} +` でモードと所有者が一致することを確認する
6. Lima VM で `agent-host/dev/provision.sh` → `seed-iam.sh` → `activate.sh` を通す
7. VM 上で `node` と `pnpm` を PATH から外した状態で `gdg agent-host emit-layout` が成功することを確認する
8. `agent-host/lib/verify.sh` の 13 検査がすべて ok になることを確認する
