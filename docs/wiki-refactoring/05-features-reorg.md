# Stage 05 features-reorg — app/lib の解体と feature 単位への再編

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-refactoring/index.md`。**着手前に必ず読むこと。**
このステージは Stage 04（`04-routes-tree.md`）の完了後に実行する。

`wiki/app/lib/` は 98 ファイルがフラットに並んでいる。名前からドメインが読めず、
1 つの機能を追うのに `app/lib/` `app/features/` `workers/features/` `shared/` の
4 箇所を確認する必要がある。「Google Drive 連携はどこ」の答えが
`app/lib/google-drive.server.ts` と `app/lib/google-drive-token.server.ts` と
`app/lib/google-drive-utils.ts` と `workers/features/ingestion/tools/google-drive.ts` に散っている。

このステージでドメインを持つコードをすべて `app/features/<domain>/` に集約し、
`app/lib/` を横断プリミティブ 8 本だけにする。
UI コンポーネントも同じ原則で feature 配下へ移す。

**このステージが全体計画で最もリスクが高い。** import 書き換えが 408 箇所 / 162 ファイルに及ぶ。

### 対象範囲

`wiki/app/lib/` `wiki/app/components/` `wiki/app/features/` `wiki/app/hooks/`。
`app/routes/` は Stage 04 で整理済みなので、import パスの追随だけ。
`workers/` は移動しない（`workers/features/ingestion/` は既に正しい構造）。

### 読むべきもの

- `docs/wiki-refactoring/index.md` — 全体計画。配置ルール 1〜3 が根拠
- `wiki/ARCHITECTURE.md` — Stage 01〜04 で育てたコードマップ
- `wiki/workers/features/ingestion/README.md` — feature 分割の手本
- `wiki/CLAUDE.md` の「App conventions」節 — `~/*` → `./app/*` と
  `.server.ts` の import 境界

### 再利用する既存実装 — 書き直さないこと

- **移動するモジュールの中身。** 関数のロジック・シグネチャ・エクスポート名を 1 つも変えない。
  変えてよいのは import パスだけ。**ファイルの分割は Stage 06 の担当**
- 既存の `app/features/` 5 ディレクトリ（`ai/` `ai-search/` `ingestion/` `translation/`
  `zip-import/`）。中身はそのまま。`google-documents/` だけ `google/documents/` へ移す
- `app/lib/db.server.ts` の `getDb(env)` — fan-in 91。**移動しない**
- `app/components/ui/` の 10 プリミティブ — 移動しない

### 前提として確認済みの事実（再調査不要）

- `~/lib/*` の import 箇所は 408、それを含むファイルは 162
- `app/lib/` 内の相対 import（`from "./x"`）は 44 箇所
- `~/components/` `~/features/` `~/hooks/` の import 箇所は合計 152
- fan-in 上位: `db.server` 91、`auth-utils.server` 76、`sources.server` 25、
  `page-access.server` 25、`google-drive.server` 14

---

## Design — 設計

### 1. `app/lib/` に残す 8 本

どのドメインにも属さない横断プリミティブだけを残す。

| ファイル | 理由 |
|---|---|
| `db.server.ts` | Drizzle インスタンス。全ドメインの基盤。fan-in 91 |
| `utils.ts` | `cn()` 等の汎用ヘルパ |
| `time.ts` | 日時整形 |
| `color-utils.ts` | 色計算。テーマとタグ色の両方で使う |
| `url-extract.ts` | 文字列から URL を抽出する純関数 |
| `queue-processors.server.ts` | キューメッセージの振り分けディスパッチャ。特定ドメインに属さない |
| `chapter-directory.server.ts` | チャプター一覧。auth・sources・pages の全部から参照される |
| `og-image.server.tsx` | Browser Rendering による画像生成。レンダリング基盤 |

**以降 `app/lib/` に新規ファイルを足さない。** Stage 06 の `layering.test.ts` が
このファイル名リストを許可リストとして固定する。

### 2. `app/lib/` からの移動表

| 移動先 | 現在のファイル（`app/lib/` 配下） |
|---|---|
| `features/auth/` | `auth.server.ts` `auth-utils.server.ts` `auth-redirect.ts` + それぞれのテスト |
| `features/pages/` | `page-access.server.ts` `page-archive.server.ts` `page-meta.ts` `page-tree.ts` `page-visibility.server.ts` `wiki-page-path.ts` `wiki-page-path.server.ts` `wiki-catalog.server.ts` `content-backfill.server.ts` `acl-spans.ts` `acl-spans.server.ts` `d1-chunk.server.ts` + テスト |
| `features/sources/` | `sources.server.ts` `sources-shared.ts` + テスト 5 本 |
| `features/google/` | `google-drive.server.ts` `google-drive-token.server.ts` `google-drive-utils.ts` `google-docs-markdown.server.ts` `google-forms.server.ts` `google-forms-utils.ts` `google-picker.client.ts` `google-chat.server.ts` `survey-stats.server.ts` + テスト |
| `features/discord/` | `discord-api.server.ts` `discord-oauth.server.ts` `discord-token.server.ts` `discord-reminders.server.ts` + テスト |
| `features/notifications/` | `notify.server.ts` `email.server.ts` `fcm.server.ts` `firebase-config-context.ts` `firebase-messaging.client.ts` |
| `features/editor/` | `tiptap-convert.ts` `remote-cursors-extension.ts` `remote-cursors-store.ts` `content-format.ts` + テスト |
| `features/agent-api/` | `agent-notes.server.ts` `agent-workspace.server.ts` `agents-md.server.ts` `cli-wiki-human.server.ts` `cli-wiki-raw-content.server.ts` `cli-wiki-source-path.server.ts` + テスト |

feature 内でのファイル名は、ドメイン名の重複を落として短くする。
`features/google/google-drive.server.ts` ではなく `features/google/drive.server.ts`。
`features/discord/discord-api.server.ts` ではなく `features/discord/api.server.ts`。
`features/pages/page-access.server.ts` ではなく `features/pages/access.server.ts`。
**`.server` サフィックスは必ず維持する**（Vite の import 境界がファイル名で判定するため）。

### 3. `app/components/` からの移動表

| 移動先 | コンポーネント |
|---|---|
| `app/components/`（残留） | `Navbar` `Footer` `Sidebar` `BaseSidebar` `SidebarDialog` `SidebarPopover` `Toast` `Tooltip` `ConfirmDialog` `Skeleton` |
| `app/components/ui/`（残留） | 10 プリミティブ。変更なし |
| `features/pages/components/` | `PageTree` `PageEditor` `ShareDialog` `WikiRightSidebar` `CommentEditor` `CommentItem` `CommentSection` `EmojiReactionBar` `TagChip` `ArchivedContent` `RecentContent` `StarredContent` |
| `features/editor/components/` | `TipTapEditor` `TipTapRenderer` + そのテスト 2 本 `PresenceAvatars` |
| `features/notifications/components/` | `NotificationBell` `PushNotificationToggle` |
| `features/google/components/` | `GoogleDocumentImportDialog` |
| `features/zip-import/components/` | `ZipImportDialog` |
| `features/sources/components/` | `app/components/sources/` の 6 本をそのまま |
| `features/tasks/components/` | `app/components/tasks/` の 16 本をそのまま |
| `features/ingestion/components/` | `app/components/ingest/` の 4 本をそのまま |
| `app/routes/public/_components/` | `LandingContent` |

`features/tasks/` はこのステージで新設される。`app/components/tasks/` の
`task-options.ts` `task-utils.ts` `useAnchoredMenu.ts` は `components/` ではなく
`features/tasks/` 直下に置く（UI ではないため）。

### 4. その他の移動

- `app/hooks/useCollabEditor.ts` → `features/editor/use-collab-editor.ts`
  （401 行。Stage 06 の分割対象でもある）
- `app/hooks/useMediaQuery.ts` `app/hooks/useThemeMode.ts` は `app/hooks/` に残す（汎用 UI フック）
- `app/features/google-documents/` → `app/features/google/documents/`
- `app/routes/api/cli/_sync-helpers.ts` → `features/agent-api/cli-sync-helpers.ts`
  （Stage 04 で routes 配下に残したもの）

### 5. import の書き換え

`~/*` は `tsconfig.json` の `paths` で `./app/*` に解決される。
移動後、次の 4 系統を書き換える。

1. `~/lib/<name>` → `~/features/<domain>/<new-name>`
2. `~/components/<Name>` → `~/features/<domain>/components/<Name>`
3. `app/lib/` 内の相対 import（44 箇所）→ 移動先での相対 or `~/` 絶対
4. `app/routes/` からの相対 import（Stage 04 で 1 段深くなっている）

**旧パス → 新パスの対応表を 1 つのファイルに書き出してから、機械的に置換する。**
手作業で 1 箇所ずつ直すと必ず漏れる。置換後に「旧パスが 1 つも残っていない」ことを
grep で確認する（Verification 参照）。

### 6. feature README を書く

Stage 01 で作った 7 個に加え、新設する 8 feature
（`auth` `pages` `sources` `google` `discord` `notifications` `editor` `agent-api` `tasks`）
にも 5〜10 行の `README.md` を置く。書く内容は Stage 01 と同じ 3 点
（担当・入口ファイル・注意）。長い散文は書かない。

### 7. `ARCHITECTURE.md` / `CLAUDE.md` を全面更新する

Code map を新しい構成に完全に書き換える。**このステージ以降、Code map が実態と一致する。**
`CLAUDE.md` の他の節にも `app/lib/` を指す記述が複数ある。すべて追随させる。

- 「Bindings」表の `getDb(env)` in `app/lib/db.server.ts` — 変更なし（残留するため）
- 「Auth — RP」節の `app/lib/auth.server.ts` → `app/features/auth/auth.server.ts`
- 「Wiki generation」節の `app/features/ai-search/` — 変更なし
- 「Realtime collab editor」節の `tiptap-convert.ts` `remote-cursors-extension.ts`
  → `app/features/editor/`
- 「App conventions」節の `queue-processors.server.ts` — 変更なし（残留するため）

### 制約

- **モジュールの中身を書き換えない。** 関数の実装・シグネチャ・エクスポート名は不変。
  ファイル分割は Stage 06。ここで分割を始めると、移動と分割の差分が混ざってレビュー不能になる
- **`.server` / `.client` サフィックスを必ず維持する。** Vite の import 境界はファイル名で判定する。
  `google-drive.server.ts` → `drive.server.ts` はよいが、`drive.ts` にしてはならない。
  落とすとサーバ専用コード（D1 クライアント、OAuth シークレット）がクライアントバンドルに入る
- **`git mv` で移動し、import 書き換えは別コミットにする。** move と edit を分けると
  `git log --follow` と bisect が成立する
- **`app/lib/db.server.ts` を移動しない。** fan-in 91。移動の利得より破壊リスクが大きい
- **`workers/` 配下を移動しない。** `workers/features/ingestion/` は既に正しい構造であり、
  `architecture.test.ts` が層境界を守っている。触ると安全装置を壊す
- **既存 architecture テストの `expect` を減らさない。**
  `workers/features/ingestion/architecture.test.ts` は
  `../../../app/features/ai/model/index.server.ts` を読む。このパスは変わらないが、
  他のパスが変わる場合は**制約を弱めずにパスだけ**直す
- **`design-token-policy.test.ts` / `theme-tokens.test.ts` の走査ルートを追随させる。**
  Stage 02 で `tests/architecture/` に移っている。コンポーネントが `app/features/*/components/`
  へ移るため、走査対象に `app/features/` を含める必要がある。
  **含め忘れると走査対象が減り、テストは緑のまま検査が空洞化する**
- **スコープ境界。** ファイル分割（Stage 06）、ルート再編（Stage 04、完了済み）、
  `workers/` の再編（対象外）には手を出さない

---

## Files to touch — 変更ファイル

### 移動（`git mv`）

- `wiki/app/lib/` の 90 本（8 本を残す）→ `wiki/app/features/<domain>/`（上の 2. の表）
- `wiki/app/components/` の 23 本 + `sources/`(6) `tasks/`(16) `ingest/`(4)
  → `wiki/app/features/<domain>/components/`（上の 3. の表）
- `wiki/app/hooks/useCollabEditor.ts` → `wiki/app/features/editor/use-collab-editor.ts`
- `wiki/app/features/google-documents/` → `wiki/app/features/google/documents/`
- `wiki/app/routes/api/cli/_sync-helpers.ts` → `wiki/app/features/agent-api/cli-sync-helpers.ts`

### 新規

- `wiki/app/features/{auth,pages,sources,google,discord,notifications,editor,agent-api,tasks}/README.md`

### 変更

- import 408 + 152 箇所 / 約 162 ファイル（`app/routes/` `app/features/` `workers/` `tests/` に分布）
- `wiki/tests/architecture/design-token-policy.test.ts`、`theme-tokens.test.ts` — 走査ルート
- `wiki/ARCHITECTURE.md` — Code map の全面更新
- `wiki/CLAUDE.md` — Code map と、Auth / Realtime collab editor 節のパス

---

## Verification — 完了条件と検証

### 完了条件

- `app/lib/` 直下が 8 ファイル
- `app/components/` 直下が 10 ファイル + `ui/`
- `app/features/` に 14 ディレクトリがあり、すべてに `README.md` がある
- **旧パス（`~/lib/<移動したもの>`、`~/components/<移動したもの>`）の参照が 0 件**
- `ARCHITECTURE.md` の Code map が実態と一致する

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

`~/lib/` の残骸確認（残ってよいのは 8 本のみ）:

```bash
cd wiki && grep -rho '~/lib/[a-zA-Z0-9.-]*' app workers shared tests --include="*.ts" --include="*.tsx" | sort -u
```

`.server` サフィックスが落ちていないことの確認（**移動前に left、移動後に right を取る**）:

```bash
cd wiki && git show HEAD:/dev/null 2>/dev/null; git ls-tree -r HEAD --name-only | grep -E '\.(server|client)\.tsx?$' | xargs -n1 basename | sort > /tmp/server-before.txt && find app workers shared -name '*.server.ts' -o -name '*.server.tsx' -o -name '*.client.ts' | xargs -n1 basename | sort > /tmp/server-after.txt && diff /tmp/server-before.txt /tmp/server-after.txt
```

差分が出るのは意図的に改名したファイルだけであること（`google-drive.server.ts` →
`drive.server.ts` など）。**`.server` が消えて `.ts` になったものが 1 つもないこと**を目視で確認する。

ディレクトリごとのファイル数:

```bash
cd wiki && for d in app/lib app/components app/features/*; do echo "$(ls "$d" | wc -l | tr -d ' ') $d"; done | sort -rn
```

### 回帰として固定すべきテスト — 静かに壊れる経路

このステージで壊れて CI が緑のまま通る経路は 5 つ。すべて明示的に潰す。

- **`.server` サフィックスを落とした。** `pnpm build` は通ることがある
  （そのモジュールがたまたまクライアントから参照されていない場合）。しかし後日
  クライアントから import された瞬間に、**D1 クライアントと OAuth シークレットが
  クライアントバンドルに入る**。上の `server-before/after` 比較を省略しないこと
- **`design-token-policy.test.ts` の走査対象が空になった。**
  コンポーネントが `app/components/` から `app/features/*/components/` へ移るのに、
  テストの走査ルートが `app/components/` のままだと、**検査対象 0 ファイルで緑になる**。
  移動後に、わざと `bg-blue-500` を書いた一時ファイルを `app/features/pages/components/` に置き、
  テストが赤くなることを 1 回確認してから消す。**この確認を飛ばすと、デザイントークン規約が
  以後まったく機能しなくなる**
- **キューメッセージのガードが欠けた。** `queue-processors.server.ts` は `app/lib/` に残るが、
  そこから呼ぶ翻訳・Google Docs インポート・`source_fetch` の各ハンドラは feature 配下へ移る。
  discriminator が 1 つでも壊れると、Worker は未知メッセージを `ack()` で**黙って捨てる**。
  `queue-processors.server.test.ts` を移動先で走らせ続け、3 系統すべてのケースが
  残っていることを `grep -c "it(" ` で確認する
- **cron ハンドラの分岐が壊れた。** `workers/app.ts` の `scheduled` は
  `TASK_REMINDER_CRON` / `SOURCE_REFRESH_CRON` で分岐し、それぞれ
  `discord-reminders.server.ts`（→ `features/discord/`）と
  ソースリフレッシュ（→ `features/sources/`）を呼ぶ。**cron は本番でしか動かないため
  CI では絶対に気づかない**。両分岐を呼び出すユニットテストを
  `workers/app.scheduled.test.ts` として新設する
- **`.client.ts` の動的 import が壊れた。** `firebase-messaging.client.ts` と
  `google-picker.client.ts` は動的 import される可能性がある。動的 import のパス文字列は
  typecheck に出ない。`grep -rn "import(" app --include="*.ts" --include="*.tsx"` で
  動的 import を全部洗い、パスを目視で確認する

### 手動 E2E

全ドメインを 1 回ずつ通す。Stage 04 の手順に加え、feature 分割で壊れやすい経路を足す。

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. `/signin` からサインイン（`features/auth/`）
3. `/wiki/<既存ページ>` が本文・TOC・コメント・リアクション付きで表示される
   （`features/pages/` + `features/editor/`）
4. そのページで共有ダイアログを開き、ユーザ候補検索と一般アクセス変更が動く
   （`features/pages/components/ShareDialog`）
5. `/wiki/<slug>/edit` を 2 つのブラウザタブで開き、片方の編集がもう片方に反映される
   （`features/editor/use-collab-editor.ts` + `COLLAB_DO`）
6. `/sources` で URL を 1 件追加し、取り込みが完了して一覧に反映される（`features/sources/`）
7. Google Drive 連携ボタンから OAuth に飛び、戻ってこられる（`features/google/`）
8. `/ingest` からセッションを開始し、`/ingest/:sessionId` がリアルタイム更新される
9. `/search` が結果を返す（`features/ai-search/`）
10. `/tasks/<slug>` でタスクを 1 件作成・編集できる（`features/tasks/`）
11. `/settings` で通知設定が表示される（`features/notifications/`）
