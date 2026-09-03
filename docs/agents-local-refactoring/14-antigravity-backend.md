# Stage 14 — Antigravity バックエンド対応

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 14。**依存: Stage 11（能力契約）、Stage 12（slot 分離の引き上げ）。**

> **⚠ 実装前に疎通確認を行い、通らなければ止まって報告すること。**
> `agy` CLI の能力が確認できていない状態で実装を始めると、動かない理由の切り分けに時間が溶ける。
> 詳細は下の「ブロッキング調査」の節。

### 到達点

全体方針の要求 2 —「spec の `backend.name` を `cursor` → `antigravity` に変えて push したら
本番のバックエンドが入れ替わる」— を、**3 層の信頼境界を保ったまま**成立させる。

### ここまでで埋まったもの / 残っているもの

| 層 | Stage 11 時点 | Stage 12 完了後 | このステージの担当 |
|---|---|---|---|
| uid 分離（slotLauncher） | ✗ | **✓**（`CliRunnerBase` へ引き上げ済み） | — |
| OS サンドボックス（osSandbox） | ✗ | ✗ | **調査 → 実装 or 代替** |
| preToolUse ゲート（toolGate） | ✗ | ✗ | **調査 → 実装 or 代替** |

Stage 11 の能力契約により、この 2 層が埋まらない限り
`gdg agent-host apply` は antigravity への切り替えを**拒否する**。これは正しい状態であり、
このステージが完了するまで拒否され続けるのが期待される挙動。

### Antigravity について分かっていること

- xangi の `SETUP_BACKENDS`（`src/setup/schema.ts:4-11`）に含まれ、
  `src/antigravity-cli.ts` が Google の **`agy`** コマンドを駆動する
- `docs/design.md:308` — 「Agy 1.1.8 以降の JSON/stream-json、slash 展開の能力判定、旧版フォールバック」
- `src/antigravity-cli.ts:124-161` の `buildArgs` が渡すフラグ:
  `--disable-slash-commands` / `--dangerously-skip-permissions` / `--model` / `--effort` /
  `--conversation` / `--add-dir` / `--print-timeout` / `--output-format` / `-p`
- **`--dangerously-skip-permissions`（:137）の存在は権限プロンプト機構があることを示唆するが、
  プロンプトは fail-closed なプログラム的ゲートと同じではない**
- xangi の `src/hooks.ts` はバックエンド分岐を持たない。
  xangi 自身の hook 機構（workspace の `hooks/hooks.json`、Stop hook）は
  Cursor の `preToolUse` とは別物であり、ACL 境界には使えない

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針、3 層の表
- `docs/agents-local-refactoring/11-backend-capability-contract.md` — 能力契約の仕組み
- `docs/agents-local-refactoring/12-xangi-slot-isolation.md` — slot 分離の引き上げ
- `docs/agents-local-mvp/05-cursor-harness-pretooluse.md`（613 行）— preToolUse ゲートの設計。
  **代替手段を考えるならまずこれが何を守っているかを理解すること**
- `docs/agents-local-mvp/07-agent-uid-isolation.md`（655 行）— uid 分離の設計
- `agent-host/config/backends/cursor/` — cursor のポリシーバンドル（対応物を作る）
- `cli/internal/wiki/hooks/acl-gate.ts` — ゲート本体。`wk` / `gws` 以外の Shell を拒否する
- `cli/internal/wiki/hooks/shell-allowlist.ts` — 許可判定
- xangi 側 `src/antigravity-cli.ts` 全体、`src/backend-models.ts:274-348`

### 再利用する既存実装

- **`agent-host/config/backends/cursor/`（Stage 11）** — バンドルの構造。同じ形で antigravity 版を作る
- **`cli/internal/agenthost/backend.go`（Stage 11）** — 能力レジストリ。ここを更新する
- **`cli/internal/wiki/hooks/acl-gate.ts`** — ゲートのロジック本体。
  `agy` が hook を呼べるなら**このスクリプトをそのまま再利用できる**（起動の仕方が違うだけ）
- **`cli/internal/wiki/hooks/exec-spawn.ts`** — slot 起動時の環境構築。Stage 12 で共通化済み

## Design — 設計

### 1. ブロッキング調査（実装の前に必ず行う）

`agy` CLI について以下を確認し、**結果を `docs/agents-local-mvp/adr.md` に記録してから**実装に進む。

| # | 確認事項 | 分かれ道 |
|---|---|---|
| 1 | **fail-closed なプログラム的 pre-tool フックがあるか。** ツール実行前に外部プロセスを呼び、その終了コード/出力で実行を拒否できるか。フックが失敗したときに「拒否」側に倒れるか | 有り → `acl-gate.ts` をそのまま再利用できる。無し → 下の「代替」へ |
| 2 | **OS サンドボックス / 読み取り境界に相当する機能があるか。** Cursor の `sandbox.mode` + `readBoundary: workspace` の等価物 | 有り → バンドルで設定する。無し → uid 分離 + ファイルシステム権限のみが頼りになる |
| 3 | **allowlist 型の権限モデルがあるか。** `--dangerously-skip-permissions` が何をスキップしているのか。プロンプトなのか、宣言的な allowlist なのか | allowlist 有り → `permissions.json` の等価物を作る |
| 4 | ツール呼び出しのイベントを構造化出力で観測できるか（`--output-format stream-json`） | 監査ログと Langfuse 連携の可否 |

**1 が「無し」だった場合、これは設計判断が要る事項であり、実装者が独断で進めてはならない。**
その場合の選択肢:

- **代替 A: ラッパー専用 PATH。** slot の PATH を `/opt/gdg-agent/bin` のみにし、
  `wk` と `gws` 以外の実行可能ファイルを置かない。uid 分離 + ファイルシステム権限で
  「それ以外を実行できない」を担保する。**ACL 境界の強度は下がる**
  （ゲートは「何を実行しようとしたか」を検査できるが、PATH 制限は「何が存在するか」しか制御できない）
- **代替 B: Antigravity を採用しない。** 3 層を保てないなら要求 2 を
  「安全に切り替えられるバックエンドに限る」と再定義する

いずれも**受け入れるかどうかは別途判断**が要る。止まって報告すること。

### 2. ポリシーバンドル

`agent-host/config/backends/antigravity/` を作る。cursor 版（`Stage 11`）の対応物:

| cursor | antigravity |
|---|---|
| `cli-config.json`（sandbox / approvalMode / permissions.allow） | 調査 2, 3 の結果次第 |
| `hooks.json`（preToolUse, failClosed） | 調査 1 の結果次第 |
| `sandbox.json.in`（`__RUN_SLOT_DIR__`） | 調査 2 の結果次第 |
| `permissions.json`（gwsAllowlist） | `acl-gate.ts` / `gws.ts` は `$HOME/.cursor/permissions.json` を読む（`shell-allowlist.ts:368-381`）。**パスがバックエンド非依存になるよう調整が要る可能性がある** |
| `mcp.json.in`（`__INDEX_SOCKET__`） | `agy` の MCP 設定形式次第 |

バンドルには**配置先パス**も持たせる（cursor は `~/.cursor/`、antigravity は別ディレクトリになる）。

### 3. `permissions.json` の読み取りパス

**注意点**: `cli/internal/wiki/hooks/shell-allowlist.ts:368-381` の `loadGwsAllowlist()` は
`join(home, ".cursor", "permissions.json")` を**ハードコードで**読んでいる。
`gws.ts:60` の `isApprovedGwsArgs(args, loadGwsAllowlist())` もこれに依存する。

バックエンドが変わって配置先が `~/.cursor/` でなくなるなら、この読み取りパスを
バックエンド非依存にする必要がある（環境変数で渡すのが素直）。
**これは monorepo 側の変更であり、`gdg` CLI のリリースが連動して必要になる。**

### 4. 能力レジストリの更新

調査と実装の結果を `cli/internal/agenthost/backend.go` に反映する。
**願望を書かない**（Stage 11 の制約）。実際に検証できた能力だけを `true` にする。

### 5. `agy` のピン留め

Stage 04 の方針に従い、`agy` も version + sha256 でピンする。
`pins` に `antigravity` を追加し、`tarball@sha256` リソース（Stage 07）で取得する。

**第三者インストーラを root で `| bash` しない。**

### 制約

- **調査 1 の結果が出るまで実装を始めない。** 止まって報告する
- **3 層を保てないまま能力レジストリを `true` にしない。**
  レジストリの嘘は Stage 11 の安全装置を無効化する
- **`acl-gate.ts` のロジックを弱めない。** `agy` 用に起動方法を変えるのはよいが、
  判定ロジック（`wk` / `gws` 以外の Shell を拒否）は同じものを使う
- **cursor バックエンドの挙動を変えない。** バンドル分離（Stage 11）は済んでいるので、
  antigravity の追加が cursor に影響しないこと
- `permissions.json` の読み取りパスを変える場合、**`gdg` CLI のリリースが連動する**ことを
  計画に織り込む（`/opt/gdg-agent/lib/` へは embed から配置される）
- 切り替えは Stage 10 のリリース機構に乗せる。手で本番の `AGENT_BACKEND` を書き換えない

## Files to touch — 変更ファイル

### 調査フェーズ
- `docs/agents-local-mvp/adr.md`（調査 1〜4 の結果と、代替 A/B を採る場合はその判断）

### 実装フェーズ（調査結果次第）
- `agent-host/config/backends/antigravity/`（ポリシーバンドル）
- `cli/internal/agenthost/backend.go`（能力レジストリの更新）
- `cli/internal/agenthost/layout.go`（バンドル配置先のバックエンド依存化）
- `agent-host/agent-host.json`, `agent-host/agent-host.schema.json`（`pins.antigravity`）
- `cli/internal/wiki/hooks/shell-allowlist.ts`（:368-381 の `permissions.json` パス。**必要な場合のみ**）
- `cli/internal/wiki/hooks/gws.ts`（同上）
- `cli/internal/agenthost/testdata/golden/`（antigravity spec でのレンダリング結果を追加）
- xangi 側 `src/antigravity-cli.ts`（hook 起動、sandbox フラグ。調査結果次第）
- `agent-host/README.md`（対応バックエンドと各層の実装状況）

## Verification — 完了条件と検証

### 完了条件

- 調査 1〜4 の結果が `adr.md` に記録されている
- `agent-host.json` の `backend.name` を `antigravity` にして push すると、
  **3 層を保ったまま**本番のバックエンドが入れ替わる
- 能力レジストリの `antigravity` が実測に基づいて更新されている
- `agy` が version + sha256 でピンされている
- cursor バックエンドの挙動が変わっていない

### コマンド

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

```bash
gdg agent-host apply --spec agent-host/agent-host.json --dry-run --diff
```

```bash
gdg agent-host render --spec agent-host/agent-host.antigravity.json --out /tmp/agy && ls -R /tmp/agy
```

```bash
sudo gdg agent-host verify
```

### 回帰として固定すべきテスト

- **3 層のいずれかが満たされない状態で antigravity spec が `apply` されない**
  （Stage 11 の契約が、このステージの実装後も機能していること。
  実装を進める中で契約を緩めてしまうのが最も危険な失敗）
- **`acl-gate.ts` の判定ロジックが cursor と antigravity で同一**
  （起動方法だけが違い、`wk` / `gws` 以外の Shell を拒否する判定は共通であること）
- **antigravity で `wk` / `gws` 以外の Shell コマンドが拒否される**（実際のゲート動作）
- **antigravity のプロセスが `gdgagent-run-<N>` として動く**（Stage 12 の成果が効いていること）
- **cursor spec での `render` 出力が変わらない**（antigravity 追加が cursor に影響しないこと）
- **`permissions.json` の読み取りパスを変えた場合、cursor でも従来どおり読める**
  （`shell-allowlist.ts:368-381` の変更が cursor を壊していないこと）
- **`agy` が `releases/latest` ではなく version 指定で取得される**（ピン留めの回帰防止）

### 手動 E2E

**調査フェーズ（実装前）**

1. Lima VM に `agy` をインストールし、`agy --help` で利用可能なフラグを列挙する
2. hook / sandbox / permissions に相当する機能の有無を確認する
3. 意図的に失敗する hook を設定し、**ツール実行が拒否されるか（fail closed か）**を確認する
4. 結果を `adr.md` に記録する。**1 が「無し」なら、ここで止まって報告する**

**実装フェーズ（調査で 3 層を保てる見込みが立った場合のみ）**

5. `agent-host/config/backends/antigravity/` を作り、`gdg agent-host render` で
   生成物を目視確認する
6. VM で `backend.name: antigravity` の spec を `apply` する
7. `ps -eo user,cmd | grep agy` で `gdgagent-run-<N>` として動いていることを確認する
8. Discord からエージェントに問い合わせ、応答することを確認する
9. **ゲートの実動作確認**: エージェントに `wk` / `gws` 以外の Shell コマンド
   （例: `cat /etc/passwd`）を実行させ、**拒否される**ことを確認する
10. `sudo gdg agent-host verify` の 13 検査が通ることを確認する
11. spec を `cursor` に戻して `apply` し、元の構成に戻ることを確認する（切り替えの可逆性）
12. **本番 `mincra-srv`**: Stage 10 のリリース機構に乗せ、
    `verify` 失敗時に自動ロールバックすることを確認したうえで切り替える
