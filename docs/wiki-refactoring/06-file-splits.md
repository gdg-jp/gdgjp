# Stage 06 file-splits — 巨大ファイルの分割とガードレールの固定

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-refactoring/index.md`。**着手前に必ず読むこと。**
このステージは Stage 04・05 の完了後に実行する。全体計画の最終段。

Stage 01〜05 でディレクトリは意味で分かれたが、1 ファイルの大きさは手つかずのまま。
非テストソース 52,459 行のうち、400 行超が 27 本、700 行超が 10 本ある。
最大は `app/routes/sources.tsx` の 1,493 行。

エージェントが 40 行の `loader` を確認したいだけでも、ファイル単位で読むため
1 回 15〜25k トークンを消費する。ディレクトリを整理しても、この 1 ファイルの重さは減らない。

このステージで責務ごとに分割し、以後の肥大を `tests/architecture/file-size.test.ts` で止める。
併せて、Stage 01〜05 で作った配置ルールを `layering.test.ts` で実行可能にする。

### 対象範囲

`wiki/app/` と `wiki/workers/features/sources/`。
**`workers/features/ingestion/` は対象外**（既に 4 層に分割済みで、
`architecture.test.ts` が層境界を守っている。触ると安全装置を壊す）。

### 読むべきもの

- `docs/wiki-refactoring/index.md` — 全体計画。「巨大ファイル分割方針」の表が根拠
- `wiki/ARCHITECTURE.md` — Stage 05 で実態と一致した状態のコードマップ
- `wiki/workers/features/sources/import/drive/phases.ts` と
  `wiki/workers/features/sources/import/website/phases.ts` — **resumable phase 分割の手本**
- `wiki/workers/features/ingestion/architecture.test.ts` — 新設するガードレールの実装パターン

### 再利用する既存実装 — 書き直さないこと

- **分割対象ファイルのロジック。** 関数の実装・条件分岐・エラーハンドリングを 1 行も変えない。
  やるのは「切って別ファイルに置き、import で繋ぐ」だけ。
  **リファクタリングのついでに実装を直したくなるが、やらない。**
  差分に振る舞いの変更が混ざると、どちらが原因で壊れたか切り分けられなくなる
- `wiki/workers/features/sources/import/tick.ts` と `run.ts` — DO alarm による
  phase 駆動の既存実装。`google-chat-import.ts` / `discord-import.ts` の分割はこれに合わせる
- Stage 02 で作った `tests/architecture/test-colocation.test.ts` — 新しいテストも
  同じ `readdirSync` 走査の書き方を踏襲する

### 前提として確認済みの事実（再調査不要）

Stage 03 で `app/db/schema.ts`（623 行）は解決済みなので、このステージの対象から外れている。
残る 400 行超は 26 本。うち 2 本は分割せず allowlist に載せる（Design 3. 参照）。

---

## Design — 設計

### 1. 分割の原則

**「読む理由が違うものを分ける」**。行数を減らすこと自体が目的ではない。

ルートモジュールなら「HTTP の入出力」「データ取得・更新」「表示」の 3 つは読む理由が違う。
`loader` を確認したい人はコンポーネントを読まないし、その逆もない。

- ルートモジュールは `meta` / `loader` / `action` / default export のみを残す
- `loader` / `action` が呼ぶデータ処理は `app/features/<domain>/*.server.ts` へ
- 表示は `app/routes/<section>/_components/` か
  `app/features/<domain>/components/` へ
- 純関数（パース、整形、分類）は feature 直下のドメインなしモジュールへ

分割の結果、**目標は 1 ファイル 400 行以下**。

### 2. 分割対象（パスは Stage 04・05 完了後のもの）

700 行超（優先）:

| ファイル | 行 | 分割方針 |
|---|---|---|
| `app/routes/sources/page.tsx` | 1493 | `parseBatchCandidates` `titleFromUrl` `isHttpUrl` `buildDiscordSourceTitle` `sourceUrlFromGoogleDocument` を `features/sources/` の純関数モジュールへ。`loader`/`action` のデータ処理を `features/sources/*.server.ts` へ。`ChatSenderDialog` ほか UI を `routes/sources/_components/` へ |
| `app/features/pages/components/ShareDialog.tsx` | 1225 | ディレクトリ化 — `ShareDialog/index.tsx` / `chips.tsx`（`SelectedChip` `SelectedChips`）/ `avatar.tsx`（`Avatar` `AccessIcon` `initial`）/ `normalize.ts`（`normalizeEntry` `normalizeCandidate` `subjectKey` `isEmail`）/ `use-height-transition.ts` / `types.ts` |
| `app/routes/wiki/page.tsx` | 1054 | `loader` のデータ取得と `loadPageComments` を `features/pages/*.server.ts` へ。`parseMdHeadings` を `features/editor/toc.ts` へ。ビューを `routes/wiki/_components/` へ |
| `workers/features/sources/google-chat-import.ts` | 935 | `import/drive/phases.ts` と同じ phase 分割。`import/google-chat/phases.ts` + 補助モジュール |
| `app/features/sources/sources.server.ts` | 819 | `classify.ts`（`classifySourceUrl` `classifyGoogleChatSpace` `classifyDiscordChannel` `googleChatSpaceUrl` `discordChannelSourceUrl`）/ `permissions.ts`（`canAssignChapter` `canAssignSourceVisibility` `parseSourceVisibilitySelection`）/ `create.server.ts`（`createSource` `createInlineSource`）/ `lifecycle.server.ts`（`unarchiveSource` `deleteArchivedSource` `enqueueSourceRefresh` `updateSourceVisibility`） |
| `app/routes/ingest/session.tsx` | 765 | ビューを `features/ingestion/components/` へ |
| `app/routes/public/_components/LandingContent.tsx` | 756 | セクション単位に分割し `_components/landing/` へ |
| `app/features/google/documents/import.server.ts` | 752 | `preview.server.ts` / `job.server.ts` / `apply.server.ts` |
| `workers/features/sources/import/drive/phases.ts` | 749 | phase ごとのモジュールへ |
| `app/features/pages/components/PageTree.tsx` | 703 | `PageTree/index.tsx` / `build-tree.ts`（ツリー構築の純関数）/ `dnd.ts`（`@dnd-kit` の設定とハンドラ）/ `row.tsx` |

400〜700 行:

| ファイル | 行 | 分割方針 |
|---|---|---|
| `app/routes/tasks/detail.tsx` | 677 | `loader`/`action` を `features/tasks/*.server.ts` へ。ビューは既に `features/tasks/components/` にあるので残りを移す |
| `workers/features/sources/discord-import.ts` | 663 | phase 分割（`google-chat-import.ts` と同じ形に揃える） |
| `app/routes/api/cli/sync.ts` | 658 | 既存の `_sync-helpers.ts`（Stage 05 で `features/agent-api/cli-sync-helpers.ts` へ移動済み）に処理を寄せる |
| `app/features/ingestion/components/ChangesetReview.tsx` | 602 | 差分表示・操作パネル・サマリに分割 |
| `app/routes/wiki/history.tsx` | 598 | 差分ビューを `_components/` へ、履歴取得を `features/pages/*.server.ts` へ |
| `workers/features/sources/google-chat.ts` | 551 | API クライアントとメッセージ整形に分割 |
| `app/features/zip-import/import.server.ts` | 546 | 展開・検証・適用に分割 |
| `app/routes/wiki/search.tsx` | 531 | `loader` を `features/ai-search/*.server.ts` へ、結果表示を `_components/` へ |
| `app/routes/api/pages/access.tsx` | 498 | ACL の読み書きを `features/pages/access.server.ts` へ |
| `app/features/google/drive.server.ts` | 495 | API クライアントとファイル走査に分割 |
| `app/features/google/docs-markdown.server.ts` | 437 | Doc→Markdown 変換をブロック種別ごとに分割 |
| `app/features/agent-api/notes.server.ts` | 428 | 読み取りと書き込み（置換）に分割 |
| `app/features/pages/access.server.ts` | 415 | 解決（誰が何を読めるか）と更新に分割 |
| `app/features/editor/use-collab-editor.ts` | 401 | Yjs 接続・awareness・TipTap 設定に分割 |

### 3. 分割しないもの（allowlist の初期値）

| ファイル | 行 | 理由 |
|---|---|---|
| `workers/features/ingestion/model/ingestion-model-gateway.ts` | 630 | `workers/features/ingestion/` は対象外。`architecture.test.ts` が 10 本以上の制約をこのファイルに掛けており、分割するとその全部を書き換えることになる |
| `workers/agents/wiki-generation-agent.ts` | 409 | Agents SDK のクラス定義。RPC メソッドが 1 クラスに集まる形が SDK の要求であり、分けても読む理由は分かれない |

`file-size.test.ts` の allowlist はこの 2 本だけで始める。
**allowlist は縮小のみ許す**旨をテスト内のコメントに書く。

### 4. `tests/architecture/file-size.test.ts` を新設する

- 対象: `app/**` `workers/**` `shared/**` の `.ts` / `.tsx`
- 除外: `*.test.ts` `*.test.tsx`、`app/locales/**`、生成物
- 上限: 400 行
- allowlist: 3. の 2 本。ファイルパスと現在の行数を書き、
  **allowlist に載っているファイルが上限以下になったら allowlist から外すよう促す**
  （現在の行数より増えていたら失敗させる = 肥大の許容ではなく凍結）

失敗メッセージには「ファイルパス / 現在の行数 / `docs/wiki-refactoring/06-file-splits.md`
の分割原則を参照」を出す。

### 5. `tests/architecture/layering.test.ts` を新設する

Stage 05 で決めた配置ルールを実行可能にする。

- `app/lib/**` は `~/features/` `~/routes/` `~/components/` を import しない
- `app/lib/` 直下のファイル名が許可リストと**完全一致**する
  （`db.server.ts` `utils.ts` `time.ts` `color-utils.ts` `url-extract.ts`
  `queue-processors.server.ts` `chapter-directory.server.ts` `og-image.server.tsx`）
- `app/components/` 直下のファイル名が許可リスト（シェル 10 本）と完全一致し、
  サブディレクトリは `ui/` のみ
- `app/features/**` は `~/routes/` を import しない
- `app/features/**` は `workers/features/*/persistence/` と
  `workers/features/*/orchestration/` を import しない
- `app/routes/**` は `workers/features/*/persistence/` と
  `workers/features/*/orchestration/` を import しない
  （`workers/features/ingestion/README.md` が既に文章で定めている規約の実行可能化）

各アサーションに、**なぜその制約があるか**を 1 行コメントで添える。
理由のない禁止は、都合が悪くなると回避される。

### 6. `ARCHITECTURE.md` / `CLAUDE.md` を仕上げる

- `ARCHITECTURE.md` の「規約を強制しているテスト」節に、
  `file-size.test.ts` `layering.test.ts` `route-urls.test.ts` `test-colocation.test.ts`
  を追記する（Stage 02・04 で作ったものを含めて全部揃う）
- 分割で生まれた新しいモジュール名を Code map に反映する。
  ただし**すべてのファイルを列挙しない**。「どのディレクトリを見るか」まで導ければ十分

### 制約

- **振る舞いを変えない。** 関数の実装・条件分岐・エラーハンドリング・
  エクスポート名を変えない。切って繋ぐだけ。
  「ついでに直す」は禁止。直したいものを見つけたら別の変更として記録し、ここではやらない
- **`workers/features/ingestion/` を分割しない。** 対象外。
  `architecture.test.ts` が守っている構造を壊すリスクに見合わない
- **`.server` / `.client` サフィックスを維持する。** 分割で生まれた新ファイルにも、
  元ファイルが `.server.ts` なら `.server.ts` を付ける。
  Vite の import 境界はファイル名で判定するため、落とすとサーバ専用コードが
  クライアントバンドルに入る
- **ゴールデンテストのスナップショットを更新しない。**
  `tests/golden/tiptap-*.test.tsx` は TipTap↔Markdown 変換とレンダリングを固定している。
  分割で出力が変わったなら、それは**分割ではなく振る舞いの変更**である。
  `test:golden:update` を実行して差分を飲み込んではならない。差分が出たら分割を見直す
- **allowlist を増やさない。** 3. の 2 本以外を allowlist に足すのは、
  「分割できなかった」の言い換えである。分割できないなら理由を allowlist のコメントに書き、
  レビューで判断してもらう
- **1 ファイルずつ分割し、そのつどテストを回す。** 26 本を一度に分割すると、
  どの分割が壊したか切り分けられなくなる
- **スコープ境界。** ディレクトリの移動（Stage 04・05）は完了済み。
  このステージで新しくファイルを別ディレクトリへ移すのは、分割の結果として
  生まれたモジュールを正しい層に置く場合だけ

---

## Files to touch — 変更ファイル

### 分割（24 本 → 各 3〜6 モジュール）

上の Design 2. の 2 つの表のとおり。パスは Stage 04・05 完了後のもの。
主な当たり所:

- `wiki/app/routes/sources/page.tsx`, `wiki/app/routes/wiki/page.tsx`,
  `wiki/app/routes/wiki/history.tsx`, `wiki/app/routes/wiki/search.tsx`,
  `wiki/app/routes/ingest/session.tsx`, `wiki/app/routes/tasks/detail.tsx`,
  `wiki/app/routes/api/cli/sync.ts`, `wiki/app/routes/api/pages/access.tsx`
- `wiki/app/features/pages/components/ShareDialog.tsx`,
  `wiki/app/features/pages/components/PageTree.tsx`,
  `wiki/app/features/pages/access.server.ts`
- `wiki/app/features/sources/sources.server.ts`
- `wiki/app/features/google/drive.server.ts`,
  `wiki/app/features/google/docs-markdown.server.ts`,
  `wiki/app/features/google/documents/import.server.ts`
- `wiki/app/features/agent-api/notes.server.ts`
- `wiki/app/features/editor/use-collab-editor.ts`
- `wiki/app/features/ingestion/components/ChangesetReview.tsx`
- `wiki/app/features/zip-import/import.server.ts`
- `wiki/app/routes/public/_components/LandingContent.tsx`
- `wiki/workers/features/sources/google-chat-import.ts`,
  `wiki/workers/features/sources/discord-import.ts`,
  `wiki/workers/features/sources/google-chat.ts`,
  `wiki/workers/features/sources/import/drive/phases.ts`

### 新規

- `wiki/tests/architecture/file-size.test.ts`
- `wiki/tests/architecture/layering.test.ts`
- 分割で生まれるモジュール（推定 80〜100 ファイル）

### 変更

- 分割元を import していた箇所（分割後の新しいモジュールを指すよう更新）
- `wiki/ARCHITECTURE.md`、`wiki/CLAUDE.md`

---

## Verification — 完了条件と検証

### 完了条件

全体計画の数値目標がここで達成される。

| 指標 | 開始時 | 完了時 |
|---|---|---|
| 400 行超の非テストソース | 27 本 | 2 本（allowlist） |
| 700 行超 | 10 本 | 0 本 |
| 1 ディレクトリ最大ファイル数 | 130 | 25 以下 |
| `app/lib/` 直下 | 98 本 | 8 本 |

加えて、`tests/architecture/` の 4 テスト（`file-size` `layering` `route-urls`
`test-colocation`）がすべて緑で、以後の逸脱を止める。

### コマンド

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
pnpm --filter @gdgjp/wiki test:golden
```

```bash
pnpm --filter @gdgjp/wiki test:e2e
```

400 行超の残数（allowlist の 2 本のみであること）:

```bash
cd wiki && find app workers shared -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.*" | xargs wc -l | awk '$2!="total" && $1>400' | sort -rn
```

エクスポート集合が分割前後で一致すること（**分割の本命の検証**。1 ファイルずつやる）:

```bash
cd wiki && git show HEAD:<分割前のパス> | grep -oE '^export (async function|function|const|type|interface|class) \w+' | sort > /tmp/exp-before.txt && cat <分割後のファイル群> | grep -oE '^export (async function|function|const|type|interface|class) \w+' | sort > /tmp/exp-after.txt && diff /tmp/exp-before.txt /tmp/exp-after.txt
```

### 回帰として固定すべきテスト — 静かに壊れる経路

分割は「動くが正しくない」形の失敗を起こしやすい。型検査で捕まらないものが 5 つある。

- **ゴールデンスナップショットを `-u` で更新して差分を飲み込んだ。**
  `tests/golden/tiptap-convert.golden.test.ts` と `tiptap-renderer.golden.test.tsx` は
  Markdown↔TipTap 変換の出力を固定している。分割でこれが変わったなら振る舞いが変わった証拠。
  **`test:golden:update` を実行してはならない。**
  スナップショットファイルに差分が出ていないことを `git status tests/golden/` で確認する。
  ここを飲み込むと、ページ本文の変換が壊れたまま気づかず本番に出る
- **エクスポートを 1 つ落とした / 名前を変えた。** 落とせば typecheck で捕まるが、
  **`export` を付け忘れて内部関数のままにし、呼び出し側も一緒に消してしまう**経路がある。
  上のエクスポート集合 diff を 1 ファイルずつ実行する
- **React コンポーネントの分割でフックの順序が変わった。**
  `ShareDialog` `PageTree` `ChangesetReview` `useCollabEditor` は
  `useState` / `useEffect` / カスタムフックを多数持つ。条件分岐の中にフックが移ると
  React が実行時に例外を投げるが、**その分岐に入らない限り再現しない**。
  手動 E2E の該当画面で、開いて閉じて再度開く操作を必ず行う
- **`loader` の返す型が変わった。** データ取得を `features/*.server.ts` に移す際に
  返却オブジェクトのキーを 1 つ落としても、`useLoaderData<typeof loader>()` の推論が
  追随するため **typecheck は通り、UI が `undefined` を表示する**。
  分割前後で `loader` の `return` するオブジェクトのキー集合を目視で突き合わせる
- **DO alarm の phase チェーンが切れた。** `google-chat-import.ts` `discord-import.ts`
  `drive/phases.ts` は `SOURCE_IMPORT_DO` の alarm 自己チェーンで進む。
  phase の遷移先を 1 つ落とすと、**取り込みが途中で静かに止まる**（エラーにならない）。
  ユニットテストで各 phase の「次の phase」を明示的に検証する。
  既存の `import/tick.test.ts` `import/drive/phases.test.ts` を拡張する

### 手動 E2E

分割したコンポーネントは「開く／閉じる／再度開く」を必ず通す（フック順序の検証）。

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. `/wiki/<既存ページ>` を開き、本文・TOC・コメント・リアクションを確認する
3. 共有ダイアログを**開いて閉じて再度開く**。ユーザ候補検索、ロール変更、
   一般アクセス変更をそれぞれ 1 回行う（`ShareDialog` 分割）
4. 左サイドバーのページツリーを展開・折りたたみし、ページを 1 つドラッグして並べ替える
   （`PageTree` 分割）
5. `/wiki/<slug>/history` で 2 つのバージョンの差分を表示する
6. `/wiki/<slug>/edit` を 2 タブで開き、片方の編集が反映される（`use-collab-editor` 分割）
7. `/sources` で URL を 1 件追加し、取り込み完了まで待つ。
   Google Chat スペースと Discord チャンネルの取り込みも 1 件ずつ実行し、
   **完了ステータスになるまで放置して確認する**（DO alarm の phase チェーン）
8. `/ingest` からセッションを開始し、変更セットレビュー画面を開いて操作する
   （`ChangesetReview` 分割）
9. `/search` で検索する
10. `/tasks/<slug>` でタスクを作成・編集する
11. `/`（ランディング）を未サインインで開き、全セクションが表示される（`LandingContent` 分割）
