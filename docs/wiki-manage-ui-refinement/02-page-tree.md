# Stage 02 page-tree — ページ一覧を単一クエリのツリー表にする

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-manage-ui-refinement/index.md`。**着手前に必ず読むこと。**
このステージは Stage 01（`01-shell-integration.md`）の完了後に実行する。
Stage 03（`03-tag-dialog.md`）とは並行して構わない。

`/admin/pages`（`wiki/app/routes/admin/pages.tsx`）には 2 つの問題がある。

**① 階層化されていない。** loader は `updatedAt desc` でフラットに全ページを引く。
wiki のページは `pages.parent_id` で親子構造を持つが、その構造は表に現れず、
生成された `/wiki/a/b/c` という URL の中にしか存在しない。
どのページがどの配下にあるかが管理画面から読めない。

**② loader が遅い。** リンク先の正規パスを作るために `getWikiCanonicalSlugPaths` を呼んでいるが、
これは `BATCH_CHUNK_SIZE = 50` で分割した再帰 CTE を `await` で**直列**に投げる実装
（`wiki/app/features/pages/wiki-page-path.server.ts:29`）。
ページ数 N に対して `1 + ceil(N/50)` 回の D1 往復が発生し、ページが増えるほど線形に遅くなる。
ユーザーの「ナビゲーションが遅い」という指摘の一因。

両方は同じ変更で解ける。**全ページを引くなら祖先も必ず結果に含まれる**ので、
`parent_id` を select してクライアント側でツリーを組めば、パスはツリーから導出でき、
再帰 CTE は 1 回も要らなくなる。D1 クエリは 1 本になる。

### 対象範囲

`wiki/` ワークスペースのみ。`/admin/pages` とその付属コンポーネントだけを扱う。

`app/routes.ts` と `app/routes/admin/layout.tsx` は Stage 01 の担当なので**触らない**。
`/admin/tags` は Stage 03 の担当なので触らない。

### 読むべきもの

- `docs/wiki-manage-ui-refinement/index.md` — 全体計画。共通の制約と再利用対象
- `wiki/app/routes/admin/pages.tsx` — 現行実装（266 行）。loader / action / バッジ / 表
- `wiki/app/routes/admin/pages.test.ts` — 既存ユニットテスト（191 行）。このステージで更新する
- `wiki/app/features/pages/tree.ts` — `buildTree` / `flattenTree` の既存実装
- `wiki/app/features/pages/wiki-page-path.ts` — `wikiPagePath(segments)`
- `wiki/app/features/pages/components/PageTree/row.tsx` — 通常アプリのツリー行。見た目の参考

### 再利用する既存実装 — 書き直さないこと

- `wiki/app/features/pages/tree.ts` の **`buildTree(rows)`** — `{id, slug, titleJa, titleEn,
  parentId, pageType?, sortOrder}` の配列を受け取り `PageNode[]` を返す。
  親が結果に存在しない孤児はルート扱いになる（現行 loader の `?? [p.slug]` フォールバックと同じ挙動）。
  **ツリー構築ロジックを書き直さない**
- `wiki/app/features/pages/tree.ts` の `flattenTree(nodes)` — `depth` 付きのフラット配列を返す。
  そのまま使えるなら使う
- `wiki/app/features/pages/wiki-page-path.ts` の **`wikiPagePath(segments)`** — スラッグ配列 →
  `/wiki/a/b/c`。パス組み立てを自前で書かない
- `wiki/app/features/pages/archive.server.ts` の `archivePageAndDescendants`
- `wiki/app/features/ai-search/embedding.server.ts` の `deletePageEmbeddings`
- 現行 `pages.tsx` の `StatusBadge`（`:105`）/ `VisibilityBadge`（`:126`）とアクション群
  （`:184-252`）— **ロジックはそのまま移植する**。作り直さない

### 前提として確認済みの事実（再調査不要）

- `wiki/app/features/pages/wiki-page-path.server.ts` の `getWikiCanonicalSlugPaths` は
  他所からも使われているので**関数自体は残す**。このステージで消すのは `pages.tsx` からの呼び出しだけ
- 現行 loader は全ステータス（`published` / `archived` 等）のページを引いている。この挙動は維持する
- 編集リンクは `/wiki/${p.slug}/edit`（**正規パスではなく素のスラッグ**）。
  ルート定義が `route("/wiki/:slug/edit", ...)` なのでこれが正しい。`wikiPath` に変えないこと
- `wiki/app/routes/wiki/_components/SearchView.tsx` があるとおり、
  ルート付属コンポーネントを `app/routes/<area>/_components/` に置く慣例が既にある
- `pages.test.ts` は `getWikiCanonicalSlugPaths` を `vi.mock` している（`:15-21`）。
  呼び出しをやめるのでこのモックは不要になる

---

## Design — 設計

### 1. loader を単一クエリにする（`app/routes/admin/pages.tsx`）

`getWikiCanonicalSlugPaths` の呼び出しと import を**削除**し、代わりに `parentId` と
`sortOrder` を select する。

```ts
const rows = await db
  .select({
    id: schema.pages.id,
    slug: schema.pages.slug,
    titleJa: schema.pages.titleJa,
    titleEn: schema.pages.titleEn,
    status: schema.pages.status,
    visibility: schema.pages.visibility,
    authorId: schema.pages.authorId,
    authorName: schema.user.name,
    createdAt: schema.pages.createdAt,
    updatedAt: schema.pages.updatedAt,
    parentId: schema.pages.parentId,
    sortOrder: schema.pages.sortOrder,
  })
  .from(schema.pages)
  .leftJoin(schema.user, eq(schema.pages.authorId, schema.user.id))
  .orderBy(schema.pages.sortOrder)
  .all();
```

並び順を `desc(updatedAt)` から `sortOrder` に変える。ツリー表示では兄弟の並びが
通常アプリのページツリーと一致しているべきで、更新日順に混ざると階層が読みにくい。
更新日は列として表示され続ける。

D1 往復は **1 回**（現状 `1 + ceil(N/50)` 回）。

### 2. ツリー構築とパス導出を純関数に切り出す（新規）

loader とコンポーネントの両方から使うので、`app/routes/admin/_components/admin-page-tree.ts` に
純関数として置き、テストを隣に置く（`tests/architecture/test-colocation.test.ts` の規約）。

- 入力: 上記 `rows`（`AdminPageRow[]`）
- `buildTree`（`~/features/pages/tree`）でツリーを組む
- ルートから深さ優先で辿りながら、祖先のスラッグを積んで
  `wikiPagePath([...ancestorSlugs, slug])` を各行に付ける
- 出力: `depth` / `wikiPath` / `childCount` を持つフラット配列。
  1 行 = 1 ページで、親の直後に子が並ぶ順序であること
- 型は 1 か所で定義してエクスポートし、loader・コンポーネント・テストで共有する

孤児（親 ID が存在しない）は `buildTree` の既存挙動でルート扱いになり、
`wikiPath` は `/wiki/<slug>` になる。現行のフォールバックと同じなので特別扱いを書かない。

### 3. ツリー表（新規 `app/routes/admin/_components/PageTreeTable.tsx`）

現行の `<table className="w-full text-sm">` を土台にし、階層表現を足す。

- 1 行 = 1 ページ。タイトルセルの中身に `style={{ paddingLeft: `${depth * 16}px` }}` でインデント
- 子を持つ行だけ、タイトルの左に開閉トグルボタン（`lucide-react` の `ChevronDown` /
  `ChevronRight`）。子がない行にはトグル幅ぶんのスペーサーを置き、タイトルの左端を揃える
- トグルは `<button type="button">` で、`aria-expanded` と
  `aria-label`（`t("admin.pages.expand")` / `t("admin.pages.collapse")`）を付ける
- 折りたたみ状態は `useState<Set<string>>`（畳んだページ ID の集合）。**デフォルトは全展開**。
  畳まれた祖先を持つ行は描画しない
- 子ページ数を `content-tertiary` の小さなバッジで表示（`t("admin.pages.child_count")`）
- ステータス / 可視性バッジ、編集・アーカイブ・復元・削除は現行実装
  （`pages.tsx:105-134`, `:184-252`）を**そのまま移植**する。`window.confirm` による確認も維持
- 編集リンクは `/wiki/${p.slug}/edit` のまま（**素のスラッグ**）。タイトルのリンク先は `wikiPath`
- 空状態 `t("admin.pages.empty")` も現行どおり表の後ろに残す
- 表全体を `overflow-x: auto` のコンテナに入れ、狭い画面で横スクロールする
  （ページ本体が横スクロールしないこと）

`pages.tsx` は loader / action / デフォルトエクスポート（見出し + `PageTreeTable`）だけに絞る。

### 4. i18n キーの追加

`wiki/app/locales/ja/common.json` と `wiki/app/locales/en/common.json` の `admin.pages` に追加。
両ロケールを必ず揃える。

| キー | ja | en |
|---|---|---|
| `admin.pages.expand` | `展開` | `Expand` |
| `admin.pages.collapse` | `折りたたむ` | `Collapse` |
| `admin.pages.child_count` | `子ページ {{count}} 件` | `{{count}} child pages` |

### 5. `app/routes/admin/pages.test.ts` の更新

- `getWikiCanonicalSlugPaths` の `vi.mock`（`:15-21`）を削除する
- loader のアサーションを新しい戻り値（`depth` / `wikiPath` / `childCount` 付きのフラット配列）に
  合わせる。特に **`wikiPath` が祖先を連結した `/wiki/a/b` になっている**ことを、
  親子関係を持つ fixture で確認する
- action 側のテスト（archive / restore / delete）は**変更しない**

`admin-page-tree.ts` のユニットテスト（`admin-page-tree.test.ts`）で最低限カバーする:

- 親子 2 階層で `depth` と `wikiPath` が正しい
- 孤児（親 ID が結果に存在しない）がルート扱いになり `wikiPath` が `/wiki/<slug>` になる
- `childCount` が直下の子の数である
- 兄弟が `sortOrder` の順に並ぶ

### 制約

- **`getWikiCanonicalSlugPaths` 関数自体を削除しない。** 他所から使われている。
  消すのは `pages.tsx` からの呼び出しと import だけ
- **編集リンクを `wikiPath` に変えない。** ルートは `/wiki/:slug/edit` で素のスラッグを取る
- **action（archive / restore / delete）の挙動を変えない。** このステージは表示側の変更
- **全ステータスを引き続き表示する。** archived ページを一覧から落とさない
- **`app/routes.ts` と `app/routes/admin/layout.tsx` を触らない。** Stage 01 の担当
- **`app/routes/admin/tags.tsx` を触らない。** Stage 03 の担当
- **非テストソースは 400 行以下**（`tests/architecture/file-size.test.ts`）。`ALLOWLIST` 追加は禁止
- **デザイントークンを使う**（`tests/architecture/design-token-policy.test.ts`）。
  Tailwind デフォルト色と色リテラルは禁止

---

## Files to touch — 変更ファイル

### `wiki/`

- `app/routes/admin/pages.tsx` — loader を単一クエリ化、UI を `PageTreeTable` へ委譲
- `app/routes/admin/pages.test.ts` — `getWikiCanonicalSlugPaths` モック削除、loader 期待値更新
- `app/routes/admin/_components/admin-page-tree.ts` — **新規**（ツリー構築 + パス導出の純関数）
- `app/routes/admin/_components/admin-page-tree.test.ts` — **新規**
- `app/routes/admin/_components/PageTreeTable.tsx` — **新規**
- `app/locales/ja/common.json` — `admin.pages.expand` / `collapse` / `child_count` を追加
- `app/locales/en/common.json` — 同上

**触らないファイル**: `app/routes.ts`、`app/routes/admin/layout.tsx`、
`app/routes/admin/tags.tsx`、`app/features/pages/tree.ts`、
`app/features/pages/wiki-page-path.server.ts`

---

## Verification — 完了条件と検証

### 完了条件

1. `/admin/pages` で親子ページがネストして表示され、トグルで折りたためる（初期状態は全展開）
2. タイトルのリンク先が祖先を含む正しい `/wiki/a/b/c` になっている
3. loader の D1 クエリが **1 本**（`getWikiCanonicalSlugPaths` を呼ばない）
4. アーカイブ・復元・削除・編集リンクが従来どおり動く
5. archived ページも一覧に出て、ステータスバッジで区別できる

### コマンド

```bash
pnpm --filter @gdgjp/wiki exec vitest run app/routes/admin
```

```bash
pnpm --filter @gdgjp/wiki test && pnpm --filter @gdgjp/wiki typecheck && pnpm lint
```

呼び出しが残っていないことの確認:

```bash
cd wiki && grep -rn "getWikiCanonicalSlugPaths" app/routes/admin/
```

### 回帰として固定すべきテスト — 静かに壊れる経路

ここが一番効く。ビルドも typecheck も通るのに壊れるのは次の 4 経路。

- **`wikiPath` が祖先を含んでいる。** ツリーからのパス導出を間違えて `/wiki/<slug>` だけを
  返しても、ルート直下のページでは正しく見えるので画面上は気づけない。
  **親子 2 階層以上の fixture で `wikiPath` を assert する**。これがないと、管理画面の
  タイトルリンクが全部 404 になる経路が静かに入る
- **孤児ページが消えていない。** `parent_id` が既に存在しないページを指している行は、
  ツリー構築で取りこぼすと一覧から丸ごと消える。管理画面から見えなくなると、
  削除もアーカイブもできなくなる。`buildTree` の孤児 → ルート挙動に依存していることを
  ユニットテストで固定する
- **archived ページが落ちていない。** ツリー化の過程で `status` による絞り込みを入れると、
  アーカイブ済みページの復元・完全削除の導線が消える。現行はフィルタなしで全件表示
- **action の intent が全部残っている。** UI をコンポーネントへ切り出す過程で
  hidden input の `intent`（`archivePage` / `restorePage` / `deletePage`）や `pageId` を
  落とすと、ボタンは押せるのにサーバ側が `return {}` で黙って何もしない。
  既存の action テストを走らせ続け、手動でも 3 操作すべてを実行する

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. admin ユーザーでサインインし `/admin/pages` を開く
3. 親ページの下に子ページがインデントして並び、子ページ数バッジが出ている
4. トグルで親を畳むと子孫が消え、開くと戻る
5. 子ページのタイトルをクリックし、`/wiki/<親>/<子>` に遷移して本文が出る
6. 子ページの「編集」をクリックし、編集画面が開く
7. 子ページをアーカイブする。子孫も含めてアーカイブされ、一覧でステータスが変わる
8. アーカイブ済みページを復元し、続いて別のアーカイブ済みページを完全削除する
9. DevTools Network で `/admin/pages` の loader レスポンスが 1 回で返る
10. 幅 767px 以下で表が横スクロールし、ページ本体が横に溢れない
