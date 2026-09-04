# Stage 11 — バックエンド能力契約（fail closed）

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 11。**依存: Stage 04（spec スキーマ）。
並行可: Stage 05〜07。Stage 14 の前提。**

### 解く問題

全体方針の要求 2 は「spec の `backend.name` を `cursor` → `antigravity` に変えて push したら
本番のバックエンドが入れ替わる」だが、**現状これをやると信頼境界が 3 層すべて黙って外れる。**

`agent-host/README.md` は 3 層を "none of which is optional in production" と書いている。
調査で確認した実態:

| 層 | cursor | antigravity |
|---|---|---|
| **preToolUse ゲート**（唯一の workdir 内 ACL 境界） | Cursor CLI の `~/.cursor/hooks.json`、`failClosed: true`、`/opt/gdg-agent/lib/acl-gate.ts` を起動 | **無い。** これは Cursor CLI の機能であり、xangi の `src/hooks.ts` にバックエンド分岐は存在しない |
| **uid 分離**（slot 実行） | `src/cursor-cli.ts:136-161` — `slotIsolationEnabled()` → `assertSlotLauncher(slot)` → `writeSpawnSpec` → `sudoLauncherArgs(slot)` | **無い。** `src/antigravity-cli.ts` は素の `spawn()`（:204, :228）。`slot-runtime` を import するのは `cursor-cli.ts` / `gdg-authz.ts` / `index.ts` の 3 本のみ |
| **OS サンドボックス** | `config/cli-config.json` の `sandbox.mode: "enabled"` + `readBoundary: "workspace"`（Cursor の非公開機能） | **無い。** 加えて `src/antigravity-cli.ts:137` は `--dangerously-skip-permissions` を渡す経路を持つ |

Antigravity は既に xangi のバックエンドとして**存在する**（`src/setup/schema.ts:4-11` の
`SETUP_BACKENDS` に含まれ、`src/antigravity-cli.ts` が Google の `agy` コマンドを駆動する）。
つまり `AGENT_BACKEND=antigravity` は今日でも設定できてしまう。

**このステージの目的は、それを構造的に不可能にすること。**

### なぜ spec と収束エンジンで強制するのか

`.github/scripts/gdg-agent-layout.test.mjs` は現在、これに近い不変条件をアドホックに検査している
（`:95-99` の `failClosed === true`、`:70-86` の `additionalReadonlyPaths` 検査など）。
だがそれは「cursor 前提でハードコードされたアサーション」であり、
バックエンドが変わったときに何を要求すべきかを表現していない。

能力契約は**その正しい置き場**でもある。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針、特に 3 層の表
- `agent-host/README.md` — Trust boundaries の節（3 層の定義と "not optional" の記述）
- `docs/agents-local-mvp/07-agent-uid-isolation.md` — uid/slot モデルの根拠（655 行）
- `docs/agents-local-mvp/05-cursor-harness-pretooluse.md` — preToolUse ゲートの設計（613 行）
- `agent-host/config/cli-config.json` — `sandbox.mode` / `readBoundary` / `approvalMode`
- `agent-host/config/hooks.json` — `preToolUse[0].failClosed: true`
- xangi 側 `src/cursor-cli.ts:136-161`、`src/antigravity-cli.ts:124-161`、`src/slot-runtime.ts`
- `.github/scripts/gdg-agent-layout.test.mjs:70-122` — 現在アドホックに検査されている不変条件

### 再利用する既存実装

- **`.github/scripts/gdg-agent-layout.test.mjs:70-122`** — 移植すべき不変条件がここに列挙されている。
  能力契約の検査項目の出発点にする
- **`cli/internal/agenthost/spec.go`（Stage 06）** — spec のパースと検証。ここに契約検査を足す
- **`cli/internal/agenthost/plan.go`（Stage 06）** — `plan` フェーズで契約を検査し、
  満たさなければ `apply` に進ませない

## Design — 設計

### 1. spec への追加

```jsonc
"backend": {
  "name": "cursor",
  "model": "composer-2.5",
  "isolation": {
    "slotLauncher": true,                  // uid 分離: sudo → spawn-slot-N 経由で起動する
    "osSandbox": "workspace",              // OS サンドボックス: 読み取り境界（"workspace" | "none"）
    "toolGate": "preToolUse-failClosed"    // ACL ゲート: fail-closed なプログラム的 pre-tool フック
  }
}
```

`agent-host/agent-host.schema.json` で `isolation` を**必須**にする。省略できてはならない。

### 2. バックエンド能力レジストリ

`cli/internal/agenthost/backend.go` に、各バックエンドが**実際に提供できる**能力を持つ:

```go
type BackendCapabilities struct {
    SlotLauncher bool
    OSSandbox    string   // "workspace" | "none"
    ToolGate     string   // "preToolUse-failClosed" | "none"
    PolicyBundle string   // config/backends/<name>/ のディレクトリ名
}

var backends = map[string]BackendCapabilities{
    "cursor": {
        SlotLauncher: true,
        OSSandbox:    "workspace",
        ToolGate:     "preToolUse-failClosed",
        PolicyBundle: "cursor",
    },
    "antigravity": {
        SlotLauncher: false,   // Stage 12 で true になる
        OSSandbox:    "none",  // Stage 14 の疎通確認次第
        ToolGate:     "none",  // Stage 14 の疎通確認次第
        PolicyBundle: "antigravity",
    },
}
```

**このレジストリは実装の事実を反映する。** 願望を書かない。
Stage 12（slot 分離の引き上げ）と Stage 14（Antigravity 対応）が進むにつれて更新される。

### 3. fail closed の強制

`plan` フェーズで:

1. spec の `backend.name` からレジストリを引く。未知のバックエンドは**エラー**
2. spec の `backend.isolation` の各項目に対し、レジストリの能力が**満たしているか**を検査する
3. 1 つでも満たさなければ **`apply` に進まず非ゼロで終了**し、
   「どの層が、どのバックエンドで、なぜ足りないか」を明示する

```
error: backend "antigravity" does not satisfy required isolation
  slotLauncher: required true, but antigravity-cli.ts does not use slot-runtime (see Stage 12)
  osSandbox:    required "workspace", but antigravity provides "none"
  toolGate:     required "preToolUse-failClosed", but antigravity provides "none"
```

**`--force` を実装しない。** これは安全装置であり、迂回路を作ると意味が消える。

### 3a. 本番の下限は spec から独立に持つ

上の検査だけでは**穴がある**。`backend.isolation` は同じ spec の中にあるので、
`isolation` を下げれば契約検査は通ってしまい、Stage 10 は Lima グリーンで自動的に
リリースを publish しうる。人が差分を見ないまま 3 層が外れる。

`agents-local/README.md` は 3 層を "none of which is optional in production" と書いている。
**この「production では非オプション」を、リリース spec とは別の場所で強制する。**

```go
// cli/internal/agenthost/backend.go — バイナリにコンパイルされる下限。
// リリース成果物からは変更できない。
var productionMinimum = IsolationRequirement{
    SlotLauncher: true,
    OSSandbox:    "workspace",
    ToolGate:     "preToolUse-failClosed",
}
```

`plan` フェーズの検査は 2 段になる:

1. spec の `backend.isolation` をバックエンドの能力が満たすか（上の検査）
2. **spec の `backend.isolation` が `productionMinimum` を下回っていないか**

2 に違反する spec は、能力がいくら足りていても `apply` されない。
下限は `gdg` バイナリ側にあるので、**リリースを作る側が下げることはできない**。

#### 3b. 下限は re-exec で差し替えられうる — その穴を塞ぐ

`productionMinimum` を `gdg` にコンパイルするだけでは**まだ足りない**。

Stage 07 の設計では、`apply` の冒頭で spec の `pins.gdgCli` と自分自身のバージョンを比較し、
**不一致ならピンされたバイナリを取得して re-exec する**。
ところが `pins.gdgCli` は**リリースが握っている値**である。したがって:

> `pins.gdgCli` を「`productionMinimum` が緩い、あるいは存在しない `gdg`」に向けたリリースを作れば、
> 現行バイナリは素直にそれへ re-exec し、以降の検査はすべて新しいバイナリの緩い下限で行われる。
> **下限をバイナリに置いた意味が消える。**

塞ぎ方は 2 つ。**両方やる。**

1. **re-exec の前に、いま走っている（信頼されている）バイナリが本番契約を検証する。**
   `pins.gdgCli` の解決より先に、spec の `environment` と `backend.isolation` を
   **現行バイナリの `productionMinimum`** で検査し、違反していればそこで落とす。
   re-exec 後の検査だけに頼らない
2. **`pins.gdgCli` の変更を独立した信頼ゲートに通す。**
   リリース署名鍵とは別の承認、または「既知の `gdg` リリースダイジェストの allowlist」を
   現行バイナリ側に持ち、そこに無いダイジェストへは re-exec しない。
   allowlist の更新は `gdg` のリリースを伴う（= 別のレビュー対象になる）

> **一般化するとこうなる**: 「リリースが選べる値」で「リリースを検証する仕組み」を選ばせてはならない。
> `pins.gdgCli` は検証する側を選ぶ値なので、他のピンとは信頼レベルが違う。

**下限を下げる正規の経路**（Lima や実験用ホスト）:

- spec の `environment: "development"`（既定は `"production"`）でのみ下限が緩む
- `environment` を `development` にした spec は **Stage 10 のリリース publish 対象外**にする
  （CI で弾く）。開発用 spec が本番リリースになる経路を塞ぐ
- 本番で恒久的に下げたい場合は `gdg` 側の `productionMinimum` を変える必要があり、
  それは CLI のリリースを伴う別のレビュー対象になる

**この二重化がこのステージの本質。** 契約だけでは、契約を書き換える権限を持つ者が
契約を無効化できてしまう。

### 4. ポリシーバンドルの配置

`agent-host/config/backends/<name>/` にバックエンド別のポリシーを置く。
現状 `agent-host/config/` 直下にある cursor 固有ファイルを移す:

```
agent-host/config/backends/cursor/
  cli-config.json      # sandbox.mode, readBoundary, approvalMode, permissions.allow
  hooks.json           # preToolUse, failClosed
  sandbox.json.in      # __RUN_SLOT_DIR__
  permissions.json     # gwsAllowlist
  mcp.json.in          # __INDEX_SOCKET__
```

収束エンジンは**選択中のバックエンドのバンドルだけ**を配置する。
配置先は現状と同じ（`~gdgagent-run-N/.cursor/` はバックエンドによって変わりうるので、
バンドルに配置先も持たせる）。

### 5. 既存の不変条件を契約検査に統合する

`gdg-agent-layout.test.mjs:70-122` にあるアドホックなアサーションを、
**バックエンドに紐づく検査**として `backend.go` に移す:

- `hooks.preToolUse[0].failClosed === true`（`toolGate` が `preToolUse-failClosed` のとき必須）
- `sandbox.mode === "enabled"` かつ `readBoundary === "workspace"`（`osSandbox` が `workspace` のとき必須）
- `additionalReadonlyPaths` が `/run/gdg-agent/N` を含み**親の `/run/gdg-agent` を含まない**
- sandbox に `.config/gdg` / `.config/xangi` が含まれない
- sudoers に `spawn-slot-N` の行がある（`slotLauncher` が true のとき必須）

### 制約

- **`--force` や `--skip-capability-check` を実装しない。** 安全装置に迂回路を作らない
- **レジストリに願望を書かない。** 実装の事実だけを書く。Stage 12/14 の進捗に応じて更新する
- **`isolation` をスキーマ上 optional にしない。** 省略できると既定値の解釈で事故る
- **`productionMinimum` をリリース成果物から読まない。** spec・config・バンドルのいずれからも
  読めてはならない。バイナリにコンパイルする
- **re-exec 後の検査だけに依存しない。** 現行バイナリが re-exec の前に本番契約を検証する
- **`pins.gdgCli` を他のピンと同列に扱わない。** これは「検証する側を選ぶ値」であり、
  独立した信頼ゲート（allowlist または別承認）を通す
- **`environment: "development"` の spec を Stage 10 のリリース対象にしない**
- **`sandbox.json` / `permissions.json` / `hooks.json` の中身をモデル化しない**
  （全体方針の制約）。バンドルは checked-in ファイルのまま扱い、
  契約検査は「必要なキーが期待値であること」の検証に留める
- Stage 12（xangi 側の slot 分離引き上げ）と Stage 14（Antigravity 実装）には踏み込まない。
  このステージは**契約と強制機構だけ**を作る
- 現状の cursor 構成が契約検査を通ることを必ず確認する（既存構成を壊さない）

## Files to touch — 変更ファイル

### 新規
- `cli/internal/agenthost/backend.go`（能力レジストリと契約検査）
- `cli/internal/agenthost/backend_test.go`
- `agent-host/config/backends/cursor/`（現行 `config/` の cursor 固有ファイルを移動）
- `agent-host/config/backends/antigravity/`（Stage 14 で中身が入る。この時点では空か README のみ）

### 更新
- `agent-host/agent-host.json`（`backend.isolation` を追加）
- `agent-host/agent-host.schema.json`（`isolation` を必須に）
- `cli/internal/agenthost/spec.go`（`isolation` のパース）
- `cli/internal/agenthost/plan.go`（契約検査を `plan` フェーズに組み込む）
- `cli/internal/agenthost/layout.go`（選択中バンドルの配置）
- `cli/internal/agenthost/testdata/golden/`（バンドル移動を反映）
- `.github/scripts/gdg-agent-layout.test.mjs`（:70-122 のアサーションを `backend.go` へ移送）
- `agent-host/README.md`（3 層と能力契約の対応を記述）
- `docs/agents-local-mvp/adr.md`（能力契約の導入を記録）

## Verification — 完了条件と検証

### 完了条件

- `backend.isolation` が spec の必須フィールドである
- `backend.name` を `antigravity` にした spec が、能力契約を満たさない限り `apply` されない
- **`backend.isolation` を下げた `environment: "production"` の spec が `apply` されない**
  （下限が spec の外にあること）
- 現行の cursor 構成が契約検査を通り、ホストの生成物が変わらない
- `gdg-agent-layout.test.mjs:70-122` の不変条件が `backend.go` の契約検査に移っている

### コマンド

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

```bash
gdg agent-host apply --spec agent-host/agent-host.json --dry-run --diff
```

```bash
npx ajv-cli validate -s agent-host/agent-host.schema.json -d agent-host/agent-host.json
```

```bash
gdg agent-host render --spec agent-host/agent-host.json --out /tmp/golden && diff -r cli/internal/agenthost/testdata/golden /tmp/golden
```

### 回帰として固定すべきテスト

- **`backend.name` を `antigravity` にした spec で `apply` が非ゼロで落ち、ホストが無変更のまま**
  （本ステージの中心。ここが抜けると「push したら 3 層防御が黙って外れる」が実現してしまう。
  これは静かに壊れる経路の典型であり、事故ってからでは遅い）
- **エラーメッセージが「どの層が、どのバックエンドで、なぜ足りないか」を明示する**
  （実装者が次に何をすべきか分かること）
- **`--force` 相当のフラグが存在しない**（安全装置に迂回路が無いこと。
  フラグ一覧を固定するテストで担保する）
- **`isolation` を下げた production spec が `apply` で落ちる**
  （契約を書き換えて契約を無効化する経路の遮断。これが無いと
  「spec を 1 行変えて push したら 3 層が外れる」が Stage 10 の自動 publish 経由で成立する）
- **`productionMinimum` が spec・config・バンドルから読み込まれていない**
  （ソース上、リリース成果物由来の値が代入されないこと）
- **`pins.gdgCli` を緩い下限のバイナリに向けた production spec で、
  re-exec が起きる前に現行バイナリが落とす**
  （下限をバイナリに置いた意味が消える経路。**リリースが検証する側を選べてしまう**ため、
  これが抜けると Stage 11 の二重化が丸ごと回避できる）
- **allowlist に無いダイジェストの `gdg` へ re-exec しない**
- **`environment: "development"` の spec がリリース CI で弾かれる**（Stage 10 と連動）
- **`isolation` を省略した spec がスキーマ検証で落ちる**
- **現行の cursor spec で `render` の出力が変わらない**（バンドル移動が生成物を変えていないこと）
- **`slotLauncher: true` のとき sudoers に `spawn-slot-N` の行が必須**
- **`osSandbox: "workspace"` のとき `sandbox.mode === "enabled"` かつ
  `readBoundary === "workspace"` が必須**
- **`toolGate: "preToolUse-failClosed"` のとき `hooks.preToolUse[0].failClosed === true` が必須**
- **`additionalReadonlyPaths` が親の `/run/gdg-agent` を含むとき契約検査が落ちる**
  （スロット間分離が壊れる経路）

### 手動 E2E

1. 現行の cursor spec で `gdg agent-host apply --dry-run --diff` が**変更なし**を報告することを確認する
   （契約導入が既存構成を壊していないこと）
2. `agent-host.json` の `backend.name` を `antigravity` に変え、`apply --dry-run` を実行する
3. **非ゼロで落ち、3 層すべてについて理由が表示される**ことを確認する
4. `apply`（dry-run 無し）でも同様に落ち、**ホストに一切変更が入らない**ことを確認する
5. `backend.isolation.toolGate` を `"none"` に下げた **production** spec を作り、
   **`apply` が下限違反で落ちる**ことを確認する（spec 側で契約を無効化できないこと）
5a. 同じ spec を `environment: "development"` にすると Lima では通り、
    かつリリース CI が publish 対象から弾くことを確認する
5b. **re-exec 穴の確認**: `pins.gdgCli` を allowlist に無いダイジェスト
    （あるいは下限を外したビルド）に向けた production spec を作り、
    **re-exec される前に現行バイナリが落とす**ことを確認する
6. Lima VM で `apply` を実行し、`gdg agent-host verify` の 13 検査が通ることを確認する
