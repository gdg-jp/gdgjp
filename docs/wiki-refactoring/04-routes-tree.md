# Stage 04 routes-tree — app/routes/ のサブディレクトリ化

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-refactoring/index.md`。**着手前に必ず読むこと。**
このステージは Stage 01・02・03 の完了後に実行する。

`wiki/app/routes/` は 130 ファイルがフラットに並んでいる（次に大きい `accounts/` で 48）。
ドット区切りの長い名前（`api.google-documents.import.$jobId.status.ts`）が並ぶため、
`ls` や Glob 1 回で 130 行が返り、しかもどれが API でどれがページかが名前を読むまで分からない。
エージェントが「`/api/agent/*` の実装はどれか」を知るのに毎回 130 行を読んでいる。

このステージはファイルを意味のあるサブディレクトリへ移し、ドット接頭辞を落として短い名前にする。
**URL は 1 つも変わらない。**

### 対象範囲

`wiki/app/routes/` と `wiki/app/routes.ts` のみ。
`app/lib/` `app/components/` `app/features/` `workers/` は Stage 05 の担当で、触らない。

### 読むべきもの

- `docs/wiki-refactoring/index.md` — 全体計画。配置ルール 4（ルートは薄く保つ）が根拠
- `wiki/app/routes.ts` — 123 行。全ルートの URL → ファイルパス対応表。**このステージの主戦場**
- `wiki/ARCHITECTURE.md` — Stage 01〜03 で育てたコードマップ。このステージで更新する

### 再利用する既存実装 — 書き直さないこと

- ルートモジュールの中身。**`loader` / `action` / コンポーネントを 1 行も書き換えない。**
  このステージで変えてよいのは、ファイルの位置と、それに伴う相対 import パスだけ。
  中身の分割は Stage 06 の担当
- `app/routes.ts` の `route()` / `index()` / `layout()` のネスト構造。
  `layout("routes/_app.tsx", [...])` の入れ子や `route("admin", ..., [...])` の子ルート配列は、
  そのままの形を保つ

### 前提として確認済みの事実（再調査不要）

- **ルートファイル 115 本のうち、`./+types/` を import しているものは 0 本。**
  すべて `LoaderFunctionArgs` / `ActionFunctionArgs` を `react-router` から直接 import している。
  React Router の typegen との結合がないため、ファイル移動は純粋なパス変更で完結する
- **`app/routes.ts` は明示的な `route(url, file)` 設定。**
  ファイル名から URL を導出する規約（flat routes）は使っていない。
  したがってファイル名を自由に変えても URL は変わらない
- **ルートモジュールを import しているのは同ディレクトリの `.test.ts` だけ。**
  `~/routes/` を参照しているコードはリポジトリ全体で 0 件

---

## Design — 設計

### 1. 目標構成

```
app/routes/
  _app.tsx          アプリシェルの layout
  _index.tsx        シェル配下のホーム
  $.tsx             catch-all 404
  settings.tsx
  public/           シェルを持たない公開ページ         (6)
  wiki/             /wiki/* と閲覧系ページ             (8)
  sources/          /sources                           (1)
  tasks/            /tasks/*                           (4)
  ingest/           /ingest/*, /analyze                (3)
  admin/            /admin/*                           (5)
  api/
    agent/          /api/agent/*                       (8)
    cli/            /api/cli/wiki/*                    (8)
    pages/          ページ関連の API                   (11)
    google/         Drive / Chat / Documents           (7)
    sources/        /api/sources/*                     (5)
    user/           言語・通知・ユーザ検索             (5)
    ingest/         /api/ingest/*                      (5)
    discord/        /api/discord/*                     (4)
    tasks/          /api/tasks/*                       (4)
    admin/          /api/admin/*                       (1)
```

どのディレクトリも 25 ファイル以下になる。

### 2. 命名規則

- **ドット接頭辞を落とす。** ディレクトリが接頭辞の役割を担う。
  `api.agent.cat.ts` → `api/agent/cat.ts`
- **URL パラメータ（`$slug` / `$id`）をファイル名から落とす。**
  URL は `routes.ts` が持っているので、ファイル名は「何をするか」だけを表す。
  `api.sources.$id.archive.ts` → `api/sources/archive.ts`
- **一覧・コレクションの API は `list.ts`。** `index.ts` は barrel と紛らわしいので使わない
- **アンダースコア接頭辞はルートではないモジュール。**
  `api.cli.wiki.sync.helpers.ts` → `api/cli/_sync-helpers.ts`。
  Stage 05 で `app/features/agent-api/` へ移すが、このステージでは routes 配下に留める
- **テストは対象と一緒に動かし、同じ改名を適用する。**
  `wiki.$.test.ts` → `wiki/page.test.ts`、`sources.batch.test.ts` → `sources/page.batch.test.ts`

### 3. 移動表（ページルート）

| 現在 | 移動先 |
|---|---|
| `_app.tsx` `_index.tsx` `$.tsx` `$.test.ts` `settings.tsx` | 現在地のまま |
| `about.tsx` `privacy.tsx` `terms.tsx` `signin.tsx` `logout.tsx` `api-auth.tsx` | `public/` に同名 |
| `wiki.$.tsx` / `wiki.$.test.ts` | `wiki/page.tsx` / `wiki/page.test.ts` |
| `wiki.$slug.edit.tsx` | `wiki/edit.tsx` |
| `wiki.$slug.history.tsx` | `wiki/history.tsx` |
| `wiki.new.tsx` | `wiki/new.tsx` |
| `recent.tsx` `archived.tsx` `search.tsx` | `wiki/` に同名 |
| `og.wiki.$slug.tsx` | `wiki/og-image.tsx` |
| `sources.tsx` | `sources/page.tsx` |
| `sources.batch.test.ts` `sources.refresh.test.ts` `sources.discord-title.test.ts` | `sources/page.batch.test.ts` ほか同形 |
| `tasks.$slug.tsx` | `tasks/detail.tsx` |
| `tasks.$slug.settings.tsx` | `tasks/settings.tsx` |
| `tasks.$slug.history.tsx` | `tasks/history.tsx` |
| `tasks.new.tsx` | `tasks/new.tsx` |
| `ingest.tsx` | `ingest/start.tsx` |
| `ingest.$sessionId.tsx` | `ingest/session.tsx` |
| `analyze.tsx` | `ingest/analyze.tsx` |
| `admin.tsx` | `admin/layout.tsx` |
| `admin._index.tsx` | `admin/index.tsx` |
| `admin.pages.tsx` / `admin.pages.test.ts` | `admin/pages.tsx` / `admin/pages.test.ts` |
| `admin.tags.tsx` `admin.stats.tsx` | `admin/` に同名 |

`analyze.tsx` は Google Forms を解析して ingestion を起動するページなので `ingest/` に置く。

### 4. 移動表（API ルート）

接頭辞を落として下記へ。テストは同名で追随する。

| 移動先 | 現在のファイル → 新しい名前 |
|---|---|
| `api/agent/` | `api.agent.{cat,instructions,log,ls,notes,search,sources}.ts` → 同名。`api.agent.sources.inline.ts` → `sources-inline.ts`。`api.agent.architecture.test.ts` → `architecture.test.ts`（この位置に留める） |
| `api/cli/` | `api.cli.wiki.agents-md.ts` → `agents-md.ts` / `...attachments.$attachmentId.ts` → `attachments.ts` / `...chat-senders.ts` → `chat-senders.ts` / `...snapshot.ts` → `snapshot.ts` / `...sources.$documentId.content.ts` → `source-content.ts` / `...sources.ts` → `sources.ts` / `...sync.ts` → `sync.ts` / `...sync.helpers.ts` → `_sync-helpers.ts` / `...validate-acl.ts` → `validate-acl.ts` |
| `api/pages/` | `api.comments.ts` → `comments.ts` / `api.favorites.tsx` → `favorites.tsx` / `api.page-access.$pageId.tsx` → `access.tsx` / `api.pages.reorder.ts` → `reorder.ts` / `api.share-candidates.ts` → `share-candidates.ts` / `api.wiki.$slug.upload-image.ts` → `upload-image.ts` / `api.wiki.import-zip.ts` → `import-zip.ts` / `api.wiki.import-zip.preview.ts` → `import-zip-preview.ts` / `api.images.$.ts` → `images.ts` / `api.archived.ts` → `archived.ts` / `api.recent.ts` → `recent.ts` |
| `api/google/` | `api.google-drive.auth.ts` → `drive-auth.ts` / `...callback.ts` → `drive-callback.ts` / `api.google-chat.spaces.ts` → `chat-spaces.ts` / `api.google-documents.picker-token.ts` → `documents-picker-token.ts` / `api.google-documents.import.ts` → `documents-import.ts` / `...import.preview.ts` → `documents-import-preview.ts` / `...import.$jobId.status.ts` → `documents-import-status.ts` |
| `api/sources/` | `api.sources.ts` → `list.ts` / `api.sources.$id.{archive,unarchive,refresh,visibility}.ts` → 同名から `$id.` を除去 |
| `api/user/` | `api.set-ui-lang.tsx` → `set-ui-lang.tsx` / `api.set-content-lang.tsx` → `set-content-lang.tsx` / `api.fcm-tokens.ts` → `fcm-tokens.ts` / `api.notifications.ts` → `notifications.ts` / `api.users.search.ts` → `search.ts` |
| `api/ingest/` | `api.ingest.$sessionId.{status,commit,clarify,select-urls,regenerate}.ts` → `$sessionId.` を除去 |
| `api/discord/` | `api.discord.auth.ts` → `auth.ts` / `...callback.ts` → `callback.ts` / `...guilds.ts` → `guilds.ts` / `...guilds.$guildId.channels.ts` → `guild-channels.ts` |
| `api/tasks/` | `api.tasks.$taskListId.ts` → `list.ts` / `...$taskId.ts` → `task.ts` / `...teams.ts` → `teams.ts` / `...reorder.ts` → `reorder.ts` |
| `api/admin/` | `api.admin.backfill-embeddings.ts` → `backfill-embeddings.ts` |

Stage 01 で `api.sources.$id.delete.ts` を残す判断をした場合は `api/sources/delete.ts` へ。

### 5. `app/routes.ts` を更新する

各 `route()` の**第 2 引数だけ**を新しいパスに書き換える。**第 1 引数（URL）は一切触らない。**
`layout()` と `index()` の第 1 引数もファイルパスなので更新対象。

書き換え後、コメント（`// Public routes (no app shell)` 等）はディレクトリ名と重複するので、
情報が増えないものは削ってよい。ただし `admin` 節の「User and chapter management are owned by
the accounts IdP」のような**理由を説明しているコメントは残す**。

### 6. `tests/architecture/route-urls.test.ts` を新設する

`app/routes.ts` が公開する URL の全集合をスナップショットで固定する。
このステージ以降、URL の変更が差分としてレビューに現れるようになる。

実装は `app/routes.ts` を import して `RouteConfig` を再帰的に歩き、
親のパスを連結したフル URL の配列を作り、ソートして `toMatchSnapshot()` する。
`routes.ts` は `@react-router/dev/routes` の関数を使うだけで副作用がないため、
Vitest から普通に import できる。

**このテストはこのステージで最初に書き、移動前のスナップショットを取ってから移動する。**
順序を逆にすると、壊れた URL がそのままスナップショットに焼き付く。

### 7. `ARCHITECTURE.md` / `CLAUDE.md` を更新する

Code map のルート関連の行を新しいパスに直す。
`ARCHITECTURE.md` に上の「目標構成」ツリーをそのまま置く。
`README.md` の「Directory structure」は Stage 01 で `ARCHITECTURE.md` 参照に置換済みなので触らない。

### 制約

- **URL を 1 つも変えない。** `route()` の第 1 引数は不変。
  これが崩れると本番の外部リンク・ブックマーク・`gdg` CLI の API 呼び出しが 404 になる
- **ルートモジュールの中身を書き換えない。** `loader` / `action` / コンポーネントの
  ロジック分割は Stage 06 の担当。このステージで変えるのは相対 import パスだけ
- **`git mv` で移動する。** 履歴を切らない。move コミットと `routes.ts` 更新コミットを分ける
- **`app/lib/` `app/components/` `app/features/` `workers/` を移動しない。** Stage 05 の担当
- **`api.agent.architecture.test.ts` の `expect` を減らさない。**
  `api/agent/architecture.test.ts` へ移すと `import.meta.url` 相対のパス
  （`../lib/agent-workspace.server.ts` など）の深さが 1 段増える。
  **パスだけ直し、`expect` の内容と本数は変えない。** これは安全装置である
- **`_app.tsx` を移動しない。** シェル layout であり、`routes.ts` の `layout()` の
  ネスト構造の起点。動かす利得がない
- **スコープ境界。** `_sync-helpers.ts` を `app/features/` へ移すのは Stage 05。
  このステージでは routes 配下でアンダースコア接頭辞にするだけ

---

## Files to touch — 変更ファイル

### 移動（`git mv`）

- `wiki/app/routes/` の 130 ファイルのうち 126 本（`_app.tsx` `_index.tsx` `$.tsx` `$.test.ts`
  `settings.tsx` は現在地）を、上の 3. と 4. の表のとおり `public/` `wiki/` `sources/`
  `tasks/` `ingest/` `admin/` `api/{agent,cli,pages,google,sources,user,ingest,discord,tasks,admin}/` へ

### 新規

- `wiki/tests/architecture/route-urls.test.ts`

### 変更

- `wiki/app/routes.ts` — 全 `route()` / `index()` / `layout()` の**ファイルパス引数のみ**
- 移動したファイルの相対 import（`../../workers/...` `../../shared/...` の深さが 1 段増える）
- `wiki/ARCHITECTURE.md`、`wiki/CLAUDE.md` — Code map とルート構成ツリー

---

## Verification — 完了条件と検証

### 完了条件

- `app/routes/` 直下のファイルが 5 本（`_app.tsx` `_index.tsx` `$.tsx` `$.test.ts` `settings.tsx`）
  + 10 ディレクトリ
- どのディレクトリも 25 ファイル以下
- **`tests/architecture/route-urls.test.ts` のスナップショットが移動前後で無変更**
- `pnpm build` と E2E が通る

### コマンド

**移動を始める前に**スナップショットを作る（順序が重要）:

```bash
cd wiki && pnpm exec vitest run tests/architecture/route-urls.test.ts
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

```bash
pnpm --filter @gdgjp/wiki test:e2e
```

URL が変わっていないことの直接確認（差分が空であること）:

```bash
cd wiki && git show HEAD:app/routes.ts | grep -oE '(route|index)\("[^"]+"' | grep -v 'routes/' | sort > /tmp/urls-before.txt && grep -oE '(route|index)\("[^"]+"' app/routes.ts | grep -v 'routes/' | sort > /tmp/urls-after.txt && diff /tmp/urls-before.txt /tmp/urls-after.txt && echo "URLs identical"
```

ディレクトリごとのファイル数:

```bash
cd wiki && find app/routes -mindepth 1 -type d | while read d; do echo "$(ls "$d" | wc -l | tr -d ' ') $d"; done | sort -rn
```

### 回帰として固定すべきテスト — 静かに壊れる経路

型検査もビルドも通るのに壊れる経路が 4 つある。

- **`routes.ts` の URL を巻き込んで書き換えた。** ファイルパスと URL が同じ行にあるため、
  一括置換で URL 側まで変わる事故が起きる。typecheck も build も通り、**本番で 404 になる**。
  上の `urls-before/after` の diff と `route-urls.test.ts` のスナップショットが唯一の検出手段。
  **スナップショットは移動前に取ること。**移動後に取ると壊れた URL が焼き付く
- **ルートを `routes.ts` から登録し忘れた。** ファイルを移動して `routes.ts` の
  パスを直し忘れると、React Router がファイルを見つけられずビルドが落ちるので安全側。
  ただし**逆（ファイルは残っているのに登録が消えた）は静かに通る**。
  移動前後で `routes.ts` の `route(` の出現回数が一致することを確認する
- **`gdg` CLI が叩く `/api/cli/wiki/*` の URL が変わった。**
  これらは `openapi/openapi.yaml` に定義され、Go の CLI から呼ばれる。
  リポジトリ内の TypeScript には CLI 側の呼び出しがないため、**壊しても wiki の CI は全部緑になる**。
  `grep -n "api/cli/wiki" openapi/openapi.yaml` の一覧と `routes.ts` の URL を突き合わせる
- **`api.agent.architecture.test.ts` が自分の被験ファイルを見失った。**
  `readFileSync(new URL("../lib/agent-workspace.server.ts", import.meta.url))` は
  深さが変わると `ENOENT` で赤くなるので安全側。しかし**パスを直す過程で
  `expect` を 1 つ消しても緑のまま**になる。移動前後で `grep -c "expect(" ` を比較する

### 手動 E2E

URL の生存確認が目的。全ドメインを 1 回ずつ通す。

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. `/signin` からサインインし、`/`（ホーム）が表示される
3. `/wiki/<既存ページ>` が本文・TOC・コメント付きで表示され、`/wiki/<slug>/edit` と
   `/wiki/<slug>/history` に遷移できる
4. `/search` `/recent` `/archived` が表示される
5. `/sources` でソース一覧が出て、1 件アーカイブ→アンアーカイブできる（`/api/sources/*`）
6. `/ingest` からセッションを開始し、`/ingest/:sessionId` がリアルタイム更新される
   （`/api/ingest/*` と Agents SDK 経路）
7. `/tasks/<slug>` が表示され、タスクを 1 件作成できる（`/api/tasks/*`）
8. `/admin/pages` に管理者で入れ、非管理者では入れない
9. `/about` `/privacy` `/terms` が表示される
10. 存在しない URL（`/no-such-page`）で 404 が返る（catch-all）
