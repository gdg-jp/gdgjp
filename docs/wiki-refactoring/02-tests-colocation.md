# Stage 02 tests-colocation — テストの配置と命名の正規化

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-refactoring/index.md`。**着手前に必ず読むこと。**
このステージは Stage 01（`01-code-map.md`）の完了後に実行する。

現状、テストファイル名から被験対象が読めない。実測した内訳:

- `app/lib/chunker.server.test.ts` の被験対象は `app/features/ai-search/chunker.server.ts`
  （ディレクトリすら違う）
- `app/lib/sources.server.ts` のテストが `create-source.server.test.ts` /
  `inline-source.server.test.ts` / `sources-discord.test.ts` / `source-refresh.server.test.ts`
  の 4 ファイルに、3 種類の命名で散っている
- `app/routes/sources.tsx` のテストが 4 ファイルに散っている
- SQL マイグレーションのテスト 10 本が、アプリコードのディレクトリ（`app/lib/`,
  `workers/features/sources/`）に紛れている。アプリコードではないのに、
  `app/lib/` を `ls` したときのノイズになっている
- アーキテクチャ検査テスト 3 本（`source-exclusions.test.ts`,
  `design-token-policy.test.ts`, `theme-tokens.test.ts`）も同様に散在している

結果として「X のテストはどこ」に grep と複数回の read が要る。

このステージはファイル移動と改名だけで、**テストの中身（`expect` の内容）を一切変えない**。

### 対象範囲

`wiki/` ワークスペースのみ。

### 読むべきもの

- `docs/wiki-refactoring/index.md` — 全体計画。配置ルール 5（テスト命名）が根拠
- `wiki/vitest.config.ts` — `include` パターン。新ディレクトリの追加が要る
- `wiki/ARCHITECTURE.md` — Stage 01 で作成済み。このステージで更新する

### 再利用する既存実装 — 書き直さないこと

- `wiki/app/routes/api.agent.architecture.test.ts` — `readFileSync` + 正規表現でアーキ制約を
  検証する既存パターン。新規の `test-colocation.test.ts` はこの形を踏襲する
- 移動するテストの中身。**`describe` / `it` / `expect` を 1 行も書き換えない。**
  変えるのは import パスと `new URL(...)` の相対パスだけ

### 前提として確認済みの事実（再調査不要）

マイグレーションテスト 10 本の被験マイグレーションは調査済み。下の表のとおり。
これらは `readFileSync(new URL("../../migrations/....sql", import.meta.url))` で SQL を読む。
`app/lib/` からは `../../migrations/`、`workers/features/sources/` からは `../../../migrations/`。
`tests/migrations/` へ移すと**どちらも `../../migrations/`** になる。

---

## Design — 設計

### 1. マイグレーションテストを `tests/migrations/` へ移す

被験マイグレーションの名前でファイル名を付ける。何をテストしているかが名前だけで確定する。

| 現在 | 移動先 |
|---|---|
| `app/lib/agent-ingestion-migration.test.ts` | `tests/migrations/0025_agent_ingestion.test.ts` |
| `app/lib/generation-agent-migration.test.ts` | `tests/migrations/0026_generation_agent_overhaul.test.ts` |
| `app/lib/content-backfill-migration.test.ts` | `tests/migrations/0028_markdown_content_backfill.test.ts` |
| `app/lib/google-document-import-migration.test.ts` | `tests/migrations/0029_google_document_imports.test.ts` |
| `workers/features/sources/sources-migration.test.ts` | `tests/migrations/0033_add_sources.test.ts` |
| `app/lib/source-document-ingestions-migration.test.ts` | `tests/migrations/0041_fix_source_ingestion_actor.test.ts` |
| `app/lib/page-acl-sync-migration.test.ts` | `tests/migrations/0050_add_page_acl_sync.test.ts` |
| `workers/features/sources/sources-visibility-migration.test.ts` | `tests/migrations/0054_add_source_visibility.test.ts` |
| `workers/features/sources/sources-chapter-fk-migration.test.ts` | `tests/migrations/0056_drop_sources_chapter_fk.test.ts` |
| `workers/features/sources/discord-source-import-runs-migration.test.ts` | `tests/migrations/0058_discord_source_import_runs.test.ts` |

移動後、`workers/features/sources/` から来た 4 本の `new URL("../../../migrations/...")` を
`../../migrations/` に直す。`app/lib/` から来た 6 本は相対深度が同じなので変更不要。

`tests/migrations/README.md`（3 行）を置き、「1 ファイル = 1 マイグレーション。
`migrations/` の SQL を `node:sqlite` の in-memory DB に適用して検証する」とだけ書く。

### 2. アーキテクチャ検査テストを `tests/architecture/` へ集約する

被験対象となるソースファイルを持たず、ソースツリーを `readFileSync` で走査する種類のテスト。

| 現在 | 移動先 |
|---|---|
| `app/routes/source-exclusions.test.ts` | `tests/architecture/source-surface-exclusions.test.ts` |
| `app/design-token-policy.test.ts` | `tests/architecture/design-token-policy.test.ts` |
| `app/theme-tokens.test.ts` | `tests/architecture/theme-tokens.test.ts` |
| `app/routes/api.agent.routes.test.ts` | `tests/architecture/agent-workspace-routes.test.ts` |

移動に伴い、内部の `new URL(...)` / 走査ルートのパスを新しい深さに合わせる。
**`expect` の本数と内容は変えない。**

`app/routes/api.agent.routes.test.ts` はルートのテストではなく、
`workers/features/ingestion/tools/workspace/` の `contracts` / `paths` / `wiki-adapter` を
組み合わせてパス解決の契約を検証する横断テストである。被験対象が単一ファイルでないため
`tests/architecture/` に移す。

`app/routes/api.agent.architecture.test.ts` と
`workers/features/ingestion/architecture.test.ts` は**移動しない**。
どちらも `import.meta.url` 相対のパスを 10 本前後持ち、移動すると全部書き換えになる。
書き換えの過程で `expect` を落としてもテストは緑のままなので、リスクに見合わない。
代わりに 4. の colocation テストで `architecture.test.ts` という名前を明示的に除外する。

### 3. 被験対象と名前が一致しないテストを改名する

規約は `<subject>.test.ts`。1 対象に複数観点が要るときだけ `<subject>.<aspect>.test.ts`。

| 現在 | 改名・移動先 | 被験対象 |
|---|---|---|
| `app/lib/chunker.server.test.ts` | `app/features/ai-search/chunker.server.test.ts` | `app/features/ai-search/chunker.server.ts` |
| `app/lib/knowledge-retriever.server.test.ts` | `app/features/ai-search/knowledge-retriever.server.test.ts` | 同ディレクトリの `knowledge-retriever.server.ts` |
| `app/lib/create-source.server.test.ts` | `app/lib/sources.server.create.test.ts` | `app/lib/sources.server.ts` |
| `app/lib/inline-source.server.test.ts` | `app/lib/sources.server.inline.test.ts` | 同上 |
| `app/lib/sources-discord.test.ts` | `app/lib/sources.server.discord.test.ts` | 同上 |
| `app/lib/source-refresh.server.test.ts` | `app/lib/sources.server.refresh.test.ts` | 同上 |
| `app/lib/agent-notes.replace.test.ts` | `app/lib/agent-notes.server.replace.test.ts` | `app/lib/agent-notes.server.ts` |
| `app/lib/acl-spans-collab-gate.test.ts` | `app/lib/acl-spans.server.collab-gate.test.ts` | `app/lib/acl-spans.server.ts` |
| `app/routes/sources-discord-title.test.ts` | `app/routes/sources.discord-title.test.ts` | `app/routes/sources.tsx` |
| `app/components/tiptap-renderer.test.tsx` | `app/components/TipTapRenderer.test.tsx` | `app/components/TipTapRenderer.tsx` |
| `app/components/tiptap-renderer-toc.test.ts` | `app/components/TipTapRenderer.toc.test.ts` | 同上 |

`app/routes/sources.batch.test.ts` と `app/routes/sources.refresh.test.ts` は
既に `sources.` プレフィックスを持つため改名不要。

**ファイルの統合はしない。** 4 本を 1 本にまとめると 1 ファイルが肥大し、
Stage 06 の 400 行制限に抵触する。プレフィックスを揃えて `ls` で隣り合えば目的は達成される。

### 4. `tests/architecture/test-colocation.test.ts` を新設する

規約を実行可能にする。ルールは 1 つ。

> `app/**` と `workers/**` と `shared/**` の `*.test.ts(x)` は、
> ファイル名の最初の `.test` より前の部分を先頭に持つ兄弟ソースファイルを持たなければならない。

判定手順:

1. テストファイル名から `.test.ts` / `.test.tsx` を除いた文字列を得る（例 `sources.server.create`）
2. 同じディレクトリのソースファイル（`.ts` / `.tsx` / `.server.ts` 等、`.test.` を含まないもの）で、
   その basename が 1 の文字列の**先頭一致する最長の候補**を探す
3. 見つからなければ失敗。失敗メッセージにはテストのパスと、期待する兄弟ファイル名を出す

除外:

- `tests/**`（`migrations/` `architecture/` `unit/` `golden/` `e2e/` はこの規約の対象外）
- ファイル名が `architecture.test.ts` で終わるもの（`api.agent.architecture.test.ts` を含む。
  ソースツリー走査型で、2. の理由により現在地に留める）。
  **完全一致ではなく接尾辞一致で判定すること。** 完全一致にすると
  `api.agent.architecture.test.ts` が除外されず、このステージが自分の首を絞める

テスト自体は `readFileSync` ではなく `readdirSync` でツリーを歩く。
`workers/features/ingestion/architecture.test.ts` の `readTypeScriptTree` が同じことをしているので、
実装の参考にする（コピーせず、必要な分だけ書く）。

### 5. `vitest.config.ts` の `include` を更新する

```ts
include: [
  "app/**/*.test.{ts,tsx}",
  "shared/**/*.test.{ts,tsx}",
  "tests/architecture/**/*.test.{ts,tsx}",
  "tests/migrations/**/*.test.{ts,tsx}",
  "tests/unit/**/*.test.{ts,tsx}",
  "tests/golden/**/*.test.{ts,tsx}",
  "workers/**/*.test.{ts,tsx}",
],
```

`coverage.exclude` にも `tests/architecture/**` と `tests/migrations/**` を追加する。

### 6. `ARCHITECTURE.md` と `CLAUDE.md` を更新する

`ARCHITECTURE.md` に「テストの置き場」節（表 1 つ）を追加する。

| 種類 | 置き場 | 命名 |
|---|---|---|
| ユニット | 被験対象の隣 | `<subject>.test.ts` / `<subject>.<aspect>.test.ts` |
| マイグレーション | `tests/migrations/` | `<migration-number>_<name>.test.ts` |
| アーキテクチャ規約 | `tests/architecture/` | 検査する規約の名前 |
| ゴールデン | `tests/golden/` | 既存のまま |
| E2E | `tests/e2e/` | `*.spec.ts` |

「規約を強制しているテスト」節に `tests/architecture/test-colocation.test.ts` を追記する。

### 制約

- **テストの中身を変えない。** `describe` / `it` / `expect` は 1 行も書き換えない。
  変更してよいのは import パスと `new URL(...)` の相対パスだけ。
  **`expect` の本数を移動前後で数えて一致を確認すること**（緩めると静かに緑になる）
- **テストファイルを統合しない。** 上の 3. を参照
- **`git mv` で移動する。** 履歴を切らない
- **テストを 1 本も減らさない。** 移動前後で `vitest run` の総テスト件数が一致すること
- **`app/routes/api.agent.architecture.test.ts` と
  `workers/features/ingestion/architecture.test.ts` は移動しない。** 2. の理由による。
  これらは安全装置なので、パスをいじって壊すリスクを取らない
- **スコープ境界。** アプリコードのファイルは 1 つも動かさない。動かすのはテストだけ。
  `app/lib/` からアプリコードを移すのは Stage 05 の担当

---

## Files to touch — 変更ファイル

### 移動（`git mv`）

- `app/lib/*-migration.test.ts`(6) → `tests/migrations/`（上の表のとおり改名）
- `workers/features/sources/*-migration.test.ts`(4) → `tests/migrations/`（同上）
- `app/routes/source-exclusions.test.ts`, `app/routes/api.agent.routes.test.ts`,
  `app/design-token-policy.test.ts`, `app/theme-tokens.test.ts` → `tests/architecture/`
- `app/lib/chunker.server.test.ts`, `app/lib/knowledge-retriever.server.test.ts`
  → `app/features/ai-search/`

### 改名（`git mv`、同一ディレクトリ内）

- `app/lib/` の 6 本、`app/routes/` の 1 本、`app/components/` の 2 本（上の表 3. のとおり）

### 新規

- `wiki/tests/architecture/test-colocation.test.ts`
- `wiki/tests/migrations/README.md`

### 変更

- `wiki/vitest.config.ts` — `include` と `coverage.exclude`
- `wiki/ARCHITECTURE.md` — 「テストの置き場」節を追加、「規約を強制しているテスト」に追記
- `wiki/CLAUDE.md` — Code map にテストの置き場の 1 行を追加
- 移動した 13 本の import パス / `new URL(...)` 相対パス

---

## Verification — 完了条件と検証

### 完了条件

- `tests/architecture/test-colocation.test.ts` が緑
- `app/lib/` からマイグレーションテスト 6 本が消え、`workers/features/sources/` から 4 本が消えた
- **移動前後で `vitest run` の総テスト件数（`Tests  N passed`）が一致する**
- `ARCHITECTURE.md` にテストの置き場の表がある

### コマンド

移動前にテスト件数と `expect` 数を記録する（**これを先にやらないと後で比較できない**）:

```bash
cd wiki && pnpm exec vitest run 2>&1 | tail -5 | tee /tmp/wiki-tests-before.txt
```

```bash
cd wiki && grep -rc "expect(" app workers shared --include="*.test.ts" --include="*.test.tsx" | awk -F: '{s+=$2} END{print "expect total:", s}'
```

移動後:

```bash
pnpm --filter @gdgjp/wiki typecheck
```

```bash
pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

```bash
pnpm --filter @gdgjp/wiki build
```

### 回帰として固定すべきテスト — 静かに壊れる経路

移動と改名は、失敗が「テストが消える」形で現れる。CI は緑のまま通る。

- **`vitest.config.ts` の `include` に入っていないディレクトリへ移した。**
  `tests/migrations/` を `include` に足し忘れると、10 本のマイグレーションテストが
  **1 つも実行されないまま `vitest run` が緑になる**。件数の前後比較が唯一の検出手段。
  移動後の件数が減っていたら `include` を疑う
- **`new URL("../../../migrations/...")` の深さを直し忘れた。** これは `ENOENT` で赤くなるので
  安全側。ただし `try/catch` で握っている箇所がないかだけ確認する
- **`passWithNoTests: true` が設定されている。** `vitest.config.ts` に既にあるため、
  ファイルが 1 本も見つからなくてもエラーにならない。**この設定があることが、
  上の「静かに消える」経路を成立させている。** 件数比較を省略しないこと
- **`design-token-policy.test.ts` / `theme-tokens.test.ts` の走査ルートがずれた。**
  これらは `app/` 配下の TSX を走査して色リテラルを検出する。`tests/architecture/` から
  見た相対パスが 1 段深くなるため、**走査対象 0 ファイルでも緑になる**。
  移動後に、わざと `bg-blue-500` を書いた一時ファイルを `app/components/` に置いてテストが
  赤くなることを 1 回確認し、確認後に消す

### 手動 E2E

このステージはテストファイルしか触らないため、アプリの手動確認は不要。
`pnpm --filter @gdgjp/wiki build` が通ればよい。
