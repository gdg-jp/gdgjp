# Stage 09 — 署名基盤と Tier 1: スキルを push したら本番に載る

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 09。**依存: Stage 08。**

> **このステージは署名済み成果物の基盤を含む。** Tier 1 も配信物であり、
> 検証なしで live worktree に書いてはならない。SHA-256 マニフェストは**完全性**を与えるが
> **真正性**を与えないため、暫定手段にもならない（改竄者はマニフェストごと差し替えられる）。
> したがって**署名・検証・鍵管理の共通基盤はこのステージで作る**。
> Stage 10 はそれを Tier 2 のリリースとロールバックに再利用する。

**全体方針の要求 1 がここで満たされる**: `agent-host/workspace/.agents/skills/` にスキルを足して
push すると、本番のエージェントがそのスキルを使えるようになる。

### 配信機構は既に存在する（自動化されていないだけ）

旧 `agent-host/install.sh:339-364` の `seed_wiki_cursor_files` が既に配信を行っていた:

1. `/srv/gdg-agent/wiki/.cursor/mcp.json` を配置
2. `AGENTS.md` から `.cursor/rules/local.mdc` を合成する。frontmatter を前置する:
   ```sh
   printf '%s\n' "---" "alwaysApply: true" "---" ""; cat "$src/AGENTS.md"
   ```
3. **`rm -rf` してから `cp -a`** で `.agents/` `.claude/` `.codex/` を配布（:355-360）

これは Stage 07 で収束エンジンに移送済み。このステージではそれを**定期実行する経路**を作る。

### 現状の配信が持つ 2 つの問題

**1. `rm -rf` + `cp -a` はホスト側のローカル編集を黙って破壊する。**
`/srv/gdg-agent/wiki/.agents` 以下に何か置かれていても、次の install で消える。
収束エンジンでは差分適用にし、想定外のローカル変更は破壊前に検出・報告する。

**2. wiki mutex を取っていない。**
`/srv/gdg-agent/wiki` は**稼働中の worktree**であり、xangi が sleep ingest と Discord ターンの
リポジトリ変更を 1 つの mutex で直列化している（`agent-host/README.md` の "Repository mutations
(sleep and Discord) share one mutex held by xangi"）。sleep は毎日 04:00 JST に走り、
`gdg wiki raw pull` → memories アップロード → ソースごとの ingest → `gdg wiki ingest --commit` を行う。

**mutex を取らずに worktree へ書くと ingest と競合する。** 5 分間隔のタイマーで書くなら必須。

### なぜ Tier を分けるのか

配信対象をブラスト半径で 2 段に分ける。

| | Tier 1（このステージ） | Tier 2（Stage 10） |
|---|---|---|
| 対象 | `agent-host/workspace/**` | spec・ピン・config・systemd unit・backend |
| 実体 | `/srv/gdg-agent/wiki` へコピーされるファイル | ホストの構成そのもの |
| サービス再起動 | 不要 | 必要 |
| 頻度 | 5 分タイマー | リリース単位 |
| ゲート | スキーマ検証 + hash 照合 | Lima 統合テスト |

これにより「スキルを push したら即反映」と「push = 本番 root 相当を無闇に許さない」を両立する。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針、特に Tier 1/2 の区別
- `docs/agents-local-refactoring/08-unify-bootstrap.md` — 前段
- `agent-host/README.md` — Sleep の節（mutex と `sleep-progress.json` の説明）
- `agent-host/workspace/AGENTS.md` — 配信対象。`local.mdc` の元
- `agent-host/skills-lock.json` — 44 エントリの `computedHash`（Stage 04 で処遇決定済み）
- xangi 側 `src/skills.ts:19-23` — `.claude/skills/` `.codex/skills/` `skills/` を走査して
  `SKILL.md` を読む実装。**配信先のディレクトリ名がここで決まっている**
- xangi 側 `src/gdg-cli.ts` — `gdg wiki` のロック取得経路

### 再利用する既存実装

- **Stage 07 で移送済みの `seed_wiki_cursor_files` 相当のロジック** — 配布先とフォーマットの正本。
  特に `local.mdc` の frontmatter 合成
- **`cli/internal/agenthost/resource_file.go`（Stage 06）** — 差分適用と temp-write→rename。
  workspace 配信もこのリソースに載せる
- **`agent-host/skills-lock.json`** — Stage 04 で `gdg skills verify` として検証器を作るか
  削除するかを決めている。作った場合は本ステージの CI 検証に組み込む
- **xangi の wiki mutex** — 新しいロック機構を作らない。xangi/`gdg wiki` が既に持つものを使う

## Design — 設計

### 0. 署名基盤（Stage 10 と共有する）

xangi の `src/installer/` と `packaging/build-installer.mjs` が **Ed25519 署名済みリリースマニフェスト**を
既に実装している。**このパターンを踏襲する。新しい署名方式を発明しない。**

本ステージで作るもの（Stage 10 がそのまま再利用する）:

- `cli/internal/agenthost/signing.go` — **detached なエンベロープ**形式と Ed25519 検証。
  エンベロープはアーカイブの `sha256` / `size` / `entryCount` と per-file ハッシュ一覧を持つ。
  **エンベロープをアーカイブの内側に入れない**（アーカイブのバイト列が自身の digest に依存する循環になる）
- `scripts/build-agent-host-bundle.mjs` — バンドル作成と署名
- 検証用公開鍵のホストへの配置（収束エンジンの `file` リソース。
  **slot uid から書けない場所に置く**）
- 署名鍵の管理方針（CI secret に置くか別経路か）を `adr.md` に記録する

Tier 1 のバンドルと Tier 2 のリリースは**同じマニフェスト形式・同じ検証コード**を使い、
中身（対象パス）だけが違う。

### 0a. アーカイブ展開の防御

**署名は「誰が作ったか」しか保証しない。中身が安全であることは保証しない。**
署名済みでも壊れた（あるいは署名ワークフローが侵害されて作られた）アーカイブは、
per-file 検証が走る**前の展開時点で**staging ディレクトリの外に書き込みうる。
Stage 10 ではこの展開が **root で** 走るため、影響はホスト全体に及ぶ。

**展開の前に**:

- **署名済みエンベロープ**（detached）の Ed25519 署名を検証する。
  ここまでアーカイブには一度も触れない
- アーカイブの実バイトに対して、エンベロープの `archive.sha256` と `size` を照合する
- 展開後の合計サイズと**エントリ数の上限**を設ける（zip bomb / 展開爆弾の防御）。
  上限はエンベロープの `uncompressedSize` / `entryCount` と、実装側の絶対上限の両方で縛る

**展開中、以下のエントリを拒否して中止する**（スキップではなく中止する）:

- 絶対パス（`/` で始まる）
- `..` を含むパス（正規化後に staging ルートの外を指すもの）
- シンボリックリンクとハードリンク
- デバイスファイル・FIFO・ソケットなどの非通常ファイル
- 正規化後に重複するパス（後勝ちで検証済みファイルを差し替える経路）
- **エンベロープの `entries` に存在しないエントリ**（`entries` が実質の allowlist になる）

展開先は staging ディレクトリ（`/var/lib/agent-host/workspace-staging/<version>/`）で、
**worktree にも `/opt` にも触れない**。展開が完了し per-file 検証が通ってはじめて
切り替え（1a）に進む。

> 実装は `archive/tar` のエントリを 1 つずつ検査する形にする。
> `tar -xzf` に丸投げしない（上記の防御が効かない）。

### 1. `gdg agent-host sync-workspace`

```
gdg agent-host sync-workspace [--source <dir|release>] [--dry-run] [--diff] [--force]
```

`--force` の契約（これ以外の効果を持たせない）:

- **ローカル変更の検出時に、管理対象パスを新しいバンドルの内容で上書きすることだけを許可する**
- **署名検証・マニフェスト照合・アーカイブ検査を迂回しない**（これらに `--force` は効かない）
- **`agent-host/workspace/**` 由来の管理対象パスの外には一切書かない**
- タイマーからの自動実行では**使わない**。operator が手動で実行するときだけのフラグ

動作:

1. **wiki mutex を取得する**（取得できなければ待つか、次のタイマーに譲る。強制取得しない）
2. **未完了トランザクションのリカバリを最初に行う**（方式 B の場合。下の「1a. 原子性」を参照）
   > **この順序が重要。** 配信元の取得と検証は失敗しうる（ネットワーク断、署名不正）。
   > リカバリを後ろに置くと、その失敗で `sync-workspace` が抜けたときに
   > **前回の中断で生じた混在状態が worktree に残ったまま**になる。
   > mutex を取ったら、外部に依存しない修復を先に完了させる。
3. 配信元（リリース成果物、または `--source` のディレクトリ）を取得し検証する
   - **アーカイブ検査**（下の「0a. アーカイブ展開の防御」を参照）
   - **Ed25519 署名検証**（本ステージで作る共通基盤。下の「0. 署名基盤」を参照）
   - マニフェスト内の per-file SHA-256 照合
   - `skills-lock.json` の `computedHash` 照合（Stage 04 で検証器を作った場合）
4. **バンドル全体を原子的に切り替える**（下の「1a. 原子性」を参照）
5. `AGENTS.md` → `.cursor/rules/local.mdc` の frontmatter 合成もこの切り替えに含める
6. mutex を解放する
7. **サービス再起動はしない**（スキルはプロンプト注入で読まれるため）

### 1a. 原子性 — per-file rename では不十分

`resource_file` の temp-write→rename は**1 ファイルの**原子性しか与えない。
バンドルは複数ファイルからなるので、途中でプロセスが死ぬと
「新しいスキル A と古いスキル B が混在する」半端な状態が live worktree に残る。

**プロセスが `SIGKILL` されうる以上、「失敗したら巻き戻す」コードは前提にできない。**
巻き戻しコードは実行される保証が無く、ハッシュだけでは内容を復元できない。
したがって次のどちらかを採る。**どちらを採るかは実装時に決め、`adr.md` に記録すること。**

#### 方式 A（推奨）: ディレクトリ単位の atomic な入れ替え

管理対象（`.agents/`, `.claude/`, `.codex/`, `.cursor/rules/local.mdc`）を
worktree 内の**単一の管理ディレクトリ配下**にまとめ、その 1 ディレクトリだけを
`renameat2(RENAME_EXCHANGE)` で新旧入れ替える。カーネルが原子性を保証するので、
プロセスがいつ死んでも中間状態が存在しない。

- 制約: Linux 固有（`RENAME_EXCHANGE` は Linux 3.15+）。ホストは Ubuntu なので問題ない
- 制約: 配布先のディレクトリ構成を変える必要がある。xangi の `src/skills.ts:19-23` が
  `.claude/skills/` `.codex/skills/` `skills/` を走査するため、**そのパス解決を壊さない形**に
  できるかを実装前に確認する。壊すなら方式 B

#### 方式 B: write-ahead journal + 実バイトのバックアップ + 起動時リカバリ

方式 A が採れない場合は、クラッシュ後に**次回起動が**修復する設計にする。

1. バンドルを `/var/lib/agent-host/workspace-staging/<version>/` に展開して検証する
   （「0a. アーカイブ展開の防御」の検査を通す。worktree の外なので、ここまでは live に一切触れない）
2. 変更対象の**現在の内容を実バイトでバックアップ**する
   （`/var/lib/agent-host/workspace-backup/<txn-id>/`。ハッシュでは復元できない）
3. **journal を書き、`fsync` してから** worktree の変更を始める。
   journal には txn-id、対象パス一覧、バックアップの位置、`in-progress` 状態を持つ
4. 各ファイルを rename で適用する
5. 全部成功したら journal を `committed` にして `fsync` し、バックアップを破棄する

**リカバリ**: `sync-workspace` は起動直後、**wiki mutex を取得したうえで**
journal を読み、`in-progress` のトランザクションがあればバックアップから復元してから
通常処理に入る。`gdg agent-host verify` にも「未完了トランザクションが残っていないこと」を加える。

> **未解決のリスクを明記しておく**: プロセス死亡で wiki mutex は解放されるため、
> リカバリが走るまでの間、混在状態の worktree がエージェントから見える。
> タイマー間隔（5 分）がその窓の長さになる。方式 A にはこの窓が無い。
> **これが方式 A を推奨する理由である。**

### 2. systemd タイマー

`agent-host/config/systemd/` に配置し、Stage 07 の `systemd` リソースで収束させる:

- `agent-host-sync.service`（`Type=oneshot`、`gdgagent-svc` として実行）
- `agent-host-sync.timer`（`OnUnitActiveSec=5min`, `OnBootSec=2min`, `Persistent=true`）

既存の `langfuse-forwarder.timer` が同じ形なので、そちらに揃える。

### 3. CI 側（push to main）

`.github/workflows/agent-host-workspace.yml`:

1. `agent-host/workspace/**` の変更を検出したときだけ動く
2. `SKILL.md` の frontmatter 検証（`name` / `description` が必須、など）
3. `skills-lock.json` の `computedHash` 照合
4. **公開範囲の再検査** — Stage 02 の判断の再混入防止。`agent-host/workspace/` に
   Google Sheets/Drive の URL、Discord のサーバー/チャンネル ID が含まれないこと
5. コンテンツバンドルを作り、署名して publish する

### 4. 配信境界の機械的強制

**Tier 1 は `agent-host/workspace/**` 以外を配信してはならない。**
速い経路でランタイムやポリシーが変わると、Tier 分けの意味が消える。

- `sync-workspace` の実装で配信元パスを `workspace/` 配下に限定する
- CI で「workspace バンドルに `config/` や `agent-host.json` が含まれない」ことを検査する
- 逆に「`agent-host/workspace/` に `.json` の実行時設定が置かれていない」ことも検査する

### 5. 失敗時の扱い

- mutex が取れない → 次のタイマーに譲る（エラーにしない）
- 署名/hash 検証失敗 → **適用せず**非ゼロで終了、journal に記録
- ローカル変更検出 → 適用せず報告
- 部分適用を残さない（`resource_file` の temp-write→rename に依存）

### 制約

- **`agent-host/workspace/**` 以外を配信しない**（ディレクトリ境界で機械的に強制する）
- **wiki mutex を必ず取る。** 独自ロックを作らず、xangi/`gdg wiki` の既存 mutex を使う
- **`rm -rf` + `cp -a` を復活させない。** 差分適用にする
- **サービスを再起動しない。** 再起動が要る変更は Tier 2（Stage 10）の担当
- **署名検証を省略しない。** Tier 1 も配信物であり、検証なしで live worktree に書かない。
  SHA-256 のみのマニフェストで代用しない（真正性が無い）
- **部分適用を live worktree に残さない。** per-file rename だけに頼らない
- **`SIGKILL` されても回復する設計にする。** 「失敗したら巻き戻す」in-process のコードを
  唯一の防御にしない（そのコードは実行されない）。カーネルの原子性（方式 A）か、
  fsync 済み journal + 実バイトのバックアップ + 起動時リカバリ（方式 B）のどちらかを持つ
- **ハッシュをバックアップの代わりにしない。** ハッシュは検出できるが復元できない
- **署名検証をアーカイブ内容の安全性の代わりにしない。** 署名は出所しか保証しない。
  展開時のパス検査を必ず行う（Stage 10 では root で展開されるため影響が大きい）
- **`tar -xzf` に丸投げしない。** エントリを 1 つずつ検査して展開する
- **`--force` に上記の検証を迂回させない。** `--force` はローカル変更の上書きのみを許可する
- Tier 2 固有の機構（リリース昇格、`verify` 連動の自動ロールバック、
  リリース保持世代）は Stage 10 の担当。**署名基盤は本ステージが提供する**

## Files to touch — 変更ファイル

### 新規
- `cli/internal/agenthost/signing.go`（**Ed25519 マニフェスト検証。Stage 10 と共有**）
- `scripts/build-agent-host-bundle.mjs`（バンドル作成 + 署名）
- `cli/internal/agenthost/workspace.go`（`sync-workspace` 本体、mutex 取得、
  ステージング、last-applied マニフェスト、巻き戻し）
- `agent-host/config/systemd/agent-host-sync.service`
- `agent-host/config/systemd/agent-host-sync.timer`
- `.github/workflows/agent-host-workspace.yml`
- `cli/internal/agenthost/workspace_test.go`

### 更新
- `cli/internal/command/agent_host.go`（`sync-workspace` サブコマンド）
- `agent-host/agent-host.json`, `agent-host/agent-host.schema.json`（sync の間隔と配信元）
- `cli/internal/agenthost/testdata/golden/`（sync の unit/timer を追加）
- `.github/scripts/changed-workspaces.mjs`（`agent-host/workspace/**` の述語）
- `agent-host/README.md`（スキル追加の手順を「push するだけ」に更新）

## Verification — 完了条件と検証

### 完了条件

- `agent-host/workspace/.agents/skills/` にスキルを追加して push すると、
  **手作業なしで**本番の `/srv/gdg-agent/wiki/.agents/skills/` に現れる
- Discord でエージェントがそのスキルを認識する
- sync が wiki mutex を取得しており、sleep ingest と競合しない
- `agent-host/workspace/**` 以外は Tier 1 で配信されない
- **バンドルが detached なエンベロープの Ed25519 署名で検証されており、SHA-256 のみでは受け付けない**
- **アーカイブ展開が staging ディレクトリの外に書けない**（パス traversal 防御）
- **mutex 取得後、配信元の取得より先にリカバリが走る**
- **`SIGKILL` されても、方式 A なら中間状態が存在せず、方式 B なら次回起動が復元する**

### コマンド

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

```bash
sudo -u gdgagent-svc gdg agent-host sync-workspace --dry-run --diff
```

```bash
systemctl --user list-timers agent-host-sync.timer
```

```bash
node --test .github/scripts/*.test.mjs
```

### 回帰として固定すべきテスト

- **Tier 1 の同期が `agent-host/workspace/**` の外を書かない**
  （速い経路でランタイムが変わらないこと。これが崩れると Tier 分けが無意味になる）
- **Tier 1 の同期が wiki mutex を取得する**（sleep ingest との競合。
  取らないと ingest 中の worktree を壊す。テストでは mutex を保持した状態で
  `sync-workspace` が待つか譲ることを確認する）
- **署名検証に失敗したバンドルが適用されない**（検証をスキップする経路が無いこと）
- **署名の無い、SHA-256 マニフェストだけのバンドルが拒否される**
  （完全性と真正性の混同を構造的に防ぐ）
- **適用の途中で `SIGKILL` したとき、方式 A では live worktree が新旧どちらかの完全な状態であり、
  中間状態が観測されない**（カーネルの原子性）
- **方式 B の場合、`SIGKILL` 後の次回 `sync-workspace` がバックアップから復元し、
  worktree が適用前の完全な状態に戻る**（起動時リカバリ。
  in-process の巻き戻しは `SIGKILL` では実行されないので、これがテスト対象になる）
- **方式 B の場合、`gdg agent-host verify` が未完了トランザクションの残存を検出する**
- **バックアップが実バイトを保持している**（ハッシュのみでは復元できない）
- **検証用公開鍵が slot uid から書けない**（署名検証を無効化する経路の遮断）
- **正しく署名されたが `../` / 絶対パス / symlink / hardlink / デバイスファイル /
  重複パス / マニフェスト外のエントリを含むアーカイブが、展開時に拒否され中止される**
  （署名は出所しか保証しない。Stage 10 では root で展開されるため、
  ここが抜けるとホスト全体に書き込める。**アーカイブごとに 1 ケースずつ固定する**）
- **展開後の合計サイズとエントリ数の上限を超えるアーカイブが拒否される**
- **配信元の取得が失敗する状況（ネットワーク断、署名不正）でも、
  未完了トランザクションのリカバリは完了している**
  （リカバリが取得の後ろにあると、混在状態が残り続ける静かな経路になる）
- **`--force` が署名検証・マニフェスト照合・アーカイブ検査を迂回しない**
- **`--force` が管理対象パスの外に書かない**
- **`/srv/gdg-agent/wiki/.agents` にローカル変更があるとき、`--force` 無しでは破壊しない**
  （旧 `rm -rf` + `cp -a` の再発防止）
- **`AGENTS.md` を変更すると `local.mdc` が `---\nalwaysApply: true\n---\n\n${AGENTS.md}` として追随する**
  （現行 `gdg-agent-layout.test.mjs:187-193` のアサーションを移植する）
- **`agent-host/workspace/` に Google Sheets/Drive の URL、Discord ID が含まれない**
  （Stage 02 の判断の再混入防止）
- **workspace バンドルに `config/` や `agent-host.json` が含まれない**（配信境界の担保）

### 手動 E2E

1. Lima VM で Stage 08 完了状態を作り、`agent-host-sync.timer` を有効にする
2. `agent-host/workspace/.agents/skills/test-sync/SKILL.md` にダミースキルを追加する
3. バンドルを作り（CI と同じ経路で）、VM から取得できる場所に置く
4. タイマーを待つ、または `systemctl --user start agent-host-sync.service` で手動起動する
5. `/srv/gdg-agent/wiki/.agents/skills/test-sync/SKILL.md` が現れることを確認する
6. **mutex 競合の確認**: `gdg wiki` のロックを別プロセスで保持した状態で sync を起動し、
   worktree が壊れないこと（待つか譲ること）を確認する
7. `/srv/gdg-agent/wiki/.agents/skills/test-sync/SKILL.md` を手で編集し、
   次の sync が `--force` 無しで破壊しないことを確認する
7a. **原子性の確認**: 複数ファイルを含むバンドルの適用中に `SIGKILL` で落とす。
    方式 A なら worktree が新旧どちらかの完全な状態であること、
    方式 B なら**次回の `sync-workspace` 実行後に**適用前の状態へ復元されることを確認する
    （`SIGKILL` 直後に復元されていることを期待しない。そのコードは動かない）
7b. **署名の確認**: 署名を外したバンドル、および署名を改竄したバンドルが
    それぞれ拒否されることを確認する
7c. **アーカイブ検査の確認**: `../` を含むエントリ、絶対パス、symlink を含む
    **正しく署名された**バンドルを作り、展開が拒否されて staging の外に何も書かれないことを確認する
7d. **リカバリ順序の確認**: 方式 B の場合、中断状態を作ったうえで
    配信元を到達不能にして `sync-workspace` を実行し、**リカバリだけは完了している**ことを確認する
8. Discord からエージェントに問い合わせ、追加したスキルが認識されていることを確認する
9. ダミースキルを削除して push し、sync 後に本番からも消えることを確認する
10. **本番 `mincra-srv` では `--dry-run --diff` で差分を確認してから**タイマーを有効にする
