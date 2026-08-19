# Stage 11 — Ingest ACL gate (Cursor hooks + server-side validation)

> このファイルは `docs/plans/11-ingest-acl-hooks.md` として保存する前提で書いてある。

## Context — 背景とリポジトリ状況

### なぜやるか

Stage 9 でソースに `visibility` が付き、Stage 10 でページ本文の `<acl src="…">` スパンと
サーバ側の黒塗り・`/sync` 検証が入った。残っている穴は **ingest の実行時**である。

`gdg wiki ingest --agent` が起動した Agent が、機密ソースの raw を読んで `pages/**` に書いたのに
`<acl>` を付け忘れた場合、現状の検出点は **push 時のサーバ (`acl_required`) だけ**。
そこまで到達するには Agent が既に commit と push を済ませており、拒否されてから
「何をどう直すか」を Agent が自力で逆算することになる。往復が高く、失敗が遅い。

**このステージで実現する状態**: Cursor Agent が `git commit` / `git push` を実行しようとした瞬間に、
その ingest 実行で読んだ機密ソースがタグ付けされているかを検証し、
未タグならフックが**その場でコマンドを拒否**して、直し方を Agent に返す。

### 実装で分かった 3 つの前提（設計の土台）

1. **キュー先頭のソースは CLI が確定的に知っている。**
   `.gdgwiki/state.json` の `Manifest` と `BuildIngestQueue` が返す `pending[0]` に
   `SourceID` と `Visibility` が入っている（`raw.go` は既に `- visibility:` 行を出力済み）。
   AGENTS.md は「INGEST_QUEUE.md の最初の 1 件だけを処理する」と指示しているので、
   **どのソースを扱っているかはフック無しで分かる**。
   フックの価値は ①セッション内でブロックして自己修正させる ②キュー先頭**以外**の raw を
   読んだ場合の検出、の 2 点に絞られる。トレースは「タグが要るソース」を**増やす方向にしか使わない**。

2. **`runCodingAgent` は `command.Dir` を設定していない。**
   `cli/internal/command/wiki.go:128-143` は `exec.CommandContext(ctx, name, prompt)` を
   cwd のまま実行する。Cursor のプロジェクトフックは `.cursor/hooks.json` を
   **プロジェクトルート基準**で探すため、**`command.Dir = root` の修正が必須**。
   現状はプロンプト文字列で root を伝えているだけ。

3. **`--commit` は worktree が完全にクリーンであることを要求する。**
   `git status --porcelain --untracked-files=all` が非空だとエラーになる。
   フック設定を clone に置くなら `.gitignore` 対応を漏らすと `--commit` が壊れる。
   `.gitignore` 自身は `WriteCloneExcludes` で `.git/info/exclude` に入っているので status に出ない。

### スコープ

- **対象ランタイムは Cursor のみ。** `--agent cursor` を新設し、Cursor のフックだけを書く。
  claude / codex 向けのフックは**書かない**（イベント名・stdin・出力形式・ブロック方法が
  3 ランタイムで全部違い、shim を 3 本保守する価値がまだない）。
  `--agent claude` / `--agent codex` は現状のまま動き、ゲートは掛からない。
- **検証ロジックはサーバに置く。** Go 側に `<acl>` パーサを書かない。
- **フックが検証を完了できないときは fail open。** 実効境界はサーバの `/sync` 側にあり、
  ここで通しても漏洩にはならない。リポジトリ既存のフック規約
  （`.codex/hooks/pre-commit-ci.ts` は不正ペイロードで必ず fail open）とも一致する。
- Agent (`workers/agents/`, `WikiGenerationAgent`) の権限設計は触らない。

### 読むべきもの

- `wiki/CLAUDE.md`、`CLAUDE.md`（リポジトリ直下）
- `docs/plans/10-page-acl-spans.md` — 特に §0「権限の代数」と §4-3 の不変条件
- `docs/plans/03-local-ingest-toolchain.md` — clone / remote helper / sync の全体像
- `/Users/hari/.cursor/skills-cursor/create-hook/SKILL.md` — **Cursor フックの唯一の一次資料**
  （イベント名は camelCase、出力はフラット、`permission` / `user_message` / `agent_message`、
  exit 2 = block、その他の非ゼロは `failClosed: true` でない限り fail open）

### 再利用する既存実装（書き直さない）

- `wiki/app/lib/acl-spans.server.ts` の `validatePageAclForSync(db, locales, ctx, user, chapters)`
  — `/sync` が使っている検証そのもの。**新エンドポイントはこれを dry-run で呼ぶだけにする。**
  併せて `pageAclClearance`（`redacted_page_not_editable` 相当）も再利用する
- `wiki/app/routes/api.cli.wiki.sync.ts` — リクエストの Zod スキーマ、`getCliIdentity` の使い方、
  エラー応答の形（`{ error, id, sourceId? }`）。**新エンドポイントは同じ形に揃える**
- `cli/internal/wiki/state.go` — `State.Manifest` / `State.Ingested`、`LoadState` / `WriteState`
- `cli/internal/wiki/raw.go` の `BuildIngestQueue`（`pending[0]` が queue head）、`IngestPrompt`
- `cli/internal/wiki/local.go` — `LocalPages` / `PageFromLocal` / `FrontMatter`（`yaml.v3`）。
  **変更ページの読み取りはこれを使う。front matter を自前で再パースしない**
- `cli/internal/wiki/client.go` — `c.request` + Bearer、`*HTTPError`。新メソッドも同じ形で足す
- `cli/internal/command/wiki.go` の `runGit(ctx, dir, args...)` と `withToken` の 401 リトライ
- `cli/internal/wiki/config.go` の `CloneGitignore` / `WriteCloneGitignore` / `WriteCloneExcludes`
- `.codex/hooks/pre-commit-ci.ts` — **リポジトリのフックスクリプト規約の手本**。
  Node ネイティブ TypeScript、依存ゼロ、stdin を JSON で読む、`node:child_process` の `execFileSync`/`spawnSync`
  （シェル文字列を組み立てない）、不正入力は fail open

---

## Design — 設計

### 1. サーバ側：検証エンドポイント

`POST /api/cli/wiki/validate-acl`（新規ルート `wiki/app/routes/api.cli.wiki.validate-acl.ts`）。

**副作用を持たない。D1 への書き込みを一切行わない。** `/sync` の ACL 検査だけを dry-run する。

リクエスト（`/sync` の upsert ペイロードのうち検証に要る部分だけ）:

```jsonc
{
  "lang": "ja",
  "pages": [
    { "id": "…|null", "slug": "…", "title": "…", "summary": "…", "content": "…",
      "tags": ["…"], "visibility": "restricted", "access": [...], "sources": [{ "sourceId": "…" }] }
  ],
  "readSourceIds": ["…"]   // トレース由来。キュー先頭 source_id を必ず含む
}
```

レスポンス: `{ "ok": true }` / `{ "ok": false, "findings": [{ "slug", "error", "sourceId"? }] }`
（HTTP は常に 200。判定結果はボディで返す。認証失敗のみ 401）。

検査は 2 段:

- **ページ単位** — 各ページに `validatePageAclForSync` をそのまま適用する。
  `/sync` と同一の実装を通すので、**判定がズレる余地が構造的に無い**。
  出るコードは既存どおり `acl_malformed` / `acl_in_metadata` / `acl_unknown_source` / `acl_required`。
  既存ページには `pageAclClearance` も掛け、`redacted_page_not_editable` を先出しする。
- **実行単位（新規）** — `readSourceIds` のうち `member` より狭いソース S について、
  **提出ページのいずれか 1 つ以上に `<acl src="…S…">` スパンがある**か、
  **提出ページ全部の閲覧者集合が S を包含する**（`audienceContains`）ことを要求する。
  満たさなければ `acl_untagged_read_source`（+ `sourceId`）。
  「S を読んだのにどのページにもタグが無い」を捕まえる。
  **全ページに要求しない**（3 ページ書いて 1 ページだけが S 由来、は正常）。

実行単位の判定は `acl-spans.server.ts` に
`validateReadSourcesTagged(db, pages, readSourceIds, user, chapters)` として置き、
ルートは 2 つを順に呼ぶだけにする。`aclSpanSourceIds` と `audienceContains` は既存のものを使う。

OpenAPI: `wiki/openapi/paths/validate-acl.yaml` と
`openapi/components/schemas/wiki.yaml` にスキーマを足し、`openapi/types.generated.ts` を再生成する。

### 2. CLI：`gdg wiki verify-acl`

新サブコマンド。**フックからも `--commit` からも同じ実体を呼ぶ**。

1. `findRoot()` → `LoadState` / `ReadConfig`。
2. `state.Manifest` が無ければ **警告を stderr に出して exit 0**（fail open）。
3. **変更ページの収集**（origin/main との差分 ∪ 作業ツリーの変更）:
   - `git diff --name-only refs/remotes/origin/main -- pages/`
   - `git status --porcelain --untracked-files=all -- pages/`
   の和集合からページディレクトリを求め、`LocalPages(root)` の結果から該当ページを取り出す。
   0 件なら exit 0。
4. **読んだソース ID の決定**:
   - **必ず含める**: `BuildIngestQueue` の `pending[0].SourceID`（＝キュー先頭。確定的な下限）
   - **加える**: `.gdgwiki/ingest-trace.json` の `reads[]` の各パスを
     `state.Manifest.Documents[].Path` と前方一致で照合して `SourceID` に解決したもの
   - トレースが空でも壊れていても、キュー先頭だけでゲートは全力で機能する
5. `client.ValidateACL(ctx, token, req)` を呼ぶ。`withToken` の 401 リトライに乗せる。
6. 結果:
   - `ok: true` → exit 0、出力なし
   - `ok: false` → findings を人間可読で stdout に出し、**exit 1**
   - ネットワーク・トークン・その他のインフラ的失敗 → 警告を stderr、**exit 0**（fail open）

**exit 1 は「ACL 違反を検出した」だけを意味する。** それ以外は必ず 0 で返す。
フック側がこの規約に依存するので、ここを崩さない。

### 3. CLI：トレース

`.gdgwiki/ingest-trace.json`（`.gdgwiki/` は既に gitignore 済み）。
`cli/internal/wiki/trace.go` を新設し、`state.go` と同じ IO 作法にする。

```go
type IngestTrace struct {
	RunID        string   `json:"runId"`
	StartedAt    int64    `json:"startedAt"`
	QueueHeadID  string   `json:"queueHeadDocumentId"`
	Reads        []string `json:"reads"`   // clone root からの相対パス、重複除去
	Writes       []string `json:"writes"`  // 監査用。ゲートの入力にはしない
}
```

- `gdg wiki ingest`（キュー生成時）に **truncate して新しい RunID で書き直す**。
- フックが `AppendTraceRead` / `AppendTraceWrite` で追記する
  （読み書き競合を避けるため、追記は都度 read-modify-write + `O_CREATE|O_TRUNC` の
  素朴な実装でよい。単一 Agent プロセスからの逐次呼び出しなので競合しない）。
- `gdg wiki ingest --commit` の成功時にトレースを削除する。
- **`Writes` はゲートの入力にしない。** 変更ページは git から取るのが権威（§2-3）。
  トレースは調査用の記録として残すだけ、と実装コメントに明記する。

### 4. CLI：Cursor フックの設置

`cli/internal/wiki/hooks.go` を新設。`gdg wiki ingest --agent cursor` の起動直前に、
**冪等に**次を書く（既存内容と一致していれば書かない）:

- `<root>/.cursor/hooks.json`
- `<root>/.gdgwiki/hooks/acl-gate.ts`（Go の `//go:embed` で埋め込む）

`hooks.json`（Cursor のスキーマ。イベントは camelCase、出力はフラット）:

```jsonc
{
  "version": 1,
  "hooks": {
    "beforeReadFile":       [{ "command": "node .gdgwiki/hooks/acl-gate.ts read",  "timeout": 10 }],
    "afterFileEdit":        [{ "command": "node .gdgwiki/hooks/acl-gate.ts write", "timeout": 10 }],
    "beforeShellExecution": [{ "command": "node .gdgwiki/hooks/acl-gate.ts shell", "timeout": 300 }]
  }
}
```

**イベント種別は stdin のフィールドではなく argv で渡す。** Cursor の stdin にイベント名が
入るかは一次資料で確認できていないため、確実な argv に寄せる。

`failClosed` は**設定しない**（既定の fail open）。§Context の方針どおり。

`acl-gate.ts` の責務（`.codex/hooks/pre-commit-ci.ts` と同じ書き方: Node ネイティブ TypeScript、依存ゼロ、
stdin を JSON で読み、壊れた入力では必ず素通り）:

| argv | 動作 |
|---|---|
| `read` | stdin のパスが `raw/` 配下なら `AppendTraceRead` 相当の追記。常に exit 0、出力なし |
| `write` | `pages/` 配下なら writes に追記（監査用）。常に exit 0 |
| `shell` | ① コマンド文字列から `raw/…` に見えるパスを拾って reads に追記<br>② `/\bgit\b[^;&\|\n]*\b(commit\|push)\b/` にマッチしたら `gdg wiki verify-acl` を実行 |

`shell` のブロック出力（Cursor のフラット形式）:

```js
process.stdout.write(JSON.stringify({
  permission: "deny",
  agent_message: `<acl> tagging is incomplete. ${findings}\n` +
    "Wrap the material from the listed source in <acl src=\"…\">…</acl>, " +
    "or lower the page visibility, then retry the commit.",
  user_message: "ACL gate blocked a commit in the Wiki clone.",
}));
process.exit(0);
```

`verify-acl` が exit 0 なら何も出力せず exit 0。exit 1 以外の異常終了・spawn 失敗・
`gdg` が PATH に無い場合は、**stderr に一行警告を出して exit 0**（fail open）。

`gdg` の解決順は ①環境変数 `GDG_BIN` ②PATH の `gdg`。フック設置時に
`os.Executable()` のパスを `hooks.json` の `command` に焼き込む案もあるが、
**焼き込まない**（clone を別マシンに持ち回ったときに壊れる）。

### 5. CLI：`--agent cursor` と cwd

`runCodingAgent` を次のように直す:

- `case "cursor": name = "cursor-agent"` を追加し、`--agent` のヘルプと
  エラーメッセージ（`unsupported agent %q (use claude, codex, or cursor)`）を更新する。
- **`command.Dir = root` を設定する。** 現状 nil で cwd 依存。
  プロジェクトフックの探索がこれに依存する。`root` を `runCodingAgent` の引数に足す
  （`wikiService.runAgent` のシグネチャが変わるのでテストのスタブも更新）。
- `--agent cursor` のときだけ、起動前に `EnsureCursorHooks(root)` を呼ぶ。
- 起動前に「フックを設置した / 既に最新」を 1 行だけ stdout に出す。

**`cursor-agent` の実際の引数形式（プロンプトを位置引数で渡せるか）は
実装時に `cursor-agent --help` で確認すること。** claude / codex と同形と仮定して書くが、
ここは repo 内の資料から確定できない唯一の点である。

### 6. `.gitignore` と既存 clone

`CloneGitignore()` を `"raw/\nINGEST_QUEUE.md\n.gdgwiki/\n.cursor/\n"` に変える。

**既存 clone は `.gitignore` が古いまま。** `EnsureCursorHooks` の中で:

1. `WriteCloneGitignore(root)` を冪等に呼び直す（内容が古ければ更新）
2. `WriteCloneExcludes(root)` も呼び直す（`.git/info/exclude` に `.gitignore` が無い
   古い clone を救済する）

これを怠ると `.cursor/` が untracked として現れ、**`--commit` の
「uncommitted or untracked changes」チェックで ingest が完了しなくなる**。
ここが本ステージで最も壊れやすい箇所。

### 7. `--commit` のバックストップと AGENTS.md

- `gdg wiki ingest --commit` の中、`state.Ingested` を更新する**前**に `verify-acl` 相当を実行する。
  exit 1 相当なら `--commit` を中止して findings を表示する。
  push は既に済んでいる段階なので**サーバ側は通過済み**だが、
  実行単位の検査（`acl_untagged_read_source`）はここでしか出ない。
- 成功時にトレースを削除する。
- `IngestPrompt` に 2 行足す:
  「機密ソースのタグ付けが不足していると `git commit` がフックに拒否される。
  拒否理由に出たソースを `<acl src>` で囲むか visibility を下げてから再実行すること。」
- `docs/plans/03a-agents-md.md` の `AGENTS.md` 本文（Stage 10 で入った
  `## Confidentiality and Span ACLs` 節）に、**この拒否が起こりうることと復旧手順**を追記する。
  `AGENTS.md` は DB 行が正なので、既存環境には管理者の push で反映される。

### 制約

- **Go 側に `<acl>` パーサを書かない。** 検証は必ずサーバの `validate-acl` を通す。
  二重実装はドリフトし、`/sync` と判定が食い違った瞬間にこのゲートは嘘をつく。
- **`verify-acl` の exit 1 は「ACL 違反」だけを意味する。** インフラ的失敗を 1 で返さない。
- **`validate-acl` エンドポイントは D1 に書き込まない。** dry-run に徹する。
- **トレースは「タグが必要なソース」を増やす方向にしか使わない。**
  トレースが空・欠損・壊れていても、キュー先頭ベースの検査が全力で走ること。
  トレースを見て検査をスキップする分岐を作らない。
- `cli/internal/wiki/remote_helper.go` の「`pages/**` と `AGENTS.md` 以外の push を拒否する」
  検査を緩めない。
- `wiki/app/lib/acl-spans.ts` / `acl-spans.server.ts` の既存の判定を**変更しない**。
  追加するのは実行単位の `validateReadSourcesTagged` だけ。
- フックスクリプトはリポジトリ規約に従う: ESM `.mjs`、依存ゼロ、
  `execFileSync`/`spawnSync`（シェル文字列を組み立てない）、壊れた入力では fail open。
- claude / codex 用のフックは書かない。`--agent claude` / `--agent codex` の既存挙動を壊さない。

---

## Files to touch — 変更ファイル

### `wiki/`

- `app/routes/api.cli.wiki.validate-acl.ts`（新規）、`app/routes.ts`（登録）
- `app/lib/acl-spans.server.ts` — `validateReadSourcesTagged` を追加（既存関数は変更しない）
- `app/lib/acl-spans.server.test.ts` — 実行単位検査のテスト追加
- `openapi/paths/validate-acl.yaml`（新規）、`openapi/components/schemas/wiki.yaml`、
  `openapi/types.generated.ts`（再生成）

### `cli/`

- `internal/command/wiki.go` — `--agent cursor`、`command.Dir = root`、
  `verify-acl` サブコマンド、`--commit` バックストップ、トレース初期化/削除
- `internal/wiki/hooks.go`（新規）+ `internal/wiki/hooks/acl-gate.ts`（新規、`//go:embed`）
- `internal/wiki/trace.go`（新規）
- `internal/wiki/verify.go`（新規） — 変更ページ収集、パス→sourceId 解決、リクエスト組み立て
- `internal/wiki/client.go` — `ValidateACL` メソッドと型
- `internal/wiki/config.go` — `CloneGitignore()` に `.cursor/`
- `internal/wiki/raw.go` — `IngestPrompt` の追記
- テスト: `internal/wiki/{hooks,trace,verify}_test.go`、`internal/command/wiki_test.go`

### `docs/`

- `docs/plans/03a-agents-md.md` — `AGENTS.md` 本文にゲートの説明と復旧手順を追記
- `docs/plans/00-llm-wiki-overview.md` — 依存グラフに Stage 11 を追加

---

## Verification — 完了条件と検証

### 完了条件

1. `gdg wiki ingest --agent cursor` が clone に `.cursor/hooks.json` と
   `.gdgwiki/hooks/acl-gate.ts` を ESM marker とともに冪等に設置し、**`cursor-agent` を clone ルートで起動**する。
2. `organizer` のソースを処理中の Agent が `<acl>` 無しで `git commit` しようとすると、
   フックが拒否し、**どのソースをどう囲めばよいかが `agent_message` に出る**。
3. 正しく `<acl src>` を付けたあとは同じ commit が通る。
4. キュー先頭以外の機密 raw を読んで書いた場合も `acl_untagged_read_source` で拒否される。
5. `.cursor/` が clone の `git status` に出ず、`gdg wiki ingest --commit` が完走する。
6. トークン失効・オフライン・`state.json` 欠損・`gdg` が PATH に無い、のいずれでも
   **commit がブロックされない**（警告のみ）。
7. `validate-acl` が D1 を一切書き換えない。

### コマンド

```bash
cd cli && go test ./...
```

```bash
pnpm --filter @gdgjp/wiki typecheck && pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

`openapi/*.yaml` を触ったら `openapi/types.generated.ts` の再生成を必ず行う。

### 回帰として固定すべきテスト（静かに壊れる経路）

- **`verify-acl` の exit code 規約** — ACL 違反のみ 1、インフラ的失敗はすべて 0。
  ここが崩れると fail open が fail closed に反転し、環境要因で ingest が止まる。
- **トレース欠損・空・壊れた JSON でも、キュー先頭ソースの検査が走る。**
  トレースを見てスキップする分岐が入っていないこと。
- **`.gitignore` の冪等更新** — 古い clone（`.cursor/` を含まない `.gitignore`、
  `.git/info/exclude` に `.gitignore` が無い）で `EnsureCursorHooks` を走らせたあと、
  `git status --porcelain --untracked-files=all` が空であること。
  **これを落とすと `--commit` が永久に失敗する。**
- **`EnsureCursorHooks` の冪等性** — 2 回呼んでもファイルの mtime も内容も変わらない。
- **`runCodingAgent` が `command.Dir = root` で起動する** — cwd 依存に戻ると
  フックが読まれず、ゲートが黙って無効化される。**画面上は正常に見える。**
- **`validate-acl` が書き込みを行わない** — 呼び出し前後で `pages` の
  `sync_revision` / `acl_source_ids` / `updated_at` が変わらないこと。
- **実行単位検査は「いずれか 1 ページ」で足りる** — 3 ページ書いて 1 ページだけが
  S 由来のとき、残り 2 ページにタグが無くても通ること（全ページ要求にすると使い物にならない）。
- **`/sync` と `validate-acl` の判定一致** — 同じページに対して両者が同じコードを返す。
  `validatePageAclForSync` を dry-run で呼んでいる限り自明だが、
  ルートで前処理を挟んだ瞬間にズレるのでテストで固定する。
- **`--agent claude` / `--agent codex` の既存挙動が変わらない**（フックを設置しない）。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev`（:5177）。`GDG_WIKI_URL=http://localhost:5177` で CLI を向ける。
2. `organizer` の visibility を持つソースを 1 件登録し、fetch 完了まで待つ。
3. `gdg wiki clone --lang ja /tmp/wiki-acl-test && cd /tmp/wiki-acl-test && gdg wiki raw pull`。
4. `gdg wiki ingest` を実行し、`INGEST_QUEUE.md` の先頭に `- visibility: \`organizer\`` が
   出ていることを確認する。
5. `.cursor/hooks.json` と `.gdgwiki/hooks/acl-gate.ts`、`.gdgwiki/hooks/package.json` が生成され、
   `git status --porcelain --untracked-files=all` が**空**であることを確認する。
6. `pages/` 配下のページを手で編集し、機密ソース由来の記述を `<acl>` 無しで書いて
   `git commit` する。フックが拒否し、`agent_message` に該当 `source_id` が出ることを確認する。
7. その記述を `<acl src="…">` で囲んで再度 `git commit` → 通ることを確認する。
8. `git push` し、サーバ側が `acl_required` を返さない（＝ CLI とサーバの判定が一致する）
   ことを確認する。
9. `gdg wiki ingest --commit` が完走し、`.gdgwiki/ingest-trace.json` が消えることを確認する。
10. ネットワークを落とすかトークンを壊した状態で 6 を再実行し、
    **警告だけ出て commit が通る**ことを確認する（fail open）。
11. `gdg wiki ingest --agent cursor` を実行し、`cursor-agent` が clone ルートで起動して
    フックが実際に発火することを確認する（`.gdgwiki/ingest-trace.json` の `reads` が伸びる）。
