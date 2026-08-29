# wiki architecture

`CLAUDE.md` は運用上の前提（バインディング・3 ハンドラ・auth・Drizzle・i18n・E2E）。
このファイルは「コードがどこにあるか」だけを扱う。散文は置かない。表と箇条書きだけ。

- このマップは**ファイルを移動したら同じ変更内で更新する契約**。更新しないマップは即座に嘘になる。
- 全体計画とステージ分割は `docs/wiki-refactoring/index.md`。
- 「配置ルール」はステージ 02〜06 が実現していく目標状態。現時点のツリーはまだ従っていない。

## Code map

まずこの表で場所を絞り、それから grep する。

| 探しもの | 場所 |
|---|---|
| ページ本体 / アーカイブ / メタ / ツリー / パス | `app/lib/page-*.ts`, `app/lib/page-*.server.ts`, `app/lib/wiki-page-path*.ts` |
| ページ ACL / 可視性 | `app/lib/acl-spans*.ts`, `app/lib/page-access.server.ts`, `app/lib/page-visibility.server.ts` |
| ソース取り込み（UI / API / loader・action 側） | `app/lib/sources.server.ts`, `app/lib/sources-shared.ts`, `app/routes/sources.tsx`, `app/routes/api.sources.*` |
| ソース取り込み（Worker 実行 / DO alarm / refresh cron） | `workers/features/sources/` — README あり |
| wiki 生成 AI（Agents SDK / Workflow / model・tools） | `workers/features/ingestion/` — README あり |
| 生成 AI のクライアント配線・slug | `app/features/ingestion/`, `app/routes/ingest*.tsx`, `app/routes/api.ingest.*` |
| AI 検索（Workers AI + Vectorize） | `app/features/ai-search/` — README あり |
| AI モデル共通ラッパ（Vercel AI SDK / structured output） | `app/features/ai/model/` — README あり |
| 翻訳（JA→EN、`TRANSLATION_QUEUE`） | `app/features/translation/` — README あり。振り分けは `app/lib/queue-processors.server.ts` |
| ZIP インポート | `app/features/zip-import/` — README あり。ルートは `app/routes/api.wiki.import-zip*.ts` |
| Google Docs インポート（プレビュー / ジョブ / 反映） | `app/features/google-documents/` — README あり。ルートは `app/routes/api.google-documents.*` |
| Google 連携（Drive / Docs / Forms / Chat / Picker） | `app/lib/google-*.ts`, `app/lib/google-*.server.ts` |
| Discord 連携（OAuth / API / トークン / リマインダ） | `app/lib/discord-*.server.ts` |
| CLI 読み取り API（`gdg wiki`） | `app/routes/api.cli.wiki.*`（正本は `openapi/openapi.yaml`） |
| エージェント読み取り API（ls / cat / search、Vectorize 不使用） | `app/routes/api.agent.*` |
| リアルタイム共同編集 | `workers/collab-durable-object.ts`, `app/hooks/useCollabEditor.ts`, `app/lib/remote-cursors-*.ts`, `app/lib/tiptap-convert.ts` |
| 通知（メール / FCM / Discord） | `app/lib/notify.server.ts`, `app/lib/email.server.ts`, `app/lib/fcm.server.ts` |
| タスク | `app/routes/tasks.*`, `app/routes/api.tasks.*`（Discord リマインダ cron は `workers/features/sources/fetch-source.ts`） |
| DB スキーマ | `app/db/schema.ts` |
| 横断プリミティブ（DB / 時刻 / 色 / URL / キュー振り分け / 章ディレクトリ / OG 画像） | `app/lib/db.server.ts`, `utils.ts`, `time.ts`, `color-utils.ts`, `url-extract.ts`, `queue-processors.server.ts`, `chapter-directory.server.ts`, `og-image.server.tsx` |

## 配置ルール

（`docs/wiki-refactoring/index.md` §2 の転記。ステージ 02〜06 が実現する目標状態。）

1. **ドメインを持つコードは `app/features/<domain>/` に置く。** サーバ・クライアント・UI・テストを
   同居させる。UI は `app/features/<domain>/components/`。
2. **`app/lib/` に残すのは、どのドメインにも属さない横断プリミティブだけ。** 残すもの:
   `db.server.ts` (fan-in 91), `utils.ts`, `time.ts`, `color-utils.ts`, `url-extract.ts`,
   `queue-processors.server.ts`（キュー振り分けのディスパッチャ）, `chapter-directory.server.ts`,
   `og-image.server.tsx`。**新規ファイルを `app/lib/` に足すことは原則禁止**（architecture
   テストでホワイトリスト固定）。
3. **`app/components/` に残すのはアプリシェルと `ui/` プリミティブだけ。** シェル: `Navbar`
   `Footer` `Sidebar` `BaseSidebar` `SidebarDialog` `SidebarPopover` `Toast` `Tooltip`
   `ConfirmDialog` `Skeleton`。それ以外は feature 配下へ。
4. **`app/routes/` 配下はルートモジュールとその `_components/` だけ。** loader/action から
   呼ばれるビジネスロジックは feature の `*.server.ts` に置く。ルートモジュールは「引数を読む →
   feature を呼ぶ → レスポンスを組む」に留める。
5. **テストは被験対象の隣に、`<subject>.test.ts` の名前で置く。** 1 対象に複数の観点が要る
   場合のみ `<subject>.<aspect>.test.ts`。`app/lib/create-source.server.test.ts` のような、
   被験対象名と一致しない名前は禁止。
6. **1 ファイル 400 行以下**（テスト・生成物を除く）。既存超過分は縮小専用の allowlist で管理する。
7. **`workers/` はランタイム境界（Worker entry / DO / Workflow / Agent）と、Worker 側でしか
   動かない feature 実装だけ。** `workers/features/<x>/` は ingestion の 4 層（orchestration /
   model / tools / persistence）を手本にする。

## ランタイム境界

| 境界 | 実体 |
|---|---|
| Worker entry（fetch / scheduled / queue） | `workers/app.ts` |
| Durable Object | `workers/collab-durable-object.ts`, `workers/source-import-durable-object.ts` |
| Workflow | `workers/workflows/wiki-generation-phase-workflow.ts` |
| Agents SDK | `workers/agents/wiki-generation-agent.ts` |

## 読まないファイル

すべて生成物。`grep -r` のノイズになるだけ。

| ファイル | 行数 | 正本 |
|---|---|---|
| `worker-configuration.d.ts` | 14,750 | `wrangler.toml` のバインディング表（`CLAUDE.md` 内） |
| `schema.sql` | 599 | `app/db/schema.ts` |
| `openapi/types.generated.ts` | 1,157 | `openapi/openapi.yaml` |

## テストの置き場

| 種類 | 置き場 | 命名 |
|---|---|---|
| ユニット | 被験対象の隣 | `<subject>.test.ts` / `<subject>.<aspect>.test.ts` |
| マイグレーション | `tests/migrations/` | `<migration-number>_<name>.test.ts` |
| アーキテクチャ規約 | `tests/architecture/` | 検査する規約の名前 |
| ゴールデン | `tests/golden/` | 既存のまま |
| E2E | `tests/e2e/` | `*.spec.ts` |

`app/**` `workers/**` `shared/**` のユニットテストは被験対象と同じディレクトリに置き、
ファイル名の先頭は被験ソースの basename に一致させる（`test-colocation.test.ts` が強制）。
ソースツリーを走査する検査テストは `tests/architecture/` へ。ただし
`architecture.test.ts` で終わる 2 本（`workers/features/ingestion/`,
`app/routes/api.agent.`）は多数の相対パスを持つため現在地に留める。

## 規約を強制しているテスト

後続ステージで `tests/architecture/` が増えたらここに追記する。

| テスト | 強制する規約 |
|---|---|
| `workers/features/ingestion/architecture.test.ts` | ingestion 4 層（orchestration / model / tools / persistence）の import 境界 |
| `app/routes/api.agent.architecture.test.ts` | エージェント読み取り API が Vectorize / embedding を使わない |
| `tests/architecture/test-colocation.test.ts` | ユニットテストが被験ソースの隣に `<subject>.test.ts` で置かれている |
| `tests/architecture/design-token-policy.test.ts` | セマンティックトークンのみ使用（`DESIGN.md`）。パレット直値・色リテラル禁止 |
| `tests/architecture/theme-tokens.test.ts` | ライト / ダークのトークン定義が揃っている |
| `tests/architecture/source-surface-exclusions.test.ts` | conversation ソースが 3 サーフェスで DB クエリ時に除外される |
| `tests/architecture/search-source-exclusions.test.ts` | 生ソースが Vectorize / pages FTS に入らない |
| `tests/architecture/agent-workspace-routes.test.ts` | エージェント API のパス解決契約（contracts / paths / wiki-adapter 横断） |
