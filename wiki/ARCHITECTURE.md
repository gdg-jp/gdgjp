# wiki architecture

`CLAUDE.md` は運用上の前提（バインディング・3 ハンドラ・auth・Drizzle・i18n・E2E）。
このファイルは「コードがどこにあるか」だけを扱う。散文は置かない。表と箇条書きだけ。

- このマップは**ファイルを移動したら同じ変更内で更新する契約**。更新しないマップは即座に嘘になる。
- 全体計画とステージ分割は `docs/wiki-refactoring/index.md`。
- Stage 06 完了（最終）。`app/lib/` は横断プリミティブ 8 本のみ、ドメインコードは `app/features/<domain>/` に
  集約済み、非テストソースは 1 ファイル 400 行以下（`file-size.test.ts` の縮小専用 allowlist で例外 2 本を固定）。
  大きかったファイルは同一ディレクトリ内の焦点モジュール（`<domain>/<name>.server.ts` の分割、`components/<Name>/`
  ディレクトリ化）に割った。どのファイルを見るかはディレクトリ単位で下の表から絞る。

## Code map

まずこの表で場所を絞り、それから grep する。

| 探しもの | 場所 |
|---|---|
| ページ本体 / ACL / 可視性 / ツリー / メタ / パス / アーカイブ | `app/features/pages/` — README あり。UI は `app/features/pages/components/` |
| ソース取り込み（UI / API / loader・action 側） | `app/features/sources/` — README あり。ルートは `app/routes/sources/`, `app/routes/api/sources/` |
| ソース取り込み（Worker 実行 / DO alarm / refresh cron） | `workers/features/sources/` — README あり |
| wiki 生成 AI（Agents SDK / Workflow / model・tools） | `workers/features/ingestion/` — README あり |
| 生成 AI のクライアント配線・slug | `app/features/ingestion/` — README あり。ルートは `app/routes/ingest/`, `app/routes/api/ingest/`。UI は `app/features/ingestion/components/` |
| AI 検索（Workers AI + Vectorize） | `app/features/ai-search/` — README あり |
| AI モデル共通ラッパ（Vercel AI SDK / structured output） | `app/features/ai/model/` — README あり |
| 翻訳（JA→EN、`TRANSLATION_QUEUE`） | `app/features/translation/` — README あり。振り分けは `app/lib/queue-processors.server.ts` |
| ZIP インポート | `app/features/zip-import/` — README あり。ルートは `app/routes/api/pages/import-zip*.ts` |
| Google 連携（Drive / Docs / Forms / Chat / Picker） | `app/features/google/` — README あり |
| Google Docs インポート（プレビュー / ジョブ / 反映） | `app/features/google/documents/` — README あり。ルートは `app/routes/api/google/documents-*.ts` |
| Discord 連携（OAuth / API / トークン / リマインダ） | `app/features/discord/` — README あり |
| 認証（RP / セッション / クレーム） | `app/features/auth/` — README あり |
| CLI 読み取り API（`gdg wiki`） | サーバロジックは `app/features/agent-api/`。ルートは `app/routes/api/cli/*`（URL は `/api/cli/wiki/*`、正本は `openapi/openapi.yaml`） |
| エージェント読み取り API（ls / cat / search、Vectorize 不使用） | サーバロジックは `app/features/agent-api/`。ルートは `app/routes/api/agent/*` |
| リアルタイム共同編集 | `workers/collab-durable-object.ts`, `app/features/editor/`（`use-collab-editor.ts`, `remote-cursors-*.ts`, `tiptap-convert.ts`）— README あり |
| 通知（メール / FCM / Discord） | `app/features/notifications/` — README あり |
| タスク | サーバ・UI は `app/features/tasks/`（README あり）。ルートは `app/routes/tasks/`, `app/routes/api/tasks/`。リマインダ cron は `app/features/discord/reminders.server.ts` |
| DB スキーマ | `app/db/schema/`（ドメイン別モジュール。テーブル割り当ては下の「DB スキーマ」節） |
| 横断プリミティブ（DB / 時刻 / 色 / URL / キュー振り分け / 章ディレクトリ / OG 画像） | `app/lib/`（8 本のみ: `db.server.ts`, `utils.ts`, `time.ts`, `color-utils.ts`, `url-extract.ts`, `queue-processors.server.ts`, `chapter-directory.server.ts`, `og-image.server.tsx`） |
| アプリシェル UI | `app/components/`（10 本 + `ui/` プリミティブのみ。それ以外は feature 配下） |

## ルート構成

`app/routes/` はサブディレクトリで意味を分ける。ドット接頭辞（`api.agent.cat.ts`）と
URL パラメータ（`$slug` / `$id`）はファイル名から落とし、ディレクトリが接頭辞を担う。
**URL は `app/routes.ts` の `route()` 第 1 引数が持つ。ファイル名は「何をするか」だけ。**
一覧系 API は `list.ts`（`index.ts` は barrel と紛らわしいので使わない）。
アンダースコア接頭辞（`public/_components/`, `wiki/_components/` 等）はルートではないモジュール。

```
app/routes/
  _app.tsx          アプリシェルの layout（routes.ts の layout() 起点。動かさない）
  _index.tsx        シェル配下のホーム
  $.tsx / $.test.ts catch-all 404
  settings.tsx
  public/           シェルを持たない公開ページ（about/privacy/terms/signin/logout/api-auth）。ランディング部品は _components/
  wiki/             /wiki/*・閲覧系（page/edit/history/new/recent/archived/search/og-image）。ビュー部品は _components/
  sources/          /sources（page.tsx + テスト）。フォーム部品は _components/
  tasks/            /tasks/*（detail/settings/history/new）
  ingest/           /ingest/*・/analyze（start/session/analyze）
  admin/            /admin/*（layout/index/pages/tags/stats）
  api/
    agent/          /api/agent/*        — architecture.test.ts はここに留める
    cli/            /api/cli/wiki/*     — サーバロジックは app/features/agent-api/
    pages/          コメント / お気に入り / アクセス / 画像 / ZIP / reorder / recent / archived
    google/         Drive auth・Chat spaces・Documents インポート
    sources/        /api/sources/*（list/archive/unarchive/refresh/visibility）
    user/           言語切替 / 通知 / FCM / ユーザ検索
    ingest/         /api/ingest/:sessionId/*（status/commit/clarify/select-urls/regenerate）
    discord/        /api/discord/*（auth/callback/guilds/guild-channels）
    tasks/          /api/tasks/*（list/task/teams/reorder）
    admin/          /api/admin/backfill-embeddings
```

どのディレクトリも 25 ファイル以下。`route-urls.test.ts` が公開 URL 全集合を
スナップショットで固定しているので、URL 変更は差分としてレビューに現れる。

## DB スキーマ

`app/db/schema.ts`（35 テーブル）を `app/db/schema/` にドメイン別分割。`index.ts` が全モジュールを
`export *` で再エクスポートするため、`~/db/schema` という import 指定子は不変（呼び出し側の変更ゼロ）。
`index.ts` に定義は書かない。依存順は `user` / `chapters` / `tags` / `ingestion` → `sources` →
`pages` → `google` / `discord` / `notifications` / `tasks`（循環なし）。

| モジュール | テーブル |
|---|---|
| `user.ts` | `user`, `userPreferences` |
| `chapters.ts` | `chapters` |
| `tags.ts` | `tags` |
| `ingestion.ts` | `ingestionSessions` |
| `sources.ts` | `sources`, `sourceDocuments`, `sourceAssets`, `sourceImportRuns`, `googleChatSenderProfiles`, `googleChatSenderSamples` |
| `pages.ts` | `pages`, `wikiAgentInstructions`, `pageTags`, `pageAttachments`, `pageVersions`, `pageFavorites`, `pageSources`, `pageComments`, `commentReactions`, `pageEmbeddingStatus`, `pageViews`, `pageAccess` |
| `google.ts` | `googleDriveTokens`, `googleDocumentImports`, `googleDocumentImportNodes`, `googleDocumentImportJobs` |
| `discord.ts` | `discordOauthTokens`, `discordGuildSettings` |
| `notifications.ts` | `notifications`, `fcmTokens` |
| `tasks.ts` | `taskLists`, `taskListTeams`, `tasks`, `taskDependencies` |

`googleChatSenderProfiles` / `googleChatSenderSamples` は名前に google が付くが、`sources` を参照する
取り込み側のテーブルなので `sources.ts`（`google.ts` は OAuth トークンと Docs インポートの管理）。

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
| `schema.sql` | 599 | `app/db/schema/` |
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
`app/routes/api/agent/`）は多数の相対パスを持つため現在地に留める。

## 規約を強制しているテスト

新しい規約テストを `tests/architecture/` に足したらここに追記する。

| テスト | 強制する規約 |
|---|---|
| `workers/features/ingestion/architecture.test.ts` | ingestion 4 層（orchestration / model / tools / persistence）の import 境界 |
| `app/routes/api/agent/architecture.test.ts` | エージェント読み取り API が Vectorize / embedding を使わない |
| `workers/app.scheduled.test.ts` | `scheduled` の 2 cron 分岐が移動後の feature モジュールへ届く（cron は本番のみ実行） |
| `tests/architecture/test-colocation.test.ts` | ユニットテストが被験ソースの隣に `<subject>.test.ts` で置かれている |
| `tests/architecture/file-size.test.ts` | 非テストソースは 1 ファイル 400 行以下。例外は縮小専用 allowlist（現在 2 本）で凍結 |
| `tests/architecture/layering.test.ts` | Stage 05 の配置ルール: `app/lib/` の中身固定 / `app/components/` はシェルのみ / `app/features/` は routes を import しない / app 層は worker の persistence・orchestration 内部へ届かない |
| `tests/architecture/route-urls.test.ts` | `app/routes.ts` が公開する URL 全集合（スナップショット固定） |
| `tests/architecture/design-token-policy.test.ts` | セマンティックトークンのみ使用（`DESIGN.md`）。走査対象は `app/{components,routes}` + `app/features/*/components/` |
| `tests/architecture/theme-tokens.test.ts` | ライト / ダークのトークン定義が揃っている |
| `tests/architecture/source-surface-exclusions.test.ts` | conversation ソースが 3 サーフェスで DB クエリ時に除外される |
| `tests/architecture/search-source-exclusions.test.ts` | 生ソースが Vectorize / pages FTS に入らない |
| `tests/architecture/agent-workspace-routes.test.ts` | エージェント API のパス解決契約（contracts / paths / wiki-adapter 横断） |
