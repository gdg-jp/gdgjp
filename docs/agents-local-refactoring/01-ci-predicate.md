# Stage 01 — CI predicate: agent-host 関連の変更で script-tests を発火させる

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の全体方針に基づく最初のステージ。**依存なし。以降すべての前提。**

`agents-local`（`gdg-jp/agents` submodule）とその周辺を守っているテストは
`.github/scripts/gdg-agent-layout.test.mjs`（295 行、~40 個のホスト事実を固定する事実上のスキーマ）だが、
これを走らせる CI ジョブがほぼ発火しない。

`.github/workflows/ci.yml:72-84` の `script-tests` ジョブは `needs.changes.outputs.script-tests == 'true'` で
ガードされており、その述語は `.github/scripts/changed-workspaces.mjs:183`:

```js
scriptTests: normalizedFiles.some((file) => /^\.github\/scripts\/.*\.mjs$/.test(file)),
```

つまり **`.github/scripts/*.mjs` を編集したときしか走らない**。守っている対象である
`scripts/gdg-agent/**`、`agents-local` の submodule pin 更新、`cli/internal/wiki/hooks/**` を変更しても
テストは起動しない。結果として以下がすべて未検証のまま通る:

- `scripts/gdg-agent/install-layout.sh` と `agents-local/lib/install-layout.sh` の byte-identity
  （`gdg-agent-layout.test.mjs:39-46` のアサーション。しかも `existsSync` ガード付きで、
  submodule 未チェックアウトなら黙って通る）
- `scripts/gdg-agent/config/**` の drift（そもそも検査対象外）
- `/opt/gdg-agent/lib` へ配置される hook スクリプト群の変更

**もう 1 つ未確認の事実がある。** `ci.yml:78` は `submodules: true` を指定しているが、
`gdg-jp/gdgjp` は PUBLIC、`gdg-jp/agents` は PRIVATE（`gh repo view` で確認済み）。
public リポジトリのデフォルト `GITHUB_TOKEN` は private submodule を clone できないため、
このステップは失敗しているはずだが、上記の理由でジョブ自体が走らないので**誰も知らない**。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針と依存グラフ
- `.github/scripts/changed-workspaces.mjs` — 変更検出ロジック全体（特に `:170-190` の返り値構築）
- `.github/workflows/ci.yml:72-84` — `script-tests` ジョブ定義
- `.github/scripts/gdg-agent-layout.test.mjs` — 発火させたいテストの中身

### 再利用する既存実装

- `.github/scripts/changed-workspaces.mjs` の既存の述語群（`lint`, `openapi`, `cli` など :183-186 周辺）
  — 同じスタイルに揃える。新しい仕組みを作らない
- `scripts/run-ci.mjs:8,156` — `.github/scripts/*.test.mjs` をローカルで走らせる既存経路

## Design — 設計

### 1. `scriptTests` 述語の拡張

`.github/scripts/changed-workspaces.mjs:183` を以下に置き換える:

```js
scriptTests: normalizedFiles.some((file) =>
  /^\.github\/scripts\/.*\.mjs$/.test(file) ||
  /^scripts\/gdg-agent\//.test(file) ||
  /^agents-index\//.test(file) ||
  /^cli\/internal\/wiki\/hooks\//.test(file) ||
  file === "agents-local"),
```

`file === "agents-local"` は submodule pin の更新に対応する。submodule の gitlink 変更は
`git diff --name-only` 上でこの 1 パスとして現れる。

`agents-index/` を含めるのは、`.github/scripts/agents-index-install.test.mjs` が同じジョブで走るため。

### 2. private submodule チェックアウトの実態確認

`ci.yml:78` の `submodules: true` が public repo → private submodule で成功しているかを確認する。

- 成功していない場合、**このステージでは恒久対処をしない。** Stage 03 で submodule 自体が消えるため。
  事実を `docs/agents-local-mvp/adr.md` に記録し、`gdg-agent-layout.test.mjs` の
  submodule 依存部分（`:14-15` の `agents-local/lib/apply-ownership.sh` と `agents-local/install.sh` を
  **ガード無しで**読む箇所、`:184` `:190` `:200` `:214` `:217`）が CI で失敗することを明示する
- 暫定的にジョブを通したい場合の最小対処は、これらの読み取りを `existsSync` ガードで包み、
  submodule 不在時はスキップして warning を出すこと。**恒久対処にしない**（Stage 03 で消える）

### 3. 動作確認

述語の単体確認をテストとして固定する。`.github/scripts/` に既存の `*.test.mjs` があるので同じ形式で:
入力ファイルリストに対して `scriptTests` が期待通り `true`/`false` になることを検証する。

### 制約

- **述語を広げすぎない。** `scriptTests` が常に true になると CI 時間が伸び、
  変更検出の意味が消える。上記 4 パターン + 既存の 1 つに限る
- `.github/scripts/gdg-agent-layout.test.mjs` の**中身は変えない**。これは Stage 03 と
  Stage 05〜07 の担当。このステージは「走るようにする」だけ
- `ci.yml` の `submodules: true` を外すのは Stage 03 の担当。ここでは触らない

## Files to touch — 変更ファイル

- `.github/scripts/changed-workspaces.mjs`（:183 の `scriptTests` 述語）
- `.github/scripts/changed-workspaces.test.mjs`（新規または既存に追記。述語の回帰テスト）
- `docs/agents-local-mvp/adr.md`（`submodules: true` の実態を記録）
- `.github/scripts/gdg-agent-layout.test.mjs`（submodule 読み取りの暫定ガード。**必要な場合のみ**）

## Verification — 完了条件と検証

### 完了条件

- `scripts/gdg-agent/install-layout.sh` を 1 文字変更した PR で `script-tests` ジョブが起動する
- `cli/internal/wiki/hooks/acl-gate.ts` を変更した PR で `script-tests` ジョブが起動する
- `agents-local` の submodule pin を更新した PR で `script-tests` ジョブが起動する
- `ci.yml:78` の `submodules: true` が実際に成功しているか否かが記録されている

### コマンド

```bash
node --test .github/scripts/changed-workspaces.test.mjs
```

```bash
node .github/scripts/changed-workspaces.mjs --base origin/main --head HEAD
```

```bash
node --test .github/scripts/*.test.mjs
```

### 回帰として固定すべきテスト

- **`scripts/gdg-agent/**` の変更で `scriptTests` が true になる**（このステージの目的そのもの）
- **`cli/internal/wiki/hooks/**` の変更で `scriptTests` が true になる**（`/opt/gdg-agent/lib` へ配置される
  実行時本体。ここが無検証だったのが最も危険）
- **無関係なファイル（例: `wiki/app/routes/*.tsx`）のみの変更で `scriptTests` が false のまま**
  （述語を広げすぎていないこと）

### 手動 E2E

1. ブランチを切り `scripts/gdg-agent/config/permissions.json` に空白 1 文字を足して push
2. GitHub Actions で `script-tests` ジョブが起動していることを確認する
3. そのジョブの `actions/checkout` ステップのログを見て、`gdg-jp/agents` submodule の
   チェックアウトが成功しているか失敗しているかを記録する
4. 変更を revert する
