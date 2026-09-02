# Stage 03 tag-dialog — タグ管理をダイアログと表示専用テーブルに作り直す

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-manage-ui-refinement/index.md`。**着手前に必ず読むこと。**
このステージは Stage 01（`01-shell-integration.md`）の完了後に実行する。
Stage 02（`02-page-tree.md`）とは並行して構わない。

`/admin/tags`（`wiki/app/routes/admin/tags.tsx`、353 行）の UI に 3 つの問題がある。

**① 新規作成フォームが常設されている。** 表の上に 4 フィールドのフォームが常に開いており
（`tags.tsx:117-199`）、日常操作である「タグ一覧を見る」の邪魔をしている。
タグ作成は稀な操作なので、ダイアログに入れるべき。

**② 編集が行内編集ハック。** 編集モードの行は `<input>` を各 `<td>` に散らし、
HTML の `form={`edit-form-${tag.slug}`}` 属性で、アクションセルにある単一の `<Form>` に
関連付けている（`tags.tsx:227-297`）。テーブル内に有効な `<form>` を置けない制約への回避策で、
読みにくく、フォーカス順やモバイルでの挙動も破綻しやすい。

**③ 表がイけていない。** 6 列（カラー / スラッグ / 日本語ラベル / 英語ラベル / ページ数 / 操作）が
等しい重みで並び、どれが主キーで何が補助情報かが読めない。操作ボタンが常時 2 つ露出している。

加えて、action が返すエラーメッセージが**ハードコードの英語**（`tags.tsx:39,41,42,49,61,62`）で、
`admin.tags.error_slug_taken` / `error_slug_invalid` という i18n キーが用意済みなのに使われていない。
日本語 UI に英語のエラーが出る。

### 対象範囲

`wiki/` ワークスペースのみ。`/admin/tags` とその付属コンポーネントだけを扱う。

`app/routes.ts` と `app/routes/admin/layout.tsx` は Stage 01 の担当なので**触らない**。
`/admin/pages` は Stage 02 の担当なので触らない。

### 読むべきもの

- `docs/wiki-manage-ui-refinement/index.md` — 全体計画。共通の制約と再利用対象
- `wiki/app/routes/admin/tags.tsx` — 現行実装（353 行）。loader / action / インラインフォーム / 表
- `wiki/app/components/ui/dialog.tsx` — 使用する既存ダイアログ
- `wiki/app/locales/ja/common.json` の `admin.tags` — 既存キー。未使用の error キーを含む
- `wiki/app/db/schema/` の `tags` テーブル定義 — `slug` / `labelJa` / `labelEn` / `color` / `pageCount`

### 再利用する既存実装 — 書き直さないこと

- `wiki/app/components/ui/dialog.tsx` — Radix ベースの既存ダイアログ。新しく作らない
- `wiki/app/components/ui/button.tsx` — 既存の `Button`。ただし stock shadcn トークン
  （`bg-primary` 等）を使っているため、管理画面のセマンティックトークンと混ざる。
  現行 `tags.tsx` はボタンを素の `<button>` + セマンティックトークンで書いているので、
  **そちらの書き方に揃える**（`Button` の import を新たに増やさない）
- `wiki/app/routes/admin/tags.tsx` の **action 3 分岐**（`createTag` / `updateTag` / `deleteTag`、
  `:33-74`）— バリデーション規則（スラッグ正規表現 `^[a-z0-9]+(?:-[a-z0-9]+)*$`、
  カラー `^#[0-9a-fA-F]{6}$`、重複チェック、`pageTags` 削除の順序）は**そのまま維持する**。
  変えるのはエラーの返し方だけ
- `wiki/app/routes/admin/tags.tsx` の loader（`:14-20`）— 1 行。変更不要
- `admin.tags.error_slug_taken` / `admin.tags.error_slug_invalid` — 両ロケールに**既にある**未使用キー

### 前提として確認済みの事実（再調査不要）

- action の `updateTag` はスラッグを不変として扱う（ラベルとカラーのみ更新）。この契約は維持する
- 現行のフラッシュ表示は `useActionData()` の `ok` / `error` を見て、表の上に
  success / danger のバナーを出す（`tags.tsx:89-115`）。この仕組みは残す
- `wiki/app/routes/wiki/_components/SearchView.tsx` があるとおり、
  ルート付属コンポーネントを `app/routes/<area>/_components/` に置く慣例が既にある
- `design-token-policy` の例外コメントは `// design-token-policy: allow-dynamic-color` で、
  現行 `tags.tsx:154` に使用例がある

---

## Design — 設計

### 1. `app/routes/admin/_components/TagDialog.tsx`（新規）

単一のダイアログを新規・編集の両モードで使い回す。

- props: `{ mode: "create" | "edit"; tag?: TagRow; open: boolean; onOpenChange: (open: boolean) => void }`
- 中身は `<Form method="post">` + `<input type="hidden" name="intent">`
  （`createTag` / `updateTag`）。**action の formData 契約は現行のまま**
- フィールド: スラッグ / 日本語ラベル / 英語ラベル / カラー
  - `mode === "create"`: スラッグは編集可能。`pattern="[a-z0-9]+(-[a-z0-9]+)*"` と `required` を付ける
  - `mode === "edit"`: スラッグは読み取り専用のテキスト表示 + `<input type="hidden" name="slug">`
- カラーは `<input type="color">`。`defaultValue="#3b82f6"` の行に
  `// design-token-policy: allow-dynamic-color` を付ける
- `useNavigation()` で送信中は submit ボタンを `disabled` にする（二重送信防止）
- `useActionData()` が `ok` を返したら `useEffect` でダイアログを閉じる。
  エラー時は**閉じない**（入力を失わせない）
- ダイアログのタイトルは `t("admin.tags.new_tag_dialog_title")` /
  `t("admin.tags.edit_tag_dialog_title")`

**`form=` 属性でセルをまたぐ行内編集ハックは全廃する。**

### 2. `app/routes/admin/_components/TagTable.tsx`（新規）

表示専用の表に作り直す。列を 6 → 4 に減らし、情報に重み付けをする。

| 列 | 内容 |
|---|---|
| タグ | カラー見本（`style={{ backgroundColor: tag.color }}`、要 allow-dynamic-color コメント）+ 等幅のスラッグを 1 セルに統合 |
| ラベル | 日本語ラベルを主、英語ラベルを `content-tertiary` の小さい副見出しとして下段に |
| ページ数 | 右寄せ・数値 |
| 操作 | 編集 / 削除 |

- 見出し行の右上に「新規タグ」ボタンを置き、`TagDialog` を `mode="create"` で開く。
  常設インラインフォームは撤去する
- 操作ボタンは行ホバー / フォーカス時のみ表示する
  （`opacity-0 group-hover:opacity-100 focus-within:opacity-100`、行に `group`）。
  キーボード操作で到達できることを `focus-within` で担保する
- 編集は `TagDialog` を `mode="edit"` で開く。削除は現行どおり `window.confirm` + `<Form method="post">`
  （`intent=deleteTag` + `slug` hidden）
- 空状態 `t("admin.tags.empty")` は現行どおり残す
- 表全体を `overflow-x: auto` のコンテナに入れる
- 列見出しの i18n キーは、統合した「ラベル」列に `t("admin.tags.col_label")` を新設。
  不要になる `col_slug` / `col_label_ja` / `col_label_en` / `col_color` は削除してよい
  （残す場合は両ロケールで揃える）

### 3. `app/routes/admin/tags.tsx` — loader / action + 組み立てだけに絞る

現行 353 行 → 120 行程度。UI は `TagTable` と `TagDialog` の組み立てと、
フラッシュメッセージ表示だけにする。ダイアログの `open` / `mode` / 対象タグの state は
このルートコンポーネントが持つ。

### 4. action のエラーを i18n キー返却に変える

ハードコード英語（`tags.tsx:39,41,42,49,61,62`）をやめ、キーとパラメータを返す:

```ts
if (existing) return { errorKey: "admin.tags.error_slug_taken", errorParams: { slug } };
```

コンポーネント側で `t(actionData.errorKey, actionData.errorParams)` する。

既存キーで足りないもの（全フィールド必須、カラー形式不正）は新規キーを両ロケールに追加する。
`errorKey` は `admin.tags.*` の固定文字列リテラルのみを返すこと
（任意文字列を `t()` に流すと i18n キーの網羅性が検証できなくなる）。

### 5. i18n キーの追加

`wiki/app/locales/ja/common.json` と `wiki/app/locales/en/common.json` の `admin.tags` に追加。
両ロケールを必ず揃える。

| キー | ja | en |
|---|---|---|
| `admin.tags.new_tag_dialog_title` | `タグを作成` | `Create tag` |
| `admin.tags.edit_tag_dialog_title` | `タグを編集` | `Edit tag` |
| `admin.tags.col_label` | `ラベル` | `Label` |
| `admin.tags.error_required` | `すべての項目を入力してください。` | `All fields are required.` |
| `admin.tags.error_color_invalid` | `カラーの形式が正しくありません。` | `Invalid color format.` |

既存の `admin.tags.error_slug_taken` / `error_slug_invalid` は**そのまま使う**（新設しない）。

### 制約

- **action のバリデーション規則を変えない。** スラッグ正規表現、カラー形式、重複チェック、
  `deleteTag` で `pageTags` を先に消す順序は現行のまま。変えるのはエラーの**返し方**だけ
- **`updateTag` でスラッグを変更可能にしない。** 現行の契約は「スラッグ不変」
- **`app/components/ui/dialog.tsx` を変更しない。** 他画面が使っている
- **`app/components/ui/button.tsx` を新たに import しない。** stock shadcn トークンを使っており、
  管理画面のセマンティックトークンと語彙が混ざる。素の `<button>` + セマンティックトークンで書く
- **`app/routes.ts` と `app/routes/admin/layout.tsx` を触らない。** Stage 01 の担当
- **`app/routes/admin/pages.tsx` を触らない。** Stage 02 の担当
- **非テストソースは 400 行以下**（`tests/architecture/file-size.test.ts`）。`ALLOWLIST` 追加は禁止
- **デザイントークンを使う**（`tests/architecture/design-token-policy.test.ts`）。
  Tailwind デフォルト色と色リテラルは禁止。動的なタグ色を扱う行にだけ
  `// design-token-policy: allow-dynamic-color` を付ける

---

## Files to touch — 変更ファイル

### `wiki/`

- `app/routes/admin/tags.tsx` — UI をコンポーネントへ委譲、action のエラーを i18n キー返却に
- `app/routes/admin/_components/TagDialog.tsx` — **新規**
- `app/routes/admin/_components/TagTable.tsx` — **新規**
- `app/routes/admin/tags.test.ts` — **新規**（action のバリデーションと i18n キー返却）
- `app/locales/ja/common.json` — `admin.tags` にダイアログ・列・エラーのキーを追加
- `app/locales/en/common.json` — 同上

**触らないファイル**: `app/routes.ts`、`app/routes/admin/layout.tsx`、
`app/routes/admin/pages.tsx`、`app/components/ui/dialog.tsx`、`app/components/ui/button.tsx`

---

## Verification — 完了条件と検証

### 完了条件

1. タグ一覧が表示専用の 4 列テーブルになり、常設インラインフォームが消えている
2. 「新規タグ」ボタンからダイアログでタグを作成できる
3. 各行の「編集」から同じダイアログでラベルとカラーを更新できる。スラッグは変更できない
4. 削除が従来どおり確認つきで動く
5. 重複スラッグ・不正スラッグ・不正カラーのエラーが**日本語 UI では日本語で**出る
6. `form=` 属性でセルをまたぐ行内編集が 1 か所も残っていない

### コマンド

```bash
pnpm --filter @gdgjp/wiki exec vitest run app/routes/admin
```

```bash
pnpm --filter @gdgjp/wiki test && pnpm --filter @gdgjp/wiki typecheck && pnpm lint
```

行内編集ハックの残骸チェック（0 件になること）:

```bash
cd wiki && grep -rn 'form={`edit-form' app/routes/admin/
```

### 回帰として固定すべきテスト — 静かに壊れる経路

ここが一番効く。ビルドも typecheck も通るのに壊れるのは次の 4 経路。

- **ダイアログの formData が action の契約と一致している。** `name` 属性
  （`intent` / `slug` / `labelJa` / `labelEn` / `color`）を 1 つでも取り違えると、
  action は `(form.get("labelJa") as string).trim()` で **実行時に例外**を投げるか、
  空文字として「すべての項目を入力してください」を返す。画面上は「保存できない」としか見えない。
  action のユニットテストを新設し、`createTag` / `updateTag` の正常系 formData を
  実際に組み立てて通すこと
- **エラーが日本語で出る。** `errorKey` を返す形に変えたのにコンポーネント側で `t()` を
  通し忘れると、画面には `admin.tags.error_slug_taken` という**キー文字列がそのまま表示される**。
  typecheck も lint も通る。重複スラッグを実際に作って目視確認する
- **両ロケールのキーが揃っている。** ja にだけキーを足して en を忘れると、
  英語 UI でキー文字列が露出する。追加・削除したキーについて
  `ja/common.json` と `en/common.json` の `admin.tags` 配下のキー集合が一致することを確認する
- **`deleteTag` が `pageTags` を先に消している。** action を触る過程でこの順序を崩すと、
  タグは消えるのに `page_tags` に孤児行が残り、ページ側のタグ表示が壊れる。
  action テストで削除の呼び出し順を固定する

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. admin ユーザーでサインインし `/admin/tags` を開く
3. 表の上に常設フォームがなく、右上に「新規タグ」ボタンがある
4. 「新規タグ」からダイアログを開き、スラッグ・日英ラベル・カラーを入れて作成する。
   ダイアログが閉じ、成功バナーが出て、一覧に追加される
5. もう一度同じスラッグで作成し、**日本語の**重複エラーが出てダイアログが閉じないことを確認する
6. 大文字やスペースを含むスラッグで作成し、**日本語の**スラッグ形式エラーが出る
7. 行にホバーして「編集」を開き、ラベルとカラーを変更して保存する。一覧に反映される。
   編集ダイアログでスラッグが読み取り専用になっている
8. タグを削除し、確認ダイアログを経て一覧から消える。
   そのタグが付いていたページを開き、タグ表示が壊れていない
9. UI 言語を英語に切り替え、列見出し・ダイアログ・エラーがすべて英語で出る
10. 幅 767px 以下で表が横スクロールし、ダイアログが画面に収まる
11. キーボードのみ（Tab / Enter）で「新規タグ」→ 入力 → 保存、および行の「編集」に到達できる
