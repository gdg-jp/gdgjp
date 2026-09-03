# Stage 03 — agent-host/ へ統合しミラーツリーを解消する

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 03。**依存: Stage 01, Stage 02（不可逆ゲート、完了必須）。**

現状、同じホストを構築するファイルが 2 箇所に分裂している。

**byte-identical な複製が存在する**（`diff` で確認済み）:

- `scripts/gdg-agent/install-layout.sh` ≡ `agents-local/lib/install-layout.sh`（179 行、完全一致）
- `scripts/gdg-agent/config/*` ≡ `agents-local/config/*`（`apparmor.d-cursor-agent-cursorsandbox` のみ submodule 側だけ）

担保は `.github/scripts/gdg-agent-layout.test.mjs:39-46` のアサーション 1 本のみで、しかも
`existsSync` ガード付き（submodule 未チェックアウトなら黙って通る）、`config/` は drift 検査対象外。

**ミラーの理由として書かれているものは事実と違う。** `scripts/setup-gdg-agent.sh:4-5` は
「agents-local submodule pin は CI から常に fetch できるとは限らない」と書くが、実態は
gdgjp が PUBLIC / gdg-jp/agents が PRIVATE であること。しかも **monorepo 側のコピーは
単独で動かない** — `install-layout.sh:25-36` が自身のディレクトリから遡って
`../../agents-local/.cursor/mcp.json` を解決するため、submodule が無いと動かない。
つまり「CI が submodule を取れない場合の備え」という目的を果たしていない。

**submodule 境界がコンポーネントを横断している。** エージェントの実行時本体は monorepo 側にある:
`cli/internal/wiki/hooks/*.ts`（9 ファイル。`install-layout.sh:83` が `/opt/gdg-agent/lib` へ配置）と
`agents-index/src/proxy.ts`（同 :87-97）。`agents-local` は独立したコンポーネントではなく、
他所にあるコンポーネントのデプロイスクリプトである。

**CI から見えていないパッケージがある。** `agents-local/lib/langfuse-forwarder/` は
`src/*.ts` 8 本 + vitest 5 本 + 独自 npm lockfile を持つ完全な TS パッケージだが
`pnpm-workspace.yaml` に無く、lint も typecheck も test も一度も走っていない。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針と依存グラフ
- `docs/agents-local-refactoring/02-public-content-review.md` — 公開範囲の判断（squash import 方式の根拠）
- `agents-local/README.md` — 現在のレイアウト説明
- `docs/agents-local-gws/plan.md:163-164` — 「2 つのミラーツリーは byte-identical を保つこと」が明記された箇所
- `.github/scripts/gdg-agent-layout.test.mjs` — このステージで大きく書き換えるテスト

### 再利用する既存実装

- `agents-local/lib/install-layout.sh` — **これが正本になる**。`scripts/gdg-agent/` 側は削除する
- `agents-local/config/*` — こちらが正本（`apparmor.d-*` を持つのはこちらだけ）
- `pnpm-workspace.yaml` の既存エントリ — `langfuse-forwarder` を同じ形式で追加する

## Design — 設計

### 1. ディレクトリ統合

Stage 02 でレビュー済みの HEAD を **squash import** で `agent-host/` に置く（full history は import しない）。

| 移動元 | 移動先 |
|---|---|
| `agents-local/install.sh` | `agent-host/install.sh` |
| `agents-local/setup.sh` | `agent-host/setup.sh`（Stage 04 で削除される） |
| `agents-local/lib/{install-layout.sh,apply-ownership.sh}` | `agent-host/lib/` |
| `agents-local/config/*` + `scripts/gdg-agent/config/*` | `agent-host/config/`（**統合・重複解消**） |
| `agents-local/.cursor/mcp.json` | `agent-host/config/extra-mcp.json` |
| `agents-local/lib/langfuse-forwarder/` | `agent-host/langfuse-forwarder/` |
| `agents-local/dev/` | `agent-host/dev/` |
| `agents-local/skills-lock.json` | `agent-host/skills-lock.json` |
| `agents-local/{AGENTS.md,.agents/,.codex/,.claude/}` | **`agent-host/workspace/`** |
| `agents-local/README.md`, `ENVIRONMENT.md` | `agent-host/`（Stage 02 の判断を反映した内容で） |

`agent-host/workspace/` は以降 **「本番エージェントの人格とスキル」の正本**であり、
Stage 09（Tier 1 配信）の配信対象そのものになる。ディレクトリ境界がそのまま
「速い経路で配信してよいもの」の境界になるので、ここに実行時設定を混ぜない。

### 2. 削除するもの（プロビジョニング用シェル 7 本 → 5 本）

- `scripts/gdg-agent/`（`install-layout.sh` 179 行の複製 + `config/`）
- `scripts/setup-gdg-agent.sh`（31 行。存在理由が消滅する）
- `.gitmodules` の `agents-local` エントリ（`git submodule deinit` → `git rm`）
- **入れ子の `wiki` submodule**

### 3. 入れ子 `wiki` submodule を落とす理由

`agents-local/.gitmodules` は以下を持つ:

```
[submodule "wiki"]
	path = wiki
	url = gdg-wiki::https://wiki.gdgs.jp/api/cli/wiki
```

この `gdg-wiki::` transport は `git-remote-gdg-wiki`（= `gdg` バイナリへの symlink、
`install.sh:392` が作る）が PATH に無いと解決できない。これを monorepo に持ち込むと
**`git clone --recurse-submodules gdgjp` に `gdg` バイナリが必要になる**。

`agents-local/README.md` 自身が「`setup.sh` never populates this submodule」と書いており、
実質未使用。削除するのが正しい。

### 4. 参照元の更新

- `install-layout.sh:25-36` の `resolve_extra_mcp` — `../../agents-local/.cursor/mcp.json` の
  フォールバック解決を削除し、`agent-host/config/extra-mcp.json` を直接参照する。
  これでレイアウトスクリプトが単独で動くようになる
- `agents-index/install.sh:19,157,161` — エラー文言中の `agents-local/install.sh` / `agents-local/setup.sh`
- `biome.json:32` — `agents-local/.cursor/**` を `agent-host/` 配下のパスに更新
- `pnpm-workspace.yaml` — `agent-host/langfuse-forwarder` を追加
- `agent-host/README.md` — bootstrap URL は Stage 08 で復活する旨を注記（実体は Stage 08）
- `cli/internal/wiki/hooks.go:161,179` — エラーメッセージ中の `setup.sh` / `scripts/setup-gdg-agent.sh`
- `cli/internal/wiki/hooks_test.go:252-256` — `TestAgentsLocalSetupShFailsOffUbuntu` が
  `scripts/setup-gdg-agent.sh` を実行している。新しいパスに向けるか、Stage 04 で `setup.sh` ごと
  消えるためテストを `agent-host/install.sh` に向け替える

### 5. `gdg-agent-layout.test.mjs` の更新

- `:13-15` ほか約 25 箇所の `agents-local/...` パスを `agent-host/...` に更新
- **`:39-46` の byte-identity アサーションと `existsSync` ガードを削除する。** 正本が 1 つになるため不要
- `ci.yml:78` の `submodules: true` を削除する（submodule が無くなるため）。
  これにより fork からの PR でもこのジョブが動くようになる

このテストは Stage 05〜07 で golden-file テストに置き換わるが、このステージでは**パスの付け替えのみ**とし、
アサーションの中身は変えない。統合が挙動を変えていないことの担保にするため。

### 制約

- **ホストの挙動を変えない。** これはファイルの移動と重複解消のみ。`install.sh` のロジック変更は Stage 04 以降
- **`agent-host/workspace/` に実行時設定を混ぜない。** ここは Stage 09 の Tier 1 で
  高頻度・低リスクに配信される領域。`config/`（sandbox/hooks/permissions/mcp）や
  `agent-host.json`（Stage 04）はここに入れない
- `agent-host/config/` の統合時、**`agents-local/config/` 側を正本とする**
  （`apparmor.d-cursor-agent-cursorsandbox` を持つのはこちらだけ）
- squash import で行う。`gdg-jp/agents` の full history を monorepo に持ち込まない（Stage 02 の判断）

## Files to touch — 変更ファイル

### 新規
- `agent-host/`（一式。上表の通り）
- `agent-host/config/extra-mcp.json`（`agents-local/.cursor/mcp.json` から移動）

### 削除
- `scripts/gdg-agent/`（ディレクトリごと）
- `scripts/setup-gdg-agent.sh`
- `agents-local/`（submodule 参照）
- `agents-local/.gitmodules` の入れ子 `wiki` submodule

### 更新
- `.gitmodules`
- `biome.json`（:32）
- `pnpm-workspace.yaml`
- `agent-host/lib/install-layout.sh`（:25-36 の `resolve_extra_mcp`）
- `agents-index/install.sh`（:19, :157, :161 のエラー文言）
- `cli/internal/wiki/hooks.go`（:161, :179）
- `cli/internal/wiki/hooks_test.go`（:252-256）
- `.github/scripts/gdg-agent-layout.test.mjs`（パス群 + byte-identity アサーション削除）
- `.github/workflows/ci.yml`（:78 `submodules: true` 削除）
- `.github/scripts/changed-workspaces.mjs`（Stage 01 で入れた `scripts/gdg-agent/` と `agents-local` の
  述語を `agent-host/` に更新）

## Verification — 完了条件と検証

### 完了条件

- `agent-host/` に統合が完了し、`scripts/gdg-agent/` と `scripts/setup-gdg-agent.sh` が存在しない
- `.gitmodules` に `agents-local` エントリが無く、入れ子 `wiki` submodule も無い
- `agent-host/langfuse-forwarder/` の vitest が CI で走っている
- `gdg-agent-layout.test.mjs` が submodule 無しで通る
- **プロビジョニング用シェルが 7 本から 5 本に減っている**
  （残: `agent-host/install.sh`, `agent-host/setup.sh`, `agent-host/lib/install-layout.sh`,
  `agent-host/lib/apply-ownership.sh`, `agents-index/install.sh`）

### コマンド

```bash
pnpm ci:quick
```

```bash
node --test .github/scripts/*.test.mjs
```

```bash
pnpm --filter @gdgjp/langfuse-forwarder test
```

```bash
git clone --recurse-submodules "$(git remote get-url origin)" /tmp/gdgjp-clone-check && echo CLONE_OK
```

### 回帰として固定すべきテスト

- **monorepo を `git clone --recurse-submodules` するのに `gdg` バイナリが不要**
  （入れ子 `wiki` submodule 削除の担保。これを固定しないと再混入に気づけない）
- **`agent-host/lib/install-layout.sh` が単独で動く**（`../../agents-local/` フォールバックが消えたこと。
  `GDG_SETUP_PREFIX` 付きで tmpdir に対して実行し、生成物が従来と一致すること）
- **`agent-host/langfuse-forwarder/` の vitest 5 本が CI で実際に走る**（これまで一度も走っていない）
- **`agent-host/workspace/` 配下に Google Sheets / Drive の URL、Discord ID が含まれない**
  （Stage 02 の判断の再混入防止）
- **`gdg-agent-layout.test.mjs` が submodule 無しのチェックアウトで通る**（`existsSync` ガード削除後）

### 手動 E2E

1. `GDG_SETUP_PREFIX=/tmp/layout-before agents-local/lib/install-layout.sh` を統合**前**に実行し、
   生成物を保存する
2. 統合を実施する
3. `GDG_SETUP_PREFIX=/tmp/layout-after agent-host/lib/install-layout.sh` を実行する
4. `diff -r /tmp/layout-before /tmp/layout-after` が**差分ゼロ**であることを確認する
   （統合がホストの生成物を変えていないことの担保）
5. Lima VM で `agent-host/dev/provision.sh` → `seed-iam.sh` → `activate.sh` を通す
6. `agent-host/setup.sh` の 13 検査がすべて ok になることを確認する
