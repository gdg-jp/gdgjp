# Stage 12 — slot 分離をアダプタから引き剥がす（xangi 側）

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 12。**依存: Stage 07。並行可: Stage 08〜10。
Stage 14 の前提。**

> **このステージは別リポジトリ（xangi）の変更である。** Stage 13 で `gdg-jp/xangi` へ移管するので、
> 移管の前後どちらで実施するかを先に決めること。移管後のほうが望ましい。

### 解く問題

uid 分離が**単一のアダプタに溶接されている**。`grep -rl "slot-runtime" src/` の結果は
`src/cursor-cli.ts` / `src/gdg-authz.ts` / `src/index.ts` の 3 本のみで、
実際に slot 起動を行っているのは `cursor-cli.ts` だけ。

`src/cursor-cli.ts:136-161` の流れ:

```
slotIsolationEnabled()          # :136 — 無効なら素の spawn に落ちる
  → authz.slot の存在確認       # :139-141 — 無ければ throw
  → assertSlotLauncher(slot)    # :142 — /opt/gdg-agent/bin/spawn-slot-N の存在確認
  → workspace ディレクトリ確認   # :144
  → writeSpawnSpec(slot, {...}) # :149
  → sudoLauncherArgs(slot)      # :161 — sudo -u gdgagent-run-N ... で起動
```

一方 `src/antigravity-cli.ts` は素の `spawn()`（:204, :228）。
`src/codex-cli.ts` / `src/claude-code-cli.ts` / `src/grok-cli.ts` も同様。

**つまり `AGENT_BACKEND` を cursor 以外にすると uid 分離が消える。**
これは Antigravity 固有の問題ではなく、**cursor 以外の 4 バックエンドすべてに空いている穴**である。

Stage 11 の能力契約はこれを spec レベルで**検出して拒否する**が、
このステージは**穴そのものを塞ぐ**。

### なぜ引き剥がしが正しいのか

xangi には既に共通基底がある。`src/cli-runner-core.ts` の `CliRunnerBase` が
spawn / タイムアウト / JSONL バッファリング / 終了エラー構築を持ち、
各アダプタは argv 構築とイベントパースだけを実装する設計になっている
（`docs/design.md:315` に「5 アダプターは抽象基底クラスを継承する」と明記）。

**slot 起動は spawn の一形態であり、基底クラスの責務である。** アダプタごとの argv 構築とは直交する。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針、3 層の表
- `docs/agents-local-refactoring/11-backend-capability-contract.md` — 能力契約（このステージの結果を反映する）
- `docs/agents-local-mvp/07-agent-uid-isolation.md`（655 行）— uid/slot モデルの設計根拠
- xangi 側:
  - `src/slot-runtime.ts` — `slotIsolationEnabled` / `assertSlotLauncher` / `writeSpawnSpec` /
    `sudoLauncherArgs`。`DEFAULT_RUNTIME_ROOT = '/run/gdg-agent'`, `DEFAULT_AGENT_ROOT = '/opt/gdg-agent'`
  - `src/cursor-cli.ts:136-161` — 現在の唯一の実装
  - `src/cli-runner-core.ts` — `CliRunnerBase`。引き上げ先
  - `src/antigravity-cli.ts:124-161, 204, 228` — argv 構築と素の spawn
  - `src/agent-runner.ts:114-146` — `createAgentRunner` の 6 分岐
  - `src/gdg-authz.ts` — slot の割り当て元
- `cli/internal/wiki/hooks/exec-spawn.ts` — `/opt/gdg-agent/bin/spawn-slot-<N>` から起動される側。
  `:15-16` の `/run/gdg-agent/${slot}` と `/home/gdgagent-run-${slot}`、
  `:62` の `PATH: "/opt/gdg-agent/bin:/usr/bin:/bin"`、`:64-66` の `XANGI_AUTHZ_*` 注入

### 再利用する既存実装

- **`src/slot-runtime.ts` の全関数** — 引き剥がしであって作り直しではない。**中身は変えない**
- **`src/cursor-cli.ts:136-161`** — 引き上げるロジックの正本。ここから `CliRunnerBase` へ移す
- **`src/cli-runner-core.ts` の `CliRunnerBase`** — 既存の共通基底。新しい抽象を作らない
- **`cli/internal/wiki/hooks/exec-spawn.ts`** — spawn 先の契約（環境変数、PATH、cwd）。
  ここが変わらない限りアダプタ側だけの変更で済む

## Design — 設計

### 1. `CliRunnerBase` への引き上げ

`src/cli-runner-core.ts` の spawn 経路に slot 分離を組み込む:

1. `slotIsolationEnabled()` が true なら、`spawn(cmd, args)` の代わりに
   `writeSpawnSpec(slot, {...})` → `sudoLauncherArgs(slot)` 経由で起動する
2. false なら従来どおり素の `spawn()`
3. **アダプタは argv を返すだけ**にし、どう起動するかは基底が決める

`cursor-cli.ts` からは引き上げたロジックを削除し、他アダプタと同じ形にする。

### 2. fail closed の維持

`agent-host/README.md` は現状の cursor について
「`/opt/gdg-agent/bin` が存在するのに launcher が無い場合、フォールバックせず**失敗する**」
と記述している。この性質を基底クラスでも維持する:

- `slotIsolationEnabled()` が true で slot が未割り当て → **throw**（素の spawn に落ちない）
- `assertSlotLauncher(slot)` が失敗 → **throw**

**「分離できないなら動かない」を全アダプタで守る。** ここを緩めると、
Stage 11 の能力契約が spec レベルで守っているものを実行時に裏切ることになる。

### 3. `writeSpawnSpec` のアダプタ非依存化

`writeSpawnSpec` が現在 cursor 固有の情報を持っているなら、
**コマンドと argv を受け取る汎用形**にする。`exec-spawn.ts` 側の契約
（`PATH`, `USER`, `XANGI_AUTHZ_NONCE`, `XANGI_AUTHZ_SOCKET`）は変えない。

`cli/internal/wiki/hooks/exec-spawn.ts` に変更が必要になる場合は、
**monorepo 側の変更と `gdg` CLI のリリースが要る**ことに注意する
（`/opt/gdg-agent/lib/exec-spawn.ts` は `gdg` の embed から配置される。Stage 05）。
可能な限り `exec-spawn.ts` を変えずに済む設計にする。

### 4. 能力レジストリの更新

Stage 11 の `cli/internal/agenthost/backend.go` を更新する:

```go
"antigravity": {
    SlotLauncher: true,    // このステージで true になる
    OSSandbox:    "none",  // Stage 14 の疎通確認次第
    ToolGate:     "none",  // Stage 14 の疎通確認次第
    ...
},
```

`codex` / `claude-code` / `grok` についても同様に `SlotLauncher: true` になる。
**レジストリは実装の事実を反映する**（Stage 11 の制約）ので、
このステージが完了して初めて更新する。

### 5. xangi 側のテスト

- 各アダプタについて、`slotIsolationEnabled()` が true のとき
  `sudo -u gdgagent-run-N /opt/gdg-agent/bin/spawn-slot-N` 経由で起動されることを検証する
- slot 未割り当て時に throw することを検証する
- `slotIsolationEnabled()` が false（開発機）のとき従来どおり動くことを検証する

### 制約

- **`src/slot-runtime.ts` の中身を変えない。** 引き剥がしであって作り直しではない
- **`cli/internal/wiki/hooks/exec-spawn.ts` の契約を変えない。**
  変えると monorepo 側の変更と `gdg` リリースが連動して必要になる
- **フォールバックを作らない。** 「分離できないなら素の spawn で動かす」は
  3 層防御を実行時に裏切る。throw する
- **`local-llm` バックエンドの扱いを決める。** これはプロセス起動の形が違う可能性があるので、
  能力レジストリで `SlotLauncher: false` のまま残すか、対応するかを明示する
- Antigravity 固有の対応（ポリシーバンドル、`agy` の hook/sandbox 調査）は **Stage 14 の担当**
- Stage 11 の能力レジストリ更新は、このステージの実装が**完了してから**行う

## Files to touch — 変更ファイル

### xangi 側（別リポジトリ）
- `src/cli-runner-core.ts` — `CliRunnerBase` に slot 分離を組み込む
- `src/cursor-cli.ts` — :136-161 の引き上げ（削除）
- `src/slot-runtime.ts` — `writeSpawnSpec` のアダプタ非依存化（必要な場合のみ）
- `src/antigravity-cli.ts`, `src/codex-cli.ts`, `src/grok-cli.ts`,
  `src/claude-code-cli.ts` — 基底の spawn 経路に乗せる
- `src/agent-runner.ts` — 必要に応じて `createAgentRunner` の分岐調整
- 対応するテストファイル

### monorepo 側
- `cli/internal/agenthost/backend.go` — 能力レジストリの `SlotLauncher` を更新
- `cli/internal/agenthost/backend_test.go`
- `docs/agents-local-mvp/07-agent-uid-isolation.md` — 引き上げを反映
- `agent-host/README.md` — Trust boundaries の節

## Verification — 完了条件と検証

### 完了条件

- `slotIsolationEnabled()` が true のとき、**全アダプタ**が
  `sudo -u gdgagent-run-N /opt/gdg-agent/bin/spawn-slot-N` 経由で起動される
- slot 未割り当てのとき、全アダプタが throw する（素の spawn に落ちない）
- `cursor-cli.ts` から slot 分離のロジックが消え、他アダプタと同じ形になっている
- 能力レジストリの `antigravity.SlotLauncher` が `true` に更新されている
- **cursor バックエンドの挙動が変わっていない**

### コマンド

xangi 側:

```bash
npm test
```

```bash
grep -rl "slot-runtime" src/
```

monorepo 側:

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

### 回帰として固定すべきテスト

- **`slotIsolationEnabled()` が true で slot 未割り当てのとき、全アダプタが throw し
  素の spawn に落ちない**（フォールバックが復活すると、Stage 11 の spec レベルの契約を
  実行時に裏切る。静かに壊れる経路の典型）
- **`AGENT_BACKEND` を cursor 以外にしても `sudo -u gdgagent-run-N` 経由で起動される**
  （このステージの目的そのもの）
- **cursor バックエンドの spawn 引数が変更前と同一**（引き上げが挙動を変えていないこと）
- **`slotIsolationEnabled()` が false のとき従来どおり素の spawn で動く**（開発機での動作）
- **`exec-spawn.ts` の環境変数契約（`PATH` / `USER` / `XANGI_AUTHZ_NONCE` /
  `XANGI_AUTHZ_SOCKET`）が変わっていない**（変わると `gdg` のリリースが連動して必要になる）
- **`grep -rl "slot-runtime" src/` が `cursor-cli.ts` を含まず `cli-runner-core.ts` を含む**
  （引き上げの完了を構造的に固定する）

### 手動 E2E

1. Lima VM で Stage 07 完了状態を作る（uid 分離が動いている状態）
2. **cursor での回帰確認**: 変更前後で Discord からエージェントに問い合わせ、
   `ps -eo user,cmd | grep cursor-agent` が `gdgagent-run-<N>` で動いていることを確認する
3. xangi の変更を適用する
4. cursor で再度 2 を実行し、**同じ結果**であることを確認する
5. `AGENT_BACKEND=codex`（または VM で実行可能な別バックエンド）に切り替え、
   `ps -eo user,cmd` でそのプロセスも `gdgagent-run-<N>` で動いていることを確認する
6. slot 割り当てを意図的に失敗させ、**素の spawn に落ちずエラーになる**ことを確認する
7. `sudo gdg agent-host verify` の 13 検査が通ることを確認する
8. 能力レジストリを更新し、`gdg agent-host apply --dry-run` で
   `backend.isolation.slotLauncher: true` が antigravity でも満たされることを確認する
   （ただし `osSandbox` と `toolGate` はまだ満たされないので、
   antigravity への切り替え自体は依然として拒否されるはず）
