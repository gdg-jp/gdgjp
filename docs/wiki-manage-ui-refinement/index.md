# wiki 管理画面 UI 改善 — 全体計画

`wiki.gdgs.jp`（`wiki/`）の管理画面（`/admin/*`）の作り直し計画。
この overview は delegate 対象ではない。実装単位は `01`〜`03` のステージファイル。

---

## Context — 背景とリポジトリ状況

### なぜやるか

`wiki/app/routes/admin/` の管理画面には、ユーザーから報告された 5 つの実害がある。
すべてコードで原因を特定済み。

| 症状 | 原因（実測） |
|---|---|
| ナビゲーションが遅い | ① `app/routes.ts:80` の `route("admin", ...)` が `layout("routes/_app.tsx", ...)` の**外側**の兄弟ルート。通常画面 ↔ 管理画面でアプリシェル（Navbar + Sidebar）が丸ごと再マウントされ、`_app.tsx` の `shouldRevalidate` によるページツリーキャッシュも破棄される<br>② 通常サイドバーの管理リンクが `/admin`（`app/components/Sidebar.tsx:177`）で、`admin/index.tsx` のサーバ側 `redirect("/admin/pages")` を毎回 1 往復踏む<br>③ `/admin/pages` の loader が `getWikiCanonicalSlugPaths` を呼び、`BATCH_CHUNK_SIZE = 50` の**直列**再帰 CTE を `ceil(N/50)` 回投げている（`app/features/pages/wiki-page-path.server.ts:29`） |
| サイドバーが一般アプリと別物 | `admin/layout.tsx` が `BaseSidebar` を別インスタンス・別 localStorage キー（`gdg-admin-sidebar-open` / `gdg-admin-sidebar-width`）で持つため、幅と開閉が通常サイドバーと同期せず、移動時に差し替わって幅が飛ぶ |
| ページ一覧が階層化されていない | `updatedAt desc` のフラット表。親子関係は生成された URL の中にしか現れない |
| 統計ページが不要 | `/admin/stats` の参照元は `routes.ts` と管理ナビの 2 か所だけ |
| タグ管理の UI が変 | 新規作成が表の上に常設されたインラインフォーム。編集は `form=` 属性でセルをまたぐ行内編集ハック（`admin/tags.tsx:227-297`） |

### ゴールと非ゴール

**ゴール**: 管理画面を通常アプリのシェルに統合して体感速度を上げ、ページ一覧をツリー化し、
統計ページを削除し、タグ管理をダイアログ + 素直な表に作り直す。

**非ゴール**:
- 通常アプリ側（`_app.tsx` 配下の非 admin ルート）の UI 変更
- 他ワークスペース（`tinyurl/` 等）への波及
- 認可モデルの変更。`requireAdmin` の契約は不変
- URL の変更。`/admin/stats` の削除以外、URL 集合は 1 つも変わらない

### 対象範囲

`wiki/` ワークスペースのみ。

### 決定事項（ユーザー確認済み・再検討不要）

| 論点 | 決定 |
|---|---|
| サイドバー | 通常アプリの `Sidebar` に統合する（`/admin` を `_app.tsx` の子ルートへ移す） |
| ページ一覧 | 折りたたみ可能なツリー表。デフォルト全展開 |
| タグ | 新規作成・編集とも同一ダイアログ。行内編集は全廃 |
| 統計 | ルート・ファイル・ナビ・i18n キーごと全部削除。翻訳キュー指標も残さない |

### ステージ構成と依存関係

```
01 (シェル統合 + 統計削除)
      ├─→ 02 (ページ一覧ツリー化)
      └─→ 03 (タグ管理の作り直し)
```

- `01` が先。`02` と `03` は `01` 完了後なら**並行可**。
- ただし `02` と `03` はどちらも `app/locales/{ja,en}/common.json` に追記する。
  並行実行する場合は最後にマージ衝突を確認すること。
- `01` は `app/routes.ts` と `admin/layout.tsx` を書き換える。`02`/`03` はこの 2 ファイルを触らない。

| ステージ | ファイル | 内容 |
|---|---|---|
| 01 | `01-shell-integration.md` | 管理画面をアプリシェルへ統合、統計ページ削除、ナビゲーション進捗バー |
| 02 | `02-page-tree.md` | `/admin/pages` の loader 単一クエリ化とツリー表 |
| 03 | `03-tag-dialog.md` | `/admin/tags` のダイアログ化と表の作り直し |

### 読むべきもの（全ステージ共通）

- `wiki/CLAUDE.md` — バインディング、auth（RP）、Drizzle、i18n、E2E の前提
- `wiki/ARCHITECTURE.md` — コードマップ。「X はどこ」の正本
- `wiki/DESIGN.md` — デザイントークン方針
- `docs/wiki-refactoring/index.md` — 現在のディレクトリ構成がなぜこの形かの背景

### リポジトリ固有の安全網（全ステージ共通の制約）

`wiki/tests/architecture/` の各テストが、この計画の主な安全網になる。

- `file-size.test.ts` — 非テストソースは **400 行以下**。`ALLOWLIST` への追加は禁止（shrink-only）
- `design-token-policy.test.ts` — `app/components/`・`app/routes/`・`features/*/components/` で
  Tailwind デフォルト色と色リテラル（`#rrggbb` 等）は禁止。動的色はその行に
  `// design-token-policy: allow-dynamic-color` を付ける（既存例: `app/routes/admin/tags.tsx:154`）。
  セマンティックトークン（`surface-*` / `content-*` / `border-*` / `action-*` / `feedback-*`）を使う
- `route-urls.test.ts` — `app/routes.ts` が公開する URL 集合のスナップショット
- `test-colocation.test.ts` — ユニットテストは被験対象の隣に `<subject>.test.ts`
- `layering.test.ts` — 層をまたぐ import の禁止規則

ルート付属コンポーネントは `app/routes/<area>/_components/` に置く既存慣例に従う
（例: `app/routes/wiki/_components/SearchView.tsx`）。

### 再利用する既存実装 — 書き直さないこと

- `app/features/pages/tree.ts` の `buildTree(rows)` / `flattenTree(nodes)` — フラット行 → ツリー変換。
  孤児（親が存在しない）はルート扱いになる既存挙動をそのまま使う
- `app/features/pages/wiki-page-path.ts` の `wikiPagePath(segments)` — スラッグ配列 → `/wiki/a/b/c`
- `app/components/Sidebar.tsx:16` の `NavItem` — `prefetch="intent"` 済みのナビリンク
- `app/components/BaseSidebar.tsx` — 通常サイドバーが使い続ける。**変更しない**
- `app/components/ui/dialog.tsx` — Radix ベースの既存ダイアログ
- `app/features/auth/utils.server.ts:101` の `requireAdmin(request, env)`
- `app/features/pages/archive.server.ts` の `archivePageAndDescendants`

### 前提として確認済みの事実（再調査不要）

- `layout()` は URL セグメントを持たない。`admin` ブロックを `layout("routes/_app.tsx", [...])` の中へ
  移しても **URL は 1 つも変わらない**
- `app/routes.ts` の catch-all `route("*", ...)` は `layout()` ブロックより前に書かれているが、
  React Router v7 は記述順ではなく specificity でランク付けするため影響しない（現に `/wiki/*` が動いている）
- 管理画面を参照している E2E テストは存在しない（`tests/e2e/` に `/admin` の記述なし）
- `app/routes/admin/pages.test.ts` は loader / action のユニットテスト。`02` で更新が要る
- `admin.tags.error_slug_taken` / `error_slug_invalid` の i18n キーは
  `app/locales/{ja,en}/common.json` に**既に存在するが未使用**（action がハードコード英語を返している）

---

## 実行の進め方

1. `01-shell-integration.md` を実行する
2. `02-page-tree.md` と `03-tag-dialog.md` を実行する（並行可）
3. 各ステージファイルの抽出を事前に検証する:

```bash
node .claude/skills/plan-creator/scripts/check-extraction.mjs docs/wiki-manage-ui-refinement/0*.md
```

4 節すべて `OK` になってから delegate する。`index.md` は delegate 対象外なので
`MISSING` が出て正常。

## 全ステージ完了後の統合確認

```bash
pnpm --filter @gdgjp/wiki test && pnpm --filter @gdgjp/wiki typecheck && pnpm lint
```

手動（`pnpm --filter @gdgjp/wiki dev`、:5177、admin ユーザーでサインイン）:

1. 通常ページ → サイドバー「管理」→ サイドバーの幅と開閉が変わらず、ページツリーも消えない
2. リダイレクトを踏まず `/admin/pages` に直行する
3. `/admin/pages` で親子ページがネストし、トグルで折りたためる
4. `/admin/pages` ↔ `/admin/tags` の往復でシェルの loader リクエストが飛ばない（DevTools Network）
5. `/admin/stats` が 404
6. タグの新規作成・編集・削除がダイアログで完結し、重複スラッグエラーが日本語で出る
7. 幅 767px 以下でモバイルドロワー（`Sheet`）と管理画面の表が破綻しない
8. 非管理者では `/admin/pages` に入れない（403）
