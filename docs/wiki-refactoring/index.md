# wiki アーキテクチャ再編 — エージェント探索コストの削減

## Context — 背景とリポジトリ状況

### なぜやるか

`wiki/` はモノレポ最大のワークスペースで、エージェントが「どこに何があるか」を突き止めるだけで
大量のトークンを消費する。実測した主因は 4 つ。

| 症状 | 実測 | 影響 |
|---|---|---|
| フラットな巨大ディレクトリ | `app/routes/` 130 ファイル、`app/lib/` 98 ファイル（次点 tinyurl は 39/56） | `ls`/Glob 1 回で 100 行超。名前からドメインが読めない |
| 巨大ファイル | 400 行超 27 本、700 行超 10 本（最大 `app/routes/sources.tsx` 1493 行） | 40 行の loader を読むために 1 ファイル 15〜25k トークン |
| テスト名が被験対象を示さない | `app/lib/chunker.server.test.ts` → 実体は `app/features/ai-search/chunker.server.ts`。`sources.server.ts` のテストが 4 ファイルに分散し 3 種類の名前 | 「X のテストはどこ」に grep + 複数 read が要る |
| feature の置き場が 4 系統ある | `app/lib/` / `app/features/` / `workers/features/` / `shared/` に規則なし | 1 つの機能を追うのに 4 箇所を確認する |

副次的に、生成物 `worker-configuration.d.ts`（14,750 行）・`schema.sql`（599 行, tracked）・
`openapi/types.generated.ts`（1,157 行, tracked）が `grep -r` のノイズになる。

### ゴールと非ゴール

**ゴール**: エージェントがコードを探索する際のトークン消費削減。
ランタイムの AI プロンプト（ingestion / ai-search が Gemini・Workers AI に送るトークン）は**非ゴール**。
機能追加・挙動変更も非ゴール。この計画は純粋な構造リファクタリングで、
振る舞いの差分はゼロ（削除する dead code を除く）。

### 対象範囲

`wiki/` ワークスペースのみ。他アプリ（`tinyurl/` 等）には波及させない。

### 読むべきもの

- `wiki/CLAUDE.md` — バインディング、3 ハンドラ、auth、Drizzle、i18n、E2E の前提
- `wiki/README.md` — 現行「Directory structure」節（散文で、すでに一部陳腐化）
- `wiki/DESIGN.md` — デザイントークン方針（`app/design-token-policy.test.ts` が強制）
- `wiki/workers/features/ingestion/README.md` — **この計画が全体に一般化する手本**

### 再利用する既存実装 — 書き直さないこと

- `workers/features/ingestion/` — orchestration / model / tools / persistence の 4 層に既に分割済みで、
  `workers/features/ingestion/architecture.test.ts` が層境界を強制し、README が規約を文書化している。
  **この構造が正解。触らず、他ドメインをここに揃える。**
- `workers/features/sources/import/` — `drive/` `website/` の resumable phase 分割。
  巨大ファイル分割時の手本にする。
- `app/routes/api.agent.architecture.test.ts` — `readFileSync` + 正規表現でアーキ制約を検証する既存パターン。
  新設する architecture テストはこの形を踏襲する。
- `app/db/schema.ts` の Drizzle テーブル定義（35 テーブル）— 分割するが定義自体は不変。
- `app/lib/db.server.ts` の `getDb(env)` — fan-in 91。移動しない。

### 前提として確認済みの事実（再調査不要）

- **ルートファイルは 115 本すべて `./+types/` を import していない**（`LoaderFunctionArgs` 直書き）。
  React Router の typegen 結合がないため、ルートファイルの移動はパス変更のみで完結する。
- `app/routes.ts` は明示的な `route()` 設定。ファイル名がそのまま URL になる規約は使っていないため、
  ディレクトリ再編で URL は一切変わらない。
- ルートモジュールを import しているのは同階層の `.test.ts` のみ（`~/routes/` 参照はゼロ）。
- `~/lib/*` の import 箇所は 408、それを含むファイルは 162。`app/lib/` 内の相対 import が 44。

---

## Design — 設計

### 0. 全体方針

**feature-first**。1 つのドメインのコード・UI・テストが 1 ディレクトリに集まり、
`ls app/features/sources/` の 1 回でそのドメインの全体像が読める状態にする。
`app/lib/` はドメインを持たない横断プリミティブだけを残す。

判断基準は 1 つ:

> エージェントが「X はどこ？」に答えるまでに読むトークンを最小化する。
> そのために (a) ディレクトリを意味で分割し、(b) 1 ファイルを 400 行以下にし、
> (c) 入口となるコードマップを 1 つ用意し、(d) 規約を実行可能なテストで固定する。

### 1. 目標ディレクトリ構成

```
wiki/
  ARCHITECTURE.md              (新規) コードマップの正本
  app/
    routes.ts                  位置固定（React Router の要求）
    routes/
      public/                  _index, about, privacy, terms, signin, logout + _components/
      wiki/                    /wiki/* ページルート
      sources/
      tasks/
      ingest/
      admin/
      api/
        agent/                 /api/agent/*        (7)
        cli/                   /api/cli/wiki/*
        sources/  tasks/  ingest/  pages/  user/
        google/                drive・chat・documents
        discord/
    features/
      auth/  pages/  sources/  google/  discord/
      notifications/  editor/  agent-api/  tasks/
      ai/  ai-search/  ingestion/  translation/  zip-import/   ← 既存、そのまま
    lib/                       横断プリミティブのみ（8 本程度）
    components/                アプリシェルと ui/ プリミティブのみ
    db/
      schema/                  ドメイン別に分割 + index.ts で再エクスポート
  workers/                     現状維持（ingestion は手本、sources のみ巨大ファイル分割）
  tests/
    architecture/              (新規) 規約を強制するテスト
    migrations/                (新規) マイグレーション SQL のテスト
    unit/  golden/  e2e/       既存
```

### 2. 配置ルール（これが規約の本体）

1. **ドメインを持つコードは `app/features/<domain>/` に置く。** サーバ・クライアント・UI・テストを同居させる。
   UI は `app/features/<domain>/components/`。
2. **`app/lib/` に残すのは、どのドメインにも属さない横断プリミティブだけ。**
   残すもの: `db.server.ts` (fan-in 91), `utils.ts`, `time.ts`, `color-utils.ts`, `url-extract.ts`,
   `queue-processors.server.ts`（キュー振り分けのディスパッチャ）, `chapter-directory.server.ts`,
   `og-image.server.tsx`。**新規ファイルを `app/lib/` に足すことは原則禁止**（architecture テストで
   ホワイトリスト固定）。
3. **`app/components/` に残すのはアプリシェルと `ui/` プリミティブだけ。**
   シェル: `Navbar` `Footer` `Sidebar` `BaseSidebar` `SidebarDialog` `SidebarPopover` `Toast`
   `Tooltip` `ConfirmDialog` `Skeleton`。それ以外は feature 配下へ。
4. **`app/routes/` 配下はルートモジュールとその `_components/` だけ。**
   loader/action から呼ばれるビジネスロジックは feature の `*.server.ts` に置く。
   ルートモジュールは「引数を読む → feature を呼ぶ → レスポンスを組む」に留める。
5. **テストは被験対象の隣に、`<subject>.test.ts` の名前で置く。**
   1 対象に複数の観点が要る場合のみ `<subject>.<aspect>.test.ts`。
   `app/lib/create-source.server.test.ts` のような、被験対象名と一致しない名前は禁止。
6. **1 ファイル 400 行以下**（テスト・生成物を除く）。既存超過分は縮小専用の allowlist で管理する。
7. **`workers/` はランタイム境界（Worker entry / DO / Workflow / Agent）と、
   Worker 側でしか動かない feature 実装だけ。** `workers/features/<x>/` は ingestion の
   4 層（orchestration / model / tools / persistence）を手本にする。

### 3. ドメイン割り当て（`app/lib/` 98 本の行き先）

| 移動先 | 現在のファイル |
|---|---|
| `features/auth/` | `auth.server` `auth-utils.server` `auth-redirect` |
| `features/pages/` | `page-access.server` `page-archive.server` `page-meta` `page-tree` `page-visibility.server` `wiki-page-path(.server)` `wiki-catalog.server` `content-backfill.server` `acl-spans(.server)` `d1-chunk.server` |
| `features/sources/` | `sources.server`（分割）`sources-shared` |
| `features/google/` | `google-drive.server` `google-drive-token.server` `google-drive-utils` `google-docs-markdown.server` `google-forms.server` `google-forms-utils` `google-picker.client` `google-chat.server` `survey-stats.server` + 既存 `app/features/google-documents/` を統合 |
| `features/discord/` | `discord-api.server` `discord-oauth.server` `discord-token.server` `discord-reminders.server` |
| `features/notifications/` | `notify.server` `email.server` `fcm.server` `firebase-config-context` `firebase-messaging.client` |
| `features/editor/` | `tiptap-convert` `remote-cursors-extension` `remote-cursors-store` `content-format` + `app/hooks/useCollabEditor.ts` |
| `features/agent-api/` | `agent-notes.server` `agent-workspace.server` `agents-md.server` `cli-wiki-human.server` `cli-wiki-raw-content.server` `cli-wiki-source-path.server` + `app/routes/api.cli.wiki.sync.helpers.ts` |
| `lib/` に残す | 上記ルール 2 の 8 本 |

`app/components/` 33 本のうち、`ui/`(10) とシェル(10) 以外は
`features/pages/components/`（`ShareDialog` `PageTree` `PageEditor` `WikiRightSidebar` `Comment*`
`EmojiReactionBar` `TagChip` `*Content`）、`features/editor/components/`（`TipTap*` `PresenceAvatars`）、
`features/sources/components/`(6)、`features/tasks/components/`(16)、
`features/ingestion/components/`(4)、`routes/public/_components/`（`LandingContent`）へ。

### 4. 削除する dead code（参照ゼロを確認済み）

- `app/routes/api.ingest..status.ts`（26 行、ファイル名がタイポで `routes.ts` 未登録・参照なし）
- `app/routes/api.discord.ingest.ts`（80 行、`routes.ts` 未登録・参照なし）
- `app/components/MermaidBlock.tsx`（67 行、参照なし）
- `app/lib/task-visibility.server.ts`（29 行、参照なし）
- `app/routes/api.sources.$id.delete.ts`（32 行）は `routes.ts` 未登録だがテストが存在する。
  **判断が要る**: 登録漏れなら `routes.ts` に追加、不要なら route とテストを削除。実装時に確認する。

### 5. 巨大ファイル分割方針

400 行超 27 本のうち、700 行超の 10 本を優先する。分割軸は「読む理由が違うものを分ける」。

| ファイル | 行 | 分割 |
|---|---|---|
| `routes/sources.tsx` | 1493 | ルートは meta/loader/action のみ。データ処理は `features/sources/*.server.ts` へ。`parseBatchCandidates` `titleFromUrl` `buildDiscordSourceTitle` は `features/sources/`。UI は `routes/sources/_components/`（`ChatSenderDialog` 他） |
| `components/ShareDialog.tsx` | 1225 | `features/pages/components/ShareDialog/` に分解 — `index.tsx` / `chips.tsx` / `avatar.tsx` / `normalize.ts` / `use-height-transition.ts` |
| `routes/wiki.$.tsx` | 1054 | loader のデータ取得と `loadPageComments` を `features/pages/*.server.ts`、`parseMdHeadings` を `features/editor/toc.ts`、ビューを `routes/wiki/_components/` |
| `workers/features/sources/google-chat-import.ts` | 935 | `import/drive/phases.ts` と同じ phase 分割に揃える |
| `lib/sources.server.ts` | 819 | `features/sources/` に `classify.ts`（URL/space/channel 分類）/ `permissions.ts`（`canAssign*` `parseSourceVisibilitySelection`）/ `create.server.ts`（`createSource` `createInlineSource`）/ `lifecycle.server.ts`（unarchive・delete・refresh・visibility） |
| `routes/ingest.$sessionId.tsx` | 765 | ビューを `features/ingestion/components/` へ |
| `features/google-documents/import.server.ts` | 752 | `features/google/documents/` に preview / job / apply で分割 |
| `workers/.../import/drive/phases.ts` | 749 | phase ごとのモジュールへ |
| `components/LandingContent.tsx` | 756 | セクション単位に分割し `routes/public/_components/landing/` |
| `components/PageTree.tsx` | 703 | ツリー構築 / DnD / 行レンダリングに分割 |

残る 400〜700 行の 16 本（`tasks.$slug.tsx` 677, `api.cli.wiki.sync.ts` 658,
`wiki.$slug.history.tsx` 598, `api.page-access.$pageId.tsx` 498 など）も同じ軸で分割する。
`db/schema.ts`(623) は Stage 03 で解決済み。
`ingestion-model-gateway.ts`(630) と `wiki-generation-agent.ts`(409) は分割せず
allowlist に載せる（前者は ingestion のスコープ外、後者は Agents SDK のクラス定義のため）。

### 6. `app/db/schema.ts` の分割（import 変更ゼロ）

623 行 / 35 テーブルを `app/db/schema/` にドメイン別分割し、`app/db/schema/index.ts` で
`export * from "./pages"` 等をまとめる。`~/db/schema` という import 指定子が変わらないため
**呼び出し側の変更が一切発生しない**。分割単位: `user.ts` `pages.ts`（pages/versions/access/tags/
attachments/comments/reactions/favorites/views/embedding-status）`sources.ts` `tasks.ts`
`ingestion.ts` `notifications.ts` `google.ts` `discord.ts` `chapters.ts`。

### 7. ガードレール — `tests/architecture/`

規約は文書だけでは腐る。`api.agent.architecture.test.ts` の `readFileSync` パターンで固定する。

- `layering.test.ts`
  - `app/lib/**` は `~/features/` `~/routes/` `~/components/` を import しない
  - `app/features/**` は `~/routes/` を import しない
  - `app/features/**` は `workers/features/*/persistence|orchestration` の内部実装を import しない
  - `app/lib/` の直下ファイル名は許可リストと完全一致する（新規追加を弾く）
  - `app/components/` の直下ファイル名は許可リスト（シェル）と `ui/` のみ
- `file-size.test.ts` — `app/**` `workers/**` `shared/**` の非テスト `.ts`/`.tsx` は 400 行以下。
  超過は allowlist に明記し、**allowlist は縮小のみ許す**（テスト内にコメントで方針を書く）
- `test-colocation.test.ts` — すべての `*.test.ts(x)` は、最初の `.test` より前のプレフィックスに
  一致する兄弟ソースを持つ（`tests/` 配下と、`architecture.test.ts` で終わる名前は除外）
- `route-urls.test.ts` — `app/routes.ts` が公開する URL 全集合のスナップショット
- 既存の `workers/features/ingestion/architecture.test.ts` と
  `app/routes/api.agent.architecture.test.ts` は **そのまま維持**。安全装置なので緩めない。

### 8. コードマップ — 探索の入口

エージェントは `CLAUDE.md` を毎セッション読む。ここに**コンパクトな表**（25 行程度）を置けば、
初手の 2〜3 回の grep が消える。詳細は `ARCHITECTURE.md` に置き、CLAUDE.md からは参照だけする。

`CLAUDE.md` に追加する節（抜粋イメージ）:

```markdown
## Code map — 「X はどこ？」

| 探しもの | 場所 |
|---|---|
| ページ ACL / 可視性 / ツリー | `app/features/pages/` |
| ソース取り込み（UI・API 側） | `app/features/sources/` |
| ソース取り込み（Worker 実行） | `workers/features/sources/` |
| 生成 AI（wiki 生成） | `workers/features/ingestion/` — README あり |
| AI 検索（Vectorize） | `app/features/ai-search/` |
| Google 連携 | `app/features/google/` |
| CLI / エージェント読み取り API | `app/features/agent-api/` + `app/routes/api/{cli,agent}/` |
| DB スキーマ | `app/db/schema/`（`schema.sql` は生成物。読まない） |

**読まないファイル**: `worker-configuration.d.ts`（14,750 行, 生成物）、`schema.sql`（生成物、
正本は `app/db/schema/`）、`openapi/types.generated.ts`（生成物、正本は `openapi/openapi.yaml`）。
```

各 feature には ingestion に倣って 5〜10 行の `README.md` を置く。長い散文は書かない
（README 自体がトークンコストになる）。`README.md` の現行「Directory structure」節は
`ARCHITECTURE.md` へのポインタ 1 行に置き換える。

### 9. ステージ分割と依存関係

成果物は `docs/wiki-refactoring/` に置く。`index.md` はこの計画の全文（delegate しない概説）。
各ステージファイルは `plan-creator` skill の見出し規約
（`## Context` / `## Design` / `## Files to touch` / `## Verification`）に従う。

```
docs/wiki-refactoring/
  index.md                     この計画の全文（概説・delegate しない）
  01-code-map.md               コードマップ + feature README + dead code 削除
  02-tests-colocation.md       テスト配置・命名の正規化 + colocation ガードレール
  03-db-schema-split.md        app/db/schema.ts 分割（import 変更ゼロ）
  04-routes-tree.md            app/routes/ 130 本 → サブディレクトリ化
  05-features-reorg.md         app/lib/ 98 本 → app/features/<domain>/、components 再配置
  06-file-splits.md            巨大ファイル分割 + file-size / layering ガードレール
```

依存グラフ:

```
01 ─┬─ 02 ─┐
    ├─ 03 ─┤
    └──────┴─ 04 ─┐
                  ├─ 06
             05 ──┘
```

- `02` と `03` は `01` の後なら並行可
- `04`（routes）と `05`（lib/features）は互いに独立。並行可だが、両方 import を書き換えるため
  **逐次実行を推奨**
- `06` は `04` と `05` の完了後（分割先ディレクトリが確定してから）
- **各ステージは `ARCHITECTURE.md` と `CLAUDE.md` の Code map を同じ変更内で更新する。**
  更新しないマップは即座に嘘になる

### 制約

- **`git mv` で移動する。** 履歴を切らない。import 書き換えは別コミットに分ける
  （move コミットと edit コミットを分けるとレビューと bisect が成立する）。
- **挙動を変えない。** URL、API レスポンス、DB スキーマ、キューメッセージ形状、
  Cookie 形式は一切変更しない。`routes.ts` の `route()` 第 1 引数（URL）は不変で、
  第 2 引数（ファイルパス）だけが変わる。
- **`wrangler.toml` のバインディングを変更しない。** 変更が発生したら `cf-typegen` が要る。
  この計画では発生させない。
- **`schema.sql` を手で編集しない。** 生成物。`migrate:local` で更新する。
- **`migrations/` の既存 SQL を変更しない。** 適用済み。
- **既存の architecture テスト 2 本の期待値を緩めない。** `workers/features/ingestion/` の
  層境界と、agent API が Vectorize/embedding を使わない制約は安全装置である。
  ファイル移動でパスが変わる場合は、**制約を弱めずにパスだけ**追従させる。
- **`app/design-token-policy.test.ts` / `app/theme-tokens.test.ts` を通し続ける。**
  コンポーネント移動で走査パスが変わるならテスト側のパスを更新する。
- **E2E の前提を壊さない。** `tests/e2e/global-setup.ts` は `.dev.vars` の `RP_SESSION_SECRET` で
  Cookie を偽造し、miniflare の D1 sqlite を直接触る。`fixtures.ts` と対で動くので片方だけ動かさない。
- **スコープ境界。** `workers/features/ingestion/` の内部構造は既に正解なので再編しない
  （`06` での巨大ファイル分割対象にも含めない）。`cli/`・他ワークスペース・`gdg-lib/` は触らない。

---

## Files to touch — 変更ファイル

網羅列挙はしない。ステージごとの当たり所を示す。

### 01-code-map

- `wiki/ARCHITECTURE.md`（新規）
- `wiki/CLAUDE.md` — `## Code map` 節と「読まないファイル」注記を追加
- `wiki/README.md` — 「Directory structure」節を `ARCHITECTURE.md` への 1 行参照に置換
- `wiki/app/features/*/README.md`（新規、各 5〜10 行）
- 削除: `app/routes/api.ingest..status.ts`, `app/routes/api.discord.ingest.ts`,
  `app/components/MermaidBlock.tsx`, `app/lib/task-visibility.server.ts`

### 02-tests-colocation

- 移動: `app/lib/*-migration.test.ts`(6) + `workers/features/sources/*-migration.test.ts`(4)
  → `tests/migrations/`
- 改名・移動: `app/lib/chunker.server.test.ts` `app/lib/knowledge-retriever.server.test.ts`
  → `app/features/ai-search/` 配下の被験対象隣
- 集約: `sources.server` 系 4 本（`create-source` `inline-source` `sources-discord` `source-refresh`）、
  `routes/sources.tsx` 系 4 本（`source-exclusions` `sources.batch` `sources.refresh`
  `sources-discord-title`）
- `wiki/vitest.config.ts` — `include` に `tests/migrations/**` `tests/architecture/**` を追加
- `wiki/tests/architecture/test-colocation.test.ts`（新規）

### 03-db-schema-split

- `app/db/schema.ts` → `app/db/schema/{index,user,chapters,pages,sources,tasks,ingestion,notifications,google,discord}.ts`
- 呼び出し側の変更なし（`~/db/schema` 指定子が不変）

### 04-routes-tree

- `app/routes/` 130 本 → `app/routes/{public,wiki,sources,tasks,ingest,admin,api/*}/`
- `app/routes.ts` — 全 `route()` の第 2 引数を更新（URL は不変）
- ルート隣接テスト 22 本を同時移動
- `app/routes/api.cli.wiki.sync.helpers.ts` → `app/features/agent-api/`（ルートではない）

### 05-features-reorg

- `app/lib/` 98 本 → 上記「ドメイン割り当て」表のとおり `app/features/<domain>/`
- `app/components/` 33 本 → シェル/ui 以外を feature 配下へ
- `app/hooks/useCollabEditor.ts` → `app/features/editor/`
- `app/features/google-documents/` → `app/features/google/documents/`
- import 書き換え 408 箇所 / 162 ファイル（`~/lib/*` `~/components/*` `~/features/*`）
- `app/routes/api.agent.architecture.test.ts` — 参照パスを追従（制約は不変）
- `app/design-token-policy.test.ts` / `app/theme-tokens.test.ts` — 走査パス追従

### 06-file-splits

- 「巨大ファイル分割方針」表の 10 本 + 400〜700 行の 17 本
- `wiki/tests/architecture/file-size.test.ts`（新規）
- `wiki/tests/architecture/layering.test.ts`（新規）

---

## Verification — 完了条件と検証

### 完了条件（数値目標）

ベースライン → 目標:

| 指標 | 現在 | 目標 |
|---|---|---|
| 1 ディレクトリ最大ファイル数 | 130 (`app/routes/`) / 98 (`app/lib/`) | ≤ 25 |
| 400 行超の非テストソース | 27 本 | 2 本（allowlist のみ） |
| 700 行超 | 10 本 | 0 本 |
| `app/lib/` 直下 | 98 本 | 8 本 |
| 被験対象と名前が一致しないテスト | 12 本 | 0 本 |
| 「X はどこ？」の解決 | grep 数回 | `CLAUDE.md` の Code map 1 読み |

振る舞いの完了条件: **URL・API レスポンス・DB スキーマ・Cookie が変わっていないこと**。

### コマンド（各ステージ末で全部通す）

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

`04` `05` `06` では追加で E2E とゴールデンを通す。E2E は `pnpm dev` が miniflare の D1 を
作っていないと global-setup が失敗するので、先に一度 dev を起動しておく。

```bash
pnpm --filter @gdgjp/wiki test:golden
```

```bash
pnpm --filter @gdgjp/wiki test:e2e
```

移動漏れの検出（`~/lib/` の残骸を数える）:

```bash
cd wiki && grep -rho '~/lib/[a-z0-9.-]*' app workers shared tests --include="*.ts" --include="*.tsx" | sort -u
```

### 回帰として固定すべきテスト — 静かに壊れる経路

ここが一番効く。ビルドも typecheck も通るのに壊れるのは次の 5 経路。

- **`app/routes.ts` の URL が 1 つも変わっていない。** ファイルパスだけを書き換える作業なので、
  URL 側を巻き込んだ差分は事故。`git diff` で `route("` の第 1 引数が無変更であることを確認し、
  `tests/architecture/` に「`routes.ts` の全 URL 一覧」のスナップショットテストを置く。
  **これがないと、URL 変更に誰も気づかないまま本番の外部リンクが 404 になる。**
- **`.server.ts` 境界がクライアントバンドルに漏れていない。** Vite の import boundary は
  ファイル名で判定する。移動時に `.server` サフィックスを落とすと、サーバ専用コード
  （D1 クライアント、OAuth シークレット）がクライアントに入る。`pnpm build` が通ることで検出されるが、
  移動対象に `.server` が付いていたファイルの一覧を作り、移動後も全部付いていることを機械的に確認する。
- **キューメッセージのガードが全種類残っている。** `app/lib/queue-processors.server.ts` の
  discriminator を壊すと、Worker は未知メッセージを `ack()` で黙って捨てる。翻訳・Google Docs
  インポート・`source_fetch` の 3 系統すべてについて、既存の
  `queue-processors.server.test.ts` を移動先でも走らせ続ける。
- **cron ハンドラの分岐が両方残っている。** `workers/app.ts` の `scheduled` は cron 文字列
  （`TASK_REMINDER_CRON` / `SOURCE_REFRESH_CRON`）で分岐する。ファイル移動で import が
  壊れても、cron は本番でしか動かないため CI では気づかない。両分岐を呼ぶユニットテストを置く。
- **既存 architecture テストの制約が弱まっていない。** `workers/features/ingestion/architecture.test.ts`
  と `app/routes/api.agent.architecture.test.ts` は、パス追従の過程で `expect` を消しても緑になる。
  差分レビューで `expect` の本数が減っていないことを確認する（`grep -c expect` の前後比較）。

### 手動 E2E（`04` `05` `06` の後）

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. `/signin` からサインインし、`/wiki/<既存ページ>` が本文・TOC・コメント・リアクション付きで
   表示される
3. そのページの共有ダイアログを開き、ユーザ候補検索と一般アクセス変更が動く（`ShareDialog` 分割の確認）
4. `/sources` でソース一覧が出る。URL を 1 件追加し、取り込みが走り一覧に反映される
5. `/ingest` から生成セッションを 1 つ開始し、`/ingest/:sessionId` がリアルタイムに更新される
   （Agents SDK 経路 + DO 経路の確認）
6. `/search` で AI 検索が結果を返す（Vectorize 経路の確認）
7. `/tasks/<slug>` でタスク一覧・テーブル表示・タイムライン表示が切り替わる
8. `/admin/pages` に管理者で入れ、非管理者では入れない

### 実行の進め方

1. この計画の全文を `docs/wiki-refactoring/index.md` にコピーする
2. `01`〜`06` のステージファイルを `plan-creator` の見出し規約で作成する
3. 各ステージファイルを作成したら抽出を検証する:

```bash
node .claude/skills/plan-creator/scripts/check-extraction.mjs docs/wiki-refactoring/0*.md
```

4. 4 節すべて `OK` になってから、1 ファイルずつ順に実行する
   （`index.md` は delegate 対象外なので `MISSING` が出て正常）
