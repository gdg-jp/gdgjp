# Stage 00 — Native TypeScript runtime for local agent scripts

## Context — 背景とリポジトリ状況

### なぜやるか

agents-local MVP のローカル実行物は、フック、`wk`、ACL bundle の 3 系統に増える。
これらを JavaScript module と TypeScript source の混在にすると、次の問題が起きる。

- 実行物だけ型検査から外れ、stdin payload やトレースの shape が静かにずれる。
- ソースと配布物で拡張子・import 規約・テスト方法が分かれる。
- 後続ステージが「既存ファイルの変換」と「新規ファイルの作成」を混同する。

このステージで、ローカル実行物を **Node ネイティブ TypeScript** に統一する。
Node 22.18.0 以降は type stripping が既定で有効なので、依存をインストールできない
`/opt/gdg-agent/` でも `node file.ts` で実行できる。

一次資料:
[Node.js TypeScript documentation](https://nodejs.org/download/release/v22.18.0/docs/api/typescript.html)

### 依存と対象範囲

- 先行ステージ: なし。**最初に実施する。**
- Stage 01 は本ステージの ACL bundle 配布規約に依存する。
- Stage 05 は本ステージで rename した `acl-gate.ts` を全面改修する。
- 対象は既存ファイル 2 つと、その参照・型検査・実行環境だけ。

**既存ファイルとして TypeScript へ移行するのは、次の 2 つだけである。**

1. `cli/internal/wiki/hooks/acl-gate.ts`
2. `.codex/hooks/pre-commit-ci.ts`

どちらも現在ある同名の JavaScript module から、拡張子を変えて型を付ける。
`wk.ts`、`acl-core.ts`、`acl-insert-core.ts`、生成物 `acl.ts` はまだ存在しない。
これらは後続ステージで **最初から TypeScript として新規作成**し、移行対象に数えない。
`.codex/hooks/post-edit-quality` など、この計画から参照していない既存スクリプトも対象外である。

---

## Design — 設計

### 1. ランタイム契約

TypeScript 実行物は次をすべて満たす。

- Node.js `>=22.18.0`。`--experimental-strip-types` やランタイム transpiler は使わない。
- 起動は `node /absolute/path/file.ts`。`tsx`、`ts-node`、loader hook に依存しない。
- Node がそのまま消去できる構文だけを使う。
  `enum`、parameter property、runtime namespace など変換を要する構文は禁止する。
- 相対 import は `./module.ts` のように拡張子まで書く。
- 型だけの import/export は必ず `import type` / `export type` にする。
- `tsconfig.json` の `paths` や downlevel transform に実行時の意味を持たせない。
- フックは従来どおり依存ゼロとし、`node:` 組み込みだけを値 import できる。

Node は `.ts` の module system を最寄りの `package.json` と同じ規則で決める。
構文検出に依存せず、次の ESM boundary を明示する。

- リポジトリ内: `.codex/hooks/package.json` と
  `cli/internal/wiki/hooks/package.json` に `{ "private": true, "type": "module" }`
- clone 配布物: `.gdgwiki/hooks/package.json` に同じ marker
- 本番配置: `/opt/gdg-agent/package.json` に同じ marker

marker もスクリプトと同じ所有権・冪等性で設置する。

### 2. 型検査契約

リポジトリ直下に Node script 専用の `tsconfig.node-scripts.json` を置く。

```jsonc
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "strict": true,
    "target": "ESNext",
    "types": ["node"],
    "verbatimModuleSyntax": true
  },
  "include": [
    ".codex/hooks/pre-commit-ci.ts",
    "cli/internal/wiki/hooks/**/*.ts"
  ]
}
```

- root の `typescript` は `^5.9.2`、`@types/node` は `^22.15.30` に揃える。
- `package.json` の scripts は次の形にする。
  - `"build:acl": "pnpm --filter @gdgjp/gdg-lib build:acl"`
  - `"typecheck:node-scripts": "pnpm build:acl && tsc -p tsconfig.node-scripts.json"`
  - `"typecheck": "pnpm typecheck:node-scripts && turbo typecheck"`
- **`build:acl` を前置するのは、`acl.ts` が include 対象の中の生成物だからである**（§5）。
  前置を落とすと、クリーンチェックアウトで `typecheck:node-scripts` が
  「ファイルが無い」で落ちる。`cd cli && go test ./...` の前にも同じ理由で要る。
- root の `ci:quick` / `ci:full` script の先頭にも `pnpm typecheck:node-scripts` を追加する。
  既存 CI runner は root の `typecheck` script を経由しないため、CI entrypoint で明示的に呼ぶ。
- Node ネイティブ実行は型検査をしない。`tsc --noEmit` と直接起動テストの両方を必須にする。

### 3. 既存 ACL gate の rename

`cli/internal/wiki/hooks/acl-gate.ts` は、このステージでは挙動を変えない。
型を追加して現在の fail-open とトレース動作を固定し、Stage 05 が後で `preToolUse` 版へ
全面改修する。

同時に以下を更新する。

- `cli/internal/wiki/hooks.go` の `//go:embed`、ファイル名定数、hooks JSON の command
- `EnsureCursorHooks` が `.gdgwiki/hooks/acl-gate.ts` と ESM marker を冪等に配置する処理
- `cli/internal/wiki/hooks_test.go` のパス、mtime、git status clean の検証
- `docs/plans/11-ingest-acl-hooks.md` に残る現行ゲートの参照

不正 JSON、clone root が見つからない場合、`gdg` が無い場合の fail-open は変えない。
型付けを理由に入力検証の方針や exit code を変更しない。

### 4. 既存 Codex pre-commit hook の rename

`.codex/hooks/pre-commit-ci.ts` に型を付け、`.codex/hooks.json` の command を更新する。
この hook も挙動を変えない。

- stdin の chunk と payload に型を付ける。
- `unknown` の catch value は型ガードして stdout/stderr を読む。
- commit 以外は即座に許可する。
- malformed payload は commit と判定せず fail open にする。
- `pnpm ci:full --changed` の失敗だけを deny にする。

`.codex/hooks/post-edit-quality` は対象外なので変更しない。

### 5. 後続ステージが作る TypeScript 実行物

本ステージでは作らないが、命名と配置をここで固定する。

**リポジトリ上も配置後も、実行物は平坦な 1 ディレクトリに置く。**
相対 import（`./acl-core.ts`）が**両方で同じ形のまま解決する**ことが要件である。

| source / generated file | 配置 | 作成ステージ |
|---|---|---|
| `cli/internal/wiki/hooks/acl-gate.ts` | `/opt/gdg-agent/lib/acl-gate.ts` | 05 / 07 |
| `cli/internal/wiki/hooks/wk.ts` | `/opt/gdg-agent/lib/wk.ts` | 11 |
| `cli/internal/wiki/hooks/acl-core.ts` | `/opt/gdg-agent/lib/acl-core.ts` | 11 |
| `cli/internal/wiki/hooks/acl-insert-core.ts` | `/opt/gdg-agent/lib/acl-insert-core.ts` | 06 |
| `cli/internal/wiki/hooks/acl.ts`（**生成物**） | `/opt/gdg-agent/lib/acl.ts` | 01 |

- **`libexec/` と `hooks/` を作らない。** `/opt/gdg-agent/bin/` に置くのは launcher だけである。
- `hooks.json` の command は `node /opt/gdg-agent/lib/acl-gate.ts` になる。
- **ESM marker は `/opt/gdg-agent/package.json` 1 つでよい**
  （`lib/*.ts` からの最寄りの `package.json` がこれになる）。

`wk` の shell allowlist は `argv[0] === "wk"` を維持する必要がある。
そのため `/opt/gdg-agent/bin/wk` は root 所有 `0755` の薄い launcher とし、
`exec node /opt/gdg-agent/lib/wk.ts "$@"` だけを行う。判定・パス処理・fallback を
launcher に置かない。`lib/**` は root 所有 `0444` とする。

#### `acl.ts` は `cli/internal/wiki/hooks/` に生成する

Stage 01 の esbuild は `src/acl/agent.ts` を bundle する。
**outfile は `gdg-lib/dist/acl.ts` ではなく `cli/internal/wiki/hooks/acl.ts` にする。**

`gdg-lib/dist/` に出すと、リポジトリ上の相対パス（`../../../../gdg-lib/dist/acl.ts`）と
配置後の相対パス（`./acl.ts`）が食い違い、**同じ import 文がリポジトリと本番の
両方では成立しない。**`typecheck:node-scripts` が通っても本番で落ちる（またはその逆）。

- `cli/internal/wiki/hooks/.gitignore` に `acl.ts` を足す（生成物はコミットしない）。
- **生成された `acl.ts` を `//go:embed` の対象にしない。** ビルド前に `go build` が落ちる。
  配置は `setup.sh` がリポジトリのパスから行う。
- `tsconfig.node-scripts.json` は `cli/internal/wiki/hooks/**/*.ts` を include するので、
  **`build:acl` を先に回す必要がある**（§2）。
- **`acl-gate.ts` は `./acl.ts` を import しない。** ゲートは ACL を判定しない
  （[Stage 05](05-cursor-harness-pretooluse.md) §2）。import するのは `wk.ts` と
  `acl-insert-core.ts` である。

### 6. 絶対パスの解決を配置側に集約する

§5 の表の左列（リポジトリ内のソース）と右列（配置先）を繋ぐのは、次の 2 つだけである。

| 解決する場所 | 対象 |
|---|---|
| `agents-local/setup.sh` | `/opt/gdg-agent/` 配下の全実行物、`~/.cursor/*`、sudoers ドロップイン（Stage 07 §5） |
| `cli/internal/wiki/hooks.go`（`EnsureCursorHooks`） | clone 配布物（`.gdgwiki/hooks/`） |

**実行物の側に `/opt/gdg-agent` リテラルを散らさない。**
判定コア（`acl-core.ts`、`acl-insert-core.ts`、`acl.ts`）は自分の配置場所を知らない純関数とし、
clone root や library root が要るものは **引数で受ける**。
`acl-gate.ts` と `wk.ts` は相対 import（`./acl-core.ts`）だけで互いを解決する。
**そのために、リポジトリ上も配置後も同じ 1 ディレクトリに揃える**（§5）。
ディレクトリを分けると相対パスが両方では成立せず、
**型検査が通っても本番で import に失敗する**（逆もある）。

**実行時の環境変数でプレフィックスを可変にしない。**
`GDG_AGENT_ROOT` のような env を実行物が読むと、`wk` はエージェントの shell から起動されるので、
エージェントがプレフィックスを差し替えて **別の `acl-core.ts` を読ませられる**。
Stage 07 が root 所有 `0444` で守っているのは実体であって、実体を指すパスではない。
env で渡してよいのは Stage 07 のランチャが設定する `XANGI_AUTHZ_*` と `GDG_WIKI_RUN_ID` だけである
（あれはスロットに束ねられていて、値の正当性を認可サーバ側が検査する）。

テストのためにプレフィックスを差し替えたい場合は、env ではなく **関数引数**で渡す（§7）。

### 7. macOS 開発機での実行

**macOS はサポート対象の実行環境ではない。開発機である。**
本番は Ubuntu 1 台だけであり（[index.md](index.md)「対象環境」）、
uid 分離・sudoers・systemd・`/run` は macOS で再現しないし、再現を試みない。

macOS で通す必要があるのは次だけである。

- `pnpm typecheck:node-scripts`
- 判定コアと `wk` の純関数部分の Vitest
- `node cli/internal/wiki/hooks/acl-gate.ts` の直接起動（malformed payload の fail-open 確認）

成立条件は §6 と同じである — 実行物が絶対パスを埋め込まず、clone root と library root を
引数で受け取ること。**macOS 用の分岐を実行物に入れない。** `process.platform` を読む実行物を作らない。
OS 分岐が要るのは `setup.sh` だけで、`setup.sh` は Ubuntu 専用のまま
**macOS では冒頭で明示的に失敗させる**（黙って部分実行させない）。

**確認済みの事実**（macOS 26.2 で検証）。
「`/opt` や `/etc` に書けないから」を macOS 非対応の理由にしない — 実際には書ける。
理由は init システムとユーザー作成と `/run` である。

| Stage 07 が要求するもの | macOS の状況 |
|---|---|
| `/opt`、`/etc/sudoers.d` | **書ける**（`/opt` は `root:wheel 0755`、Homebrew が `/opt/homebrew` を使う）。どちらも SIP の対象外で、`visudo` もある |
| `/run`（tmpfs） | **無い**。`/var/run` はあるが `systemd-tmpfiles` 相当が無い |
| `/proc/<pid>/environ` | **無い** → [ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) の脅威の前提が成立しない |
| `systemd` user unit | **無い**（launchd） |
| `useradd` | **無い**（`dscl` / `sysadminctl`） |
| setgid ディレクトリ | あるが BSD のグループ継承が既定で、Linux と挙動が違う |

### 制約

- Node の最低バージョンを曖昧な `>=22` に戻さない。既定 type stripping がある
  `>=22.18.0` で固定する。
- `--experimental-transform-types` を足して禁止構文を通さない。
- `tsx` / `ts-node` / node_modules を本番配置の必須条件にしない。
- `.js` へ compile する別経路を作らない。開発と本番の入口を同じ `.ts` にする。
- ESM marker を agent uid が変更できる場所だけに置かない。本番 marker は root 所有にする。
- 実行物に `/opt/gdg-agent` の絶対パスリテラルを埋め込まない。
  解決するのは `setup.sh` と `hooks.go` だけである（§6）。
- **実行物を複数ディレクトリに分けない**（§5）。リポジトリ上も配置後も平坦な 1 つである。
  `libexec/` と `hooks/` を作り直すと、`./acl-core.ts` が両方では解決しなくなる。
- **`build:acl` の outfile を `gdg-lib/dist/` に戻さない**（§5）。
  戻すと `wk.ts` からの import 文がリポジトリと本番で別物になる。
- **生成された `acl.ts` をコミットしない・`//go:embed` しない**（§5）。
- プレフィックスを実行時 env で可変にしない。`GDG_AGENT_ROOT` 相当を実行物に読ませない（§6）。
- 実行物に `process.platform` 分岐を入れない。macOS 対応を理由に本番経路を変えない（§7）。
- macOS を本番デプロイ先として扱わない。launchd / dscl 版を Stage 07 に作らない（§7）。
- Stage 00 で `wk` や ACL core を先回りして作らない。

---

## Files to touch — 変更ファイル

### 既存ファイルの移行

- `cli/internal/wiki/hooks/acl-gate.ts` — 既存ゲートの rename と型付け
- `.codex/hooks/pre-commit-ci.ts` — 既存 pre-commit hook の rename と型付け

### 実行・型検査設定

- `cli/internal/wiki/hooks.go`, `cli/internal/wiki/hooks_test.go` — embed、配置、参照、テスト
- `.codex/hooks.json` — pre-commit command
- `.codex/hooks/package.json`, `cli/internal/wiki/hooks/package.json` — ESM boundary
- `package.json`, `pnpm-lock.yaml`, `tsconfig.node-scripts.json`
  — Node 最低版、型検査、CI entrypoint
- `agents-local/setup.sh` — 冒頭の OS 判定。Ubuntu 以外では何もせず失敗する（§7）
- `docs/plans/11-ingest-acl-hooks.md` — 現行ゲート名の同期

---

## Verification — 完了条件と検証

### 完了条件

1. 既存ファイルの移行が `acl-gate.ts` と `pre-commit-ci.ts` の 2 つだけである。
2. Node 22.18.0 で両ファイルを直接起動でき、追加 loader や node_modules を要求しない。
3. `EnsureCursorHooks` が `.ts` と ESM marker を配置し、2 回目は no-op になる。
4. malformed input と対象外コマンドの fail-open が rename 前と一致する。
5. `tsc` が変換を要する TypeScript 構文を拒否する。
6. 後続ステージの新規実行物がすべて `.ts` 名で記述されている。
6a. **配置後のディレクトリ構成で `node /opt/gdg-agent/lib/acl-gate.ts` と
   `/opt/gdg-agent/bin/wk` が import エラー無しで起動する。**
   `libexec/` と `hooks/` が存在しない。
6b. **`build:acl` を回していないクリーンチェックアウトで
   `pnpm typecheck:node-scripts` が落ちない**（script が `build:acl` を前置している）。
   `cli/internal/wiki/hooks/acl.ts` が `.gitignore` されている。
7. 実行物に `/opt/gdg-agent` の絶対パスリテラル、`GDG_AGENT_ROOT` 相当の env 読み取り、
   `process.platform` 分岐のいずれも無い。
8. macOS 開発機で `pnpm typecheck:node-scripts` と直接起動テストが通り、
   `setup.sh` は macOS で明示的に失敗する。

### コマンド

```bash
node --version
```

```bash
pnpm typecheck:node-scripts
```

```bash
cd cli && go test ./internal/wiki/...
```

```bash
printf '{broken' | node .codex/hooks/pre-commit-ci.ts
```

```bash
printf '{}' | node cli/internal/wiki/hooks/acl-gate.ts unknown
```

```bash
grep -rn "/opt/gdg-agent\|GDG_AGENT_ROOT\|process.platform" cli/internal/wiki/hooks/ .codex/hooks/
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト

- hooks JSON が存在しない旧ファイル名を参照しない。
- ESM marker を消すと直接起動テストが落ちる。
- `enum` など erasable でない構文を lint/typecheck が拒否する。
- Codex hook は commit 以外で `pnpm` を起動しない。
- ACL gate は malformed payload、未知 mode、clone 外で deny しない。
- Stage 05 が rename 済みの `acl-gate.ts` を編集し、別ファイルを新設しない。
- 上記 `grep` が実行物側で 0 件になる（配置側の `setup.sh` / `hooks.go` は対象外）。
- 判定コアが clone root / library root を引数で受け、`import.meta.dirname` 起点の
  絶対パス組み立てに戻っていない。
- **実行物の相対 import が、リポジトリ上と配置後で同じ文字列である。**
  ディレクトリを分け直すと片方だけが解決し、**型検査が通ったまま本番で落ちる。**
- **`acl-gate.ts` が `./acl.ts` を import していない**（grep で固定する）。
  ゲートは ACL を判定しないので、bundle への依存が現れたら設計が崩れている。
