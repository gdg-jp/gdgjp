# Stage 10 — Tier 2: 署名リリースと pull 型適用、ロールバック

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 10。**依存: Stage 09。**

**全体方針の要求 3 がここで満たされる**: リポジトリの HEAD が本番ホストの構成と一致していることが
常に機械的に検証され、spec の変更が本番に適用される。

Tier 1（Stage 09）は `agent-host/workspace/**` だけを再起動なしで配信した。
Tier 2 は spec・ピン・config・systemd unit・backend を扱う。ブラスト半径が桁違いなので機構を分ける。

### なぜ pull 型なのか（決定済み、`docs/agents-local-mvp/adr.md`）

push 型（GitHub Actions から ssh、または self-hosted runner）を採らない理由:

- **リポジトリを public にするため、self-hosted runner は fork PR からのコード実行経路になる。**
  GitHub 自身が公開リポジトリでの self-hosted runner 利用を警告している
- ssh デプロイは CI に root 相当の資格情報を持たせ、ホストへの inbound 到達性を要求する
- pull 型なら inbound 不要・CI がホスト資格情報を持たない・ロールバックが
  「前のリリースを指す」だけで済む

### 署名基盤は Stage 09 で作成済み

`cli/internal/agenthost/signing.go`（Ed25519 マニフェスト検証）、
`scripts/build-agent-host-bundle.mjs`（バンドル作成 + 署名）、検証用公開鍵のホスト配置、
署名鍵の管理方針は **Stage 09 で作られている**。

本ステージはそれを **Tier 2 のリリースに再利用する**。マニフェスト形式と検証コードは同一で、
対象パスと、この後に足すリリース世代管理・ロールバックだけが違う。
**新しい署名方式を作らない。**

元となった設計は xangi の `src/installer/` と `packaging/build-installer.mjs`
（`@MANIFEST_SHA256@` / `@ASSET_SHA256@` トークンをビルド時に埋める方式）。

### このステージで生じる新しいセキュリティ要件

**リポジトリへの push が本番ホストの root 相当になる。** これは要求そのものだが、
帰結を明示的に扱う必要がある:

1. **branch protection と署名コミット** — Stage 02 の公開判断と同格で扱う
2. **リリース署名鍵の管理** — CI の secret に置くか、別の署名経路にするか
3. **自己改変経路の遮断** — エージェントは `/srv/gdg-agent/wiki`（wiki transport）を worktree に持ち、
   `gdgagent-svc` は `gdg` 資格情報を持つ。**エージェントから到達できるどの経路も、
   リリースを生成するリポジトリへ push できず、リリース検証鍵を書けない**ことを
   不変条件としてテストで固定する

現状の防御: スロットの sandbox は `readBoundary: workspace` で `/opt/gdgjp` は範囲外、
worktree は wiki transport でありモノレポではない。ただし `gdgagent-svc`（xangi 本体と
sleep scheduler が動く uid）は別。ここを明示的に検証する。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針、Tier 1/2 の区別
- `docs/agents-local-refactoring/09-workspace-sync.md` — 前段。Tier 1 の配信機構
- `docs/agents-local-refactoring/02-public-content-review.md` — 公開判断（本ステージで
  「push = 本番 root 相当」になることの前提）
- xangi 側 `src/installer/` 全体、`packaging/build-installer.mjs` — 署名マニフェストの実装
- `agent-host/config/systemd/` — Stage 09 で作った sync タイマー（同じ形に揃える）

### 再利用する既存実装

- **`cli/internal/agenthost/signing.go` と `scripts/build-agent-host-bundle.mjs`（Stage 09）** —
  **署名と検証はこれをそのまま使う。書き直さない**
- **xangi の `src/installer/` + `packaging/build-installer.mjs`** — Stage 09 が踏襲した元の設計。
  リリース世代管理の参考にする
- **`gdg agent-host verify`（Stage 07）** — 13 検査。**デプロイ後ヘルスチェックにそのまま使う**
- **`gdg agent-host apply --dry-run --diff`（Stage 06）** — 終了コードで差分の有無を返す。
  **drift 検査にそのまま使う**
- **Stage 09 の `agent-host-sync.timer`** — タイマー unit の形。`agent-host-apply.timer` を同じ形で作る
- **`cli/internal/update/`** — `gdg` の更新経路。マニフェスト取得と検証の一部を再利用できる

## Design — 設計

### 1. リリース成果物

CI（push to main）が作るバンドル:

**マニフェストと署名はアーカイブの外に置く（detached）。**

```
agent-host-<version>.tar.gz        # ペイロードのみ。マニフェストを含まない
  agent-host.json                  # spec
  config/                          # sandbox.json.in, hooks.json, permissions.json, mcp.json.in, ...
  workspace/                       # Tier 1 と共有。**適用は必ず sync-workspace 経由**（下記）

agent-host-<version>.manifest.json # エンベロープ（アーカイブの外）
  { "version": "...",
    "archive": { "name": "...tar.gz", "size": 12345, "sha256": "..." },
    "entries": { "<path>": "<sha256>", ... },   // 展開時の allowlist 兼 per-file 検証
    "entryCount": 123, "uncompressedSize": 456 }

agent-host-<version>.manifest.json.sig   # エンベロープへの Ed25519 署名
```

> **マニフェストをアーカイブの中に入れてはならない。** Stage 09 の
> 「0a. アーカイブ展開の防御」は**展開前に**アーカイブ全体の digest を照合する。
> マニフェストが中にあると、アーカイブのバイト列が自身の digest に依存する循環になり、
> そもそも生成できない。
>
> 検証の順序は: 署名 → エンベロープ → `archive.sha256` と `size` を実バイトに対して照合 →
> 展開（`entries` を allowlist として使用）→ per-file sha256 照合。
> **署名検証はアーカイブに一度も触れずに完了する。**

`gdg` バイナリ自体はバンドルに含めない（spec の `pins.gdgCli` で参照し、
apply 冒頭の re-exec で解決する。Stage 07 の設計）。

### 2. CI パイプライン（`.github/workflows/agent-host-release.yml`）

push to main で:

1. **spec スキーマ検証**（JSON Schema）
2. **`environment` ゲート** — `environment !== "production"` の spec を**リリース対象から弾く**（下記）
3. **golden レンダリング差分** — `gdg agent-host render` の出力が
   `cli/internal/agenthost/testdata/golden/` と一致すること
4. **意味的不変条件**（Stage 06/07 で確立したもの）— sudoers にワイルドカードが無い、
   `failClosed === true`、`additionalReadonlyPaths` が親を含まない、など
5. **バックエンド能力契約**（Stage 11）— `backend.isolation` の 3 項目が満たされていること、
   **かつ `productionMinimum` を下回っていないこと**
6. **Lima 統合テスト** — 実際に `useradd` / systemd / apparmor / sudo を動かす唯一の場所
7. 全部グリーンなら **Ed25519 署名済みリリースを publish**

#### 2 の `environment` ゲートが必要な理由

Stage 11 は、本番の 3 層の下限を `gdg` バイナリ側の `productionMinimum` として持ち、
**`environment: "development"` の spec でだけ下限を緩める**設計にした（Lima や実験用ホストのため）。

その緩和は spec の宣言だけで有効になるので、**development spec はスキーマ検証も能力契約検査も通る。**
`environment` を見ないままリリース CI を回すと、下限を外した spec がそのまま
本番向けリリースとして publish され、Stage 11 の二重化が無意味になる。

したがってこのワークフローは、他のどの検査とも独立に
**`environment === "production"` であることをリリースの前提条件**として検査する。
`environment` フィールドが欠けている spec も弾く（既定値の解釈で事故らせない）。

**ゲートの置き方は knob。** 「Lima グリーンなら自動 publish」が要求に最も近い。
GitHub Environment protection rule で人手承認を挟むこともでき、
`backend.name` など特定フィールドの差分に限って承認必須にするのが中間案。
**採用した方式を `adr.md` に記録する。**

### 3. ホスト側（pull）

`agent-host-apply.timer`（間隔は spec で指定。既定 1 時間程度）が起動する
`agent-host-apply.service`:

1. 最新リリースの**エンベロープと署名**（detached）を取得する
2. **Ed25519 署名を検証する**（失敗したら適用せず非ゼロ終了）。
   この時点でアーカイブはまだ取得・展開していない
2a. アーカイブを取得し、`archive.sha256` と `size` を実バイトに対して照合する
3. 現在適用中のリリースと同じなら、`apply --dry-run --diff` だけ実行して
   **drift を journal に記録**し終了（差分があれば非ゼロ）
4. 新しいリリースなら:
   - `apply --dry-run --diff` の結果を journal に記録
   - **`workspace/` 部分を `sync-workspace` トランザクションで適用する**（下記）
   - 残り（spec・config・unit・パッケージ）を `apply` で適用する
   - **`gdg agent-host verify` を実行**
   - verify 失敗 → **前リリースへ自動ロールバック** → 再度 verify → journal に記録

### 3a. `workspace/` は必ず Stage 09 のトランザクション経由で適用する

Tier 2 のリリースはロールバックのため**完全なスナップショット**として `workspace/` を含む。
だが `/srv/gdg-agent/wiki` は**稼働中の worktree** であり、汎用の `apply` が
`file` リソースとして直接書くと、Stage 09 が用意した保護を全部飛ばすことになる:

- wiki mutex（sleep ingest との競合）
- ローカル変更の検出（破壊せず報告する動作）
- クラッシュ安全性（方式 A の atomic 入れ替え、または方式 B の journal + リカバリ）

**したがって収束エンジンは、`workspace/` 配下のパスを汎用 `file` リソースとして扱ってはならない。**
`workspace/` は専用の `workspace` リソースにマップし、その `Apply` が
Stage 09 の `sync-workspace` トランザクション（mutex 取得 → リカバリ → 原子的切り替え → mutex 解放）を
そのまま呼ぶ。ロールバック時も同じ経路を通る。

これを構造的に強制するため、`plan` フェーズで
「`paths.workspace` 配下を対象とする `file`/`dir` リソースが存在しない」ことを検査する。

### 4. ロールバック

- 適用済みリリースを `/var/lib/agent-host/releases/<version>/` に保持する（直近 N 個）
- `current` シンボリックリンクで現在のリリースを指す
- ロールバック = `current` を前のバージョンに向けて `apply` し直す
- 手動でも `gdg agent-host rollback [--to <version>]` で実行できる

### 5. drift 検査

Stage 06 で `apply --dry-run` が差分の有無を終了コードで返すようにしてある。
これをタイマーで回して journal に出す。**デプロイ CI が無いホストに対する最も安価な代替。**

なお `cli/internal/wiki/hooks.go:131` `inspectInstalledScripts` が既に同じパターン
（望ましい状態と実状態の内容比較）を実証している。

### 6. 自己改変経路の遮断（テストで固定する不変条件）

- `gdgagent-run-<N>`（slot uid）から `/var/lib/agent-host/` が読めない・書けない
- `gdgagent-run-<N>` からリリース検証用の公開鍵が書けない
- `gdgagent-svc` の `gdg` 資格情報でモノレポへ push できない
  （wiki transport のトークンとモノレポの write 権限が分離されていること）
- スロットの sandbox `additionalReadonlyPaths` に `/var/lib/agent-host` が含まれない

### 制約

- **署名検証を省略する経路を作らない。** `--skip-verify` のようなフラグを実装しない
- **マニフェストをアーカイブの内側に置かない。** detached にする（digest の循環が生じる）
- **Stage 09 の `signing.go` を再実装しない。** 検証コードが 2 つあると片方だけ直る
- **verify 失敗時に「とりあえず動いているから放置」しない。** 自動ロールバックする
- **`apply` の途中で `gdg` を自己更新しない**（Stage 07 の re-exec 設計を維持）
- **secrets はリリースに含めない**（Stage 07 の `secrets` サブコマンドで別管理）
- **Tier 1 の速い経路にランタイム変更を混ぜない**（Stage 09 の境界を維持）
- **Tier 2 が `workspace/` を汎用 `file` リソースで書かない。** 必ず Stage 09 の
  `sync-workspace` トランザクションに委譲する。`plan` フェーズで機械的に検査する
- self-hosted runner を使わない。public リポジトリでの fork PR コード実行経路になる
- **`environment !== "production"` の spec をリリースしない。** 検査を「他がグリーンなら」の
  条件付きにせず、独立した前提条件として置く
- ロールバック先が無い（初回リリース）場合の挙動を定義する。
  「verify 失敗 + ロールバック不能」は人間を呼ぶべき状態であり、黙って続行しない

## Files to touch — 変更ファイル

### 新規
- `.github/workflows/agent-host-release.yml`
- `cli/internal/agenthost/release.go`（マニフェスト取得、リリース世代管理。
  **署名検証は Stage 09 の `signing.go` を呼ぶ**）
- `cli/internal/agenthost/rollback.go`
- `agent-host/config/systemd/agent-host-apply.service`
- `agent-host/config/systemd/agent-host-apply.timer`
- `cli/internal/agenthost/release_test.go`
- `scripts/build-agent-host-release.mjs`（Tier 2 のリリースバンドル作成。
  **署名は Stage 09 の `build-agent-host-bundle.mjs` の機構を再利用する**）

### 更新
- `cli/internal/command/agent_host.go`（`rollback`、リリース指定の `apply`）
- `agent-host/agent-host.json`, `agent-host/agent-host.schema.json`
  （リリース取得元 URL、apply タイマー間隔、保持リリース数）
- `cli/internal/agenthost/testdata/golden/`（apply の unit/timer を追加）
- `agent-host/README.md`（運用手順: リリース、ロールバック、drift 確認）
- `docs/agents-local-mvp/adr.md`（Tier 2 のゲート方式、署名鍵の管理方針を記録）

## Verification — 完了条件と検証

### 完了条件

- spec の `backend.model` を変えて push すると、Lima グリーン後にリリースが publish され、
  ホストのタイマーが取得して適用し、`systemctl --user show xangi.service` の `AGENT_MODEL` が追随する
- `gdg agent-host apply --dry-run --diff` が本番ホストで**変更なし**を報告する
  （リポジトリ HEAD = ホスト構成）
- 署名検証に失敗したリリースが適用されない
- `verify` 失敗時に前リリースへ自動ロールバックする
- drift 検査がタイマーで回り、差分が journal に出る

### コマンド

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

```bash
sudo gdg agent-host apply --dry-run --diff; echo "exit=$?"
```

```bash
sudo gdg agent-host verify
```

```bash
journalctl --user -u agent-host-apply.service -n 100
```

### 回帰として固定すべきテスト

- **エージェントから到達できる経路がリリース生成リポジトリへ push できず、
  リリース検証鍵を書けない**（自己改変の遮断。これが破れると「エージェントが自分の ACL ゲートを
  書き換える」経路が成立する。本ステージで最も重要な不変条件）
- **署名検証に失敗したリリースが適用されない**（`--skip-verify` 相当の抜け道が無いこと）
- **`apply` 失敗時に前リリースへロールバックし、`verify` の 13 検査が通る状態に戻る**
- **ロールバック先が存在しないときは黙って続行せず、非ゼロで終了して journal に記録する**
- **`apply --dry-run` が差分ありのとき非ゼロを返す**（drift 検査が機能するための前提）
- **リリースに secrets が含まれない**（`auth.json` / `secrets.json` / `credentials.json` の
  パターンがバンドルに現れないこと）
- **マニフェストがアーカイブの外にあり、`archive.sha256` が実バイトと一致する**
  （マニフェストを中に入れると digest の循環でリリースを生成できない）
- **アーカイブを差し替えると署名検証は通っても `archive.sha256` の照合で落ちる**
- **Tier 2 のリリースが `agent-host/workspace/**` 以外も含む一方、Tier 1 は含まない**
  （Tier 境界の担保）
- **`plan` が `paths.workspace` 配下を対象とする `file`/`dir` リソースを生成しない**
  （Tier 2 が Stage 09 の mutex・ローカル変更検出・クラッシュ安全性を迂回する経路の遮断。
  迂回されると、sleep ingest 実行中にリリース適用が worktree を壊しうる）
- **Tier 2 のロールバックでも `workspace/` が `sync-workspace` 経由で戻る**
- **`backend.isolation` を満たさない spec ではリリースが publish されない**（Stage 11 と連動）
- **`environment: "development"` の spec でリリースが publish されない**
  （development spec は Stage 11 の `productionMinimum` を回避できるため、
  スキーマ検証も能力契約も通ってしまう。`environment` を独立に見ないと、
  下限を外した spec が本番リリースになる。Stage 11 の二重化が無意味になる経路）
- **`environment` フィールドが欠けている spec でも publish されない**（既定値の解釈で事故らせない）

### 手動 E2E

1. Lima VM で Stage 09 完了状態を作り、`agent-host-apply.timer` を有効にする
1a. **`environment` ゲートの確認**: `environment: "development"` の spec で CI を回し、
    他の検査がグリーンでも**リリースが publish されない**ことを確認する
2. **正常系**: `agent-host.json` の `backend.model` を変更 → CI でリリース publish →
   タイマーを待つ（または手動起動）→ `systemctl --user show xangi.service` で `AGENT_MODEL` が
   追随していることを確認する
3. **署名検証**: マニフェストを改竄したリリースを置き、適用されず非ゼロで終了することを確認する
4. **ロールバック**: 意図的に `verify` が失敗する spec（例: sandbox から必要なパスを削る）を
   リリースし、自動ロールバックが起き、`verify` が通る状態に戻ることを確認する
5. **drift 検査**: ホスト上のファイルを手で書き換え、次の drift 検査が journal に差分を出し
   非ゼロで終了することを確認する
5a. **workspace 委譲の確認**: `workspace/` を含むリリースを、wiki mutex を別プロセスで
    保持した状態で適用し、**適用が待つか譲る**ことを確認する
    （汎用 `apply` が直接書いているなら待たずに壊れる）
6. **自己改変の確認**: `sudo -u gdgagent-run-0` で `/var/lib/agent-host/` の読み書きを試み、
   拒否されることを確認する。`gdgagent-svc` の資格情報でモノレポへ push できないことを確認する
7. **本番 `mincra-srv`**: まず drift 検査だけを有効にして数日回し、
   `--dry-run --diff` が安定して「変更なし」を報告することを確認してから、
   自動 apply を有効にする
