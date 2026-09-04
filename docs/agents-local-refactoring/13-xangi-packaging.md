# Stage 13 — xangi の org 移管と packaging 修正、/opt/gdgjp の撤去

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 13。**依存: Stage 04（ref ピン済み）。
`/opt/gdgjp` の削除のみ Stage 07・Stage 08 の完了が前提。並行可: Stage 05〜08。**

xangi について全体方針で決定した 3 点のうち、ref ピン（Stage 04 で実施済み）を除く 2 点を扱う。

### 問題 1: 本番サービスが個人の private アカウント上にある

`Harineko0/xangi` は **PRIVATE の個人リポジトリ**（`gh repo view` で確認済み）。
upstream `karaage0703/xangi` から 42 commit 先行し、GDG 固有サブシステム
（authz server、IAM、slot uid 分離、sleep scheduler、episodic memory。約 18 ファイル）を内包する。

`gdg-jp/gdgjp` と `gdg-jp/agents` は org 配下なのに、**本番で動くサービス本体だけが個人アカウント**。
bus factor とアクセス制御の問題であり、コードの扱いとは直交する。

### 問題 2: 本番が `tsx` で `src/` を直接動かしている

現行の systemd unit（旧 `install.sh:653`）:

```
ExecStart=/usr/bin/node /opt/xangi/node_modules/tsx/dist/cli.mjs /opt/xangi/src/index.ts
```

`agent-host/ENVIRONMENT.md:184-187` が理由を明記している:

> ADR-022 wants Node-native TypeScript without tsx. `/opt/xangi/dist` cannot resolve
> `@gdgjp/gdg-lib` TypeScript sources, so the unit runs tsx against src/index.ts.
> Temporary host workaround.

根本原因は xangi の `package.json`:

- `"@gdgjp/gdg-lib": "file:../gdgjp/gdg-lib"` — **sibling ディレクトリへの file 参照**
- しかもそれが **`devDependencies`** に入っている（実行時に 8 つの `src/*.ts` が
  `@gdgjp/gdg-lib/acl` を import しているのに）

この結果:

- `/opt/gdgjp` が xangi の**実行時依存**になる（`file:../gdgjp/gdg-lib` → `/opt/gdgjp/gdg-lib`）
- `dist/` をビルドしても gdg-lib の TS ソースを解決できない → `tsx` で `src/` を動かすしかない
- ホストのプロビジョニングに `npm ci` と巨大な `node_modules` が要る
- xangi の CI は `gdg-jp/gdgjp` をチェックアウトして sibling として symlink する必要がある

**ただし xangi は `/opt/gdgjp` の消費者の 1 つにすぎない。** 調査の結果、実際には 3 つある:

| 消費者 | 依存の内容 | 解消するステージ |
|---|---|---|
| **xangi** | `@gdgjp/gdg-lib` が `file:../gdgjp/gdg-lib` → `/opt/gdgjp/gdg-lib` に解決される | **本ステージ** |
| **agents-index** | `install.sh:67` が `${GDGJP_ROOT}/agents-index/src/cli.ts` を解決し、`:95` の launcher が `exec /usr/bin/node "$pkg/src/cli.ts"`。**monorepo チェックアウトの TypeScript を実行時に読む**（`:227` は「`GDGJP_ROOT=/opt/gdgjp` を設定せよ」と明示的に警告している） | **Stage 08** |
| **langfuse-forwarder** | 旧 `install.sh:486-503` が `cp -a "$layout_dir/lib/langfuse-forwarder" /opt/langfuse-forwarder` + `npm ci`。チェックアウトからコピーされる | **Stage 07** |

**したがって `/opt/gdgjp` の削除は本ステージ単独では完了しない。** 3 つすべてが
自己完結した成果物（ピン留めされた tarball、またはバンドル同梱）になってはじめて削除できる。
本ステージは xangi の分を解消し、**最後の削除を実行する**役割を持つ（前提として 07 と 08 の完了が要る）。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針
- `docs/agents-local-refactoring/05-embed-acl-emit-layout.md` — `/opt/gdgjp` が
  xangi の実行時依存として残っている経緯
- `agent-host/ENVIRONMENT.md:36, 184-187` — `file:` 解決と tsx 運用の記述
- xangi 側: `package.json`（`@gdgjp/gdg-lib` の位置）、`docs/gdg-lib-acl.md`
  （「sibling checkout の外で installing する前に gdg-lib を publish する必要がある」と明記）、
  `.github/workflows/ci.yml:26-33`（sibling symlink の回避策）、`tsconfig.json`
- `gdg-lib/package.json` — publish 設定を追加する対象
- `gdg-lib/src/acl/agent.ts` — xangi が import する narrow な再エクスポート面（26 行）

### 再利用する既存実装

- **`gdg-lib/src/acl/agent.ts`** — xangi が使う API は既にここに絞られている。
  publish する面はこの 26 行が示すものでよい。新しい API 設計は要らない
- **`gdg-lib/package.json:21` `build:acl`** — 既存の esbuild 経路。publish 用のビルドと共存させる
- **xangi の `packaging/build-installer.mjs`** — 署名済みリリース機構。
  `dist/` 化が済めばこちらの経路も使えるようになる
- **Stage 04 の `pins.xangi`** — repo と ref。移管後に repo URL を更新するだけ

## Design — 設計

この 2 つは独立して実施できる。**移管を先にするのが安全**（packaging の変更を移管後のリポジトリで行える）。

### 1. `gdg-jp/xangi` への移管

1. GitHub の repository transfer で `Harineko0/xangi` → `gdg-jp/xangi`
2. `agent-host/agent-host.json` の `pins.xangi.repo` を更新
3. xangi 側 CI の `gdg-jp/gdgjp` チェックアウト設定を確認（org 内になるので権限が変わる）
4. `agent-host/README.md` と `docs/agents-local-mvp/04-manual-e2e-cursor-linux.md`、
   `docs/agents-local-gws/fix-auth-plan.md` の `Harineko0/xangi` 参照を更新
5. `.github/scripts/gdg-agent-layout.test.mjs:180-232` に
   `/Harineko0\/xangi/` を検査する正規表現アサーションがある（Stage 07 で golden へ移行済みなら不要）

**public にするかは別判断。** 移管は org 配下に置くことが目的で、visibility は現状維持でよい。

### 2. `@gdgjp/gdg-lib` の publish と packaging 修正

**publish 先の選択肢**（`adr.md` に記録すること）:

- npm public registry — 最も単純。gdg-lib に機密は無い（ACL の評価ロジックであってポリシーそのものではない）
- GitHub Packages（org スコープ）— private のまま配れる。認証設定が要る

いずれにせよ:

1. `gdg-lib/package.json` に publish 設定を追加する
   （`name`, `version`, `files`, `exports`, `publishConfig`）。
   **`./acl/agent` の subpath export が要る**（xangi と `agents-index/src/authz.ts:3` が使う）
2. `dist/` へのビルドを追加する（型定義を含む）。既存の `build:acl`（esbuild で
   `cli/internal/wiki/hooks/acl.ts` を出す）とは**別の成果物**なので共存させる
3. xangi 側で `@gdgjp/gdg-lib` を `devDependencies` → **`dependencies`** へ移し、
   `file:../gdgjp/gdg-lib` → publish されたバージョンへ変更する
4. xangi が `dist/` をビルドできることを確認する
5. systemd unit の `ExecStart` を `/usr/bin/node /opt/xangi/dist/index.js` に変更する
   （`cli/internal/agenthost/` の systemd リソース経由。Stage 07）
6. xangi CI の sibling symlink 回避策（`.github/workflows/ci.yml:26-33`）を削除する

### 3. `/opt/gdgjp` の撤去（**3 つの消費者すべてが解消されてから**）

削除の前に、以下がすべて満たされていることを確認する:

- [ ] **xangi** — 本ステージ。`dist/` 化され、`@gdgjp/gdg-lib` を publish 版から解決している
- [ ] **agents-index** — Stage 08。`src/cli.ts` をチェックアウトから読むのをやめ、
      ピン留めされた自己完結の成果物になっている
- [ ] **langfuse-forwarder** — Stage 07。チェックアウトからの `cp -a` + `npm ci` をやめ、
      ピン留めされた成果物になっている

3 つすべてが揃ってから:

1. `/opt/gdgjp` clone を作る収束リソースを削除する
2. ホストのプロビジョニングから monorepo clone が完全に消える
3. `agent-host/ENVIRONMENT.md` のチェックアウト台帳を更新する

> **順序を間違えると本番が止まる。** `/opt/gdgjp` を先に消すと、
> agents-index は `src/cli.ts` を失って起動しなくなる。`--dry-run --diff` では
> 「ディレクトリが消える」としか見えないので、削除前にこのチェックリストを人が確認すること。

### 4. リリース版 xangi の取得方式

`dist/` 化が済むと、xangi を **git clone + `npm ci`** ではなく
**署名済みリリース成果物**として取得できるようになる（xangi の `packaging/` が既にその機構を持つ）。

- 取得方式を `git@ref` リソースから `tarball@sha256` リソースに変えられる
- ホストから `npm ci` と巨大な `node_modules` が消える
- **これは大きな改善だが必須ではない。** 段階を分け、まず `dist/` 化と `dependencies` 移動を
  完了させてから検討する

### 制約

- **移管と packaging を同時にやらない。** 移管を先に完了させ、動作確認してから packaging に進む
- **`gdg-lib/src/acl/agent.ts` の API 面を広げない。** publish するのは既存の narrow な面だけ。
  publish を機に「ついでに他も公開」しない
- **`build:acl` の出力先を変えない**（`cli/internal/wiki/hooks/acl.ts`。
  相対 import 解決が load-bearing。`docs/agents-local-mvp/01-acl-evaluator-gdg-lib.md:123-136`）
- **`agents-index/src/authz.ts:3` も `@gdgjp/gdg-lib/acl/agent` を import している。**
  publish 後もこちらは monorepo 内の workspace 参照のままでよいが、
  export 面が壊れないことを確認する
- **本番の切り替えは systemd unit の `ExecStart` 変更を伴う。** Stage 10 のリリース機構が
  動いているなら、そちらのロールバック経路に乗せる。動いていないなら手動で慎重に行う
- Antigravity 対応は **Stage 14 の担当**

## Files to touch — 変更ファイル

### monorepo 側
- `gdg-lib/package.json` — publish 設定、`dist/` ビルド、`exports`
- `gdg-lib/tsconfig.json`（型定義出力）
- `agent-host/agent-host.json` — `pins.xangi.repo`、および取得方式を変える場合は `pins.xangi` の形
- `cli/internal/agenthost/` — systemd リソースの `ExecStart`、`/opt/gdgjp` リソースの削除
- `cli/internal/agenthost/testdata/golden/` — unit の変更を反映
- `agent-host/README.md`, `agent-host/ENVIRONMENT.md`
- `docs/agents-local-mvp/04-manual-e2e-cursor-linux.md`, `docs/agents-local-gws/fix-auth-plan.md`
  （`Harineko0/xangi` 参照）
- `docs/agents-local-mvp/adr.md`（publish 先の選択と理由）
- `.github/workflows/`（gdg-lib の publish ジョブ）

### xangi 側（別リポジトリ）
- `package.json` — `@gdgjp/gdg-lib` を `dependencies` へ、publish 版を参照
- `.github/workflows/ci.yml:26-33` — sibling symlink 回避策の削除
- `tsconfig.json` / ビルド設定 — `dist/` が解決できること
- `docs/gdg-lib-acl.md` — 依存の解決方法を更新

## Verification — 完了条件と検証

### 完了条件

- `gdg-jp/xangi` に移管され、spec の `pins.xangi.repo` が追随している
- xangi が `dist/` をビルドでき、systemd unit が `node /opt/xangi/dist/index.js` で動く
- `@gdgjp/gdg-lib` が publish され、xangi の `dependencies` から参照されている
- **`/opt/gdgjp` がホストに存在しない**（monorepo clone がプロビジョニングから消えている）。
  **前提: xangi・agents-index・langfuse-forwarder の 3 つすべてが自己完結した成果物になっている**
- xangi CI が `gdg-jp/gdgjp` の sibling checkout 無しで通る

### コマンド

monorepo 側:

```bash
pnpm --filter @gdgjp/gdg-lib build && pnpm --filter @gdgjp/gdg-lib test
```

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

xangi 側:

```bash
npm ci && npm run build && node dist/index.js --help
```

ホスト:

```bash
sudo gdg agent-host apply --dry-run --diff && sudo gdg agent-host verify
```

### 回帰として固定すべきテスト

- **`agents-index/src/authz.ts` の `@gdgjp/gdg-lib/acl/agent` import が publish 後も解決する**
  （export 面を壊していないこと。monorepo 内 workspace 参照と publish 版の両立）
- **`build:acl` の出力先が `cli/internal/wiki/hooks/acl.ts` のまま**
  （publish 用ビルドの追加が既存経路を壊していないこと。壊れると hook の相対 import が死ぬ）
- **xangi が sibling checkout 無しで `npm ci && npm run build` できる**
  （packaging 修正の本体。これが通らないと `/opt/gdgjp` を消せない）
- **systemd unit の `ExecStart` に `tsx` が現れない**（`dist/` 化の完了）
- **ホストに `/opt/gdgjp` が存在しない**（clone 撤去の担保）
- **`/opt/gdgjp` を削除した状態で `agents-index.service` が起動する**
  （`src/cli.ts` をチェックアウトから読んでいた経路が本当に断ち切れていること。
  ここを確認せずに削除すると本番の agents-index が黙って停止する）
- **`/opt/gdgjp` を削除した状態で `langfuse-forwarder.timer` が動作する**
- **`gdg-lib` の publish されるファイルに機密が含まれない**
  （`npm pack --dry-run` の内容を固定する）
- **spec の `pins.xangi.repo` に `Harineko0` が現れない**（移管の完了）

### 手動 E2E

1. **移管フェーズ**: repository transfer を実施し、`pins.xangi.repo` を更新する
2. Lima VM で `gdg agent-host apply` が新しい repo から xangi を取得できることを確認する
3. Discord からエージェントが応答することを確認する（移管が挙動を変えていないこと）
4. **packaging フェーズ**: `gdg-lib` を publish し、xangi 側で `dependencies` へ移す
5. xangi で `npm ci && npm run build` が sibling checkout 無しで通ることを確認する
6. VM で systemd unit を `node dist/index.js` に切り替え、xangi が起動することを確認する
7. Discord からエージェントが応答し、**IAM / authz / sleep scheduler が動く**ことを確認する
   （`@gdgjp/gdg-lib/acl` を実行時に使う経路すべて。`/login`, `/whoami`, ACL 判定）
8. VM から `/opt/gdgjp` を削除し、再起動後に **xangi・agents-index・langfuse-forwarder の
   3 つすべて**が動くことを確認する（`systemctl --user status` で各サービスを確認）
9. `gdg agent-host verify` の 13 検査が通ることを確認する
10. **本番 `mincra-srv`**: Stage 10 のリリース機構が動いているなら、そのロールバック経路に乗せる。
    動いていないなら、`/opt/gdgjp` を削除する**前に** `dist/` 起動で数日安定することを確認する
