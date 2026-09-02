# Stage 01 shell-integration — 管理画面をアプリシェルへ統合し統計ページを削除する

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-manage-ui-refinement/index.md`。**着手前に必ず読むこと。**
このステージは `02` / `03` の前提であり、最初に実行する。

`wiki/` の管理画面 `/admin/*` は、通常アプリのシェルから切り離されている。

- `wiki/app/routes.ts:80` の `route("admin", "routes/admin/layout.tsx", [...])` は
  `layout("routes/_app.tsx", [...])` の**外側**にある兄弟ルート。通常画面 ↔ 管理画面の移動で
  アプリシェル（Navbar + Sidebar）が丸ごとアンマウント/再マウントされる。
  `_app.tsx` の `shouldRevalidate`（GET ナビゲーションでページツリーを再取得しない最適化）も
  レイアウトごと捨てられるため効かない。
- `wiki/app/routes/admin/layout.tsx` は `BaseSidebar` を**別インスタンス**として、
  別の localStorage キー（`gdg-admin-sidebar-open` / `gdg-admin-sidebar-width`）で持つ。
  結果、通常サイドバーと幅・開閉状態が同期せず、管理画面に入った瞬間にサイドバーが
  差し替わって幅が飛ぶ。ユーザーの「サイドバーが一般アプリと異なるコンポーネントを使用している」
  という指摘はこれを指す。
- 通常サイドバーの管理リンクは `/admin`（`wiki/app/components/Sidebar.tsx:177`）。
  `wiki/app/routes/admin/index.tsx` はサーバ側 `redirect("/admin/pages")` なので、
  通常導線から入るたびにリダイレクト 1 往復が余分に挟まる。
- `/admin/stats` は不要。参照元は `routes.ts` と管理ナビの 2 か所のみ。
  翻訳キュー指標も含めて全部削除する方針でユーザー確認済み。

### 対象範囲

`wiki/` ワークスペースのみ。

このステージは**シェルとルーティングだけ**を扱う。
`/admin/pages` の表の中身は Stage 02、`/admin/tags` の UI は Stage 03 の担当なので触らない
（`pages.tsx` / `tags.tsx` の loader・action・JSX は無変更のまま動き続けること）。

### 読むべきもの

- `docs/wiki-manage-ui-refinement/index.md` — 全体計画。共通の制約と再利用対象
- `wiki/CLAUDE.md` — auth（RP）、i18n、アーキテクチャテストの前提
- `wiki/app/routes/_app.tsx` — 統合先のアプリシェル。loader / `shouldRevalidate` / `sidebarProps`
- `wiki/app/routes/admin/layout.tsx` — 撤去対象の重複シェル（121 行）
- `wiki/app/components/Sidebar.tsx` — 通常サイドバー。`NavItem` の定義と管理リンク

### 再利用する既存実装 — 書き直さないこと

- `wiki/app/components/Sidebar.tsx:16` の `NavItem` — `prefetch="intent"` 済みのナビリンク。
  **管理ナビもこれをそのまま使う。**新しいリンクコンポーネントを作らない
- `wiki/app/components/BaseSidebar.tsx` — 通常サイドバーが使い続ける。**変更しない**
- `wiki/app/routes/_app.tsx` の `Navbar` / `Sidebar` / `useMediaQuery` / 開閉 state /
  `gdg-sidebar-open` / `gdg-sidebar-width` — すべて既にある。管理画面用に複製しない
- `wiki/app/features/auth/utils.server.ts:101` の `requireAdmin(request, env)`

### 前提として確認済みの事実（再調査不要）

- `layout()` は URL セグメントを持たない。`admin` ブロックを `layout("routes/_app.tsx", [...])` の
  中へ移動しても **URL は 1 つも変わらない**。`route-urls.test.ts` のスナップショット差分は
  `/admin/stats` の 1 行削除だけになるはずで、それ以外の差分が出たら移動を間違えている
- catch-all `route("*", "routes/$.tsx")` は `layout()` ブロックより前に書かれているが、
  React Router v7 は記述順ではなく specificity でランク付けするため影響しない
- 管理画面を参照している E2E テストは存在しない
- `/admin/stats` を参照しているのは `app/routes.ts:84` と `app/routes/admin/layout.tsx:29` のみ

---

## Design — 設計

### 1. `app/routes.ts` — admin ブロックをアプリシェル配下へ移す

最上位の `route("admin", ...)` ブロック（現 `routes.ts:77-85`）を丸ごと削除し、
`layout("routes/_app.tsx", [...])` の子として末尾に追加する。同時に `stats` の行を落とす。

```ts
layout("routes/_app.tsx", [
  index("routes/_index.tsx"),
  // ... 既存のアプリルート ...
  route("/tasks/:slug/history", "routes/tasks/history.tsx"),

  // 管理画面。アプリシェル（Navbar + Sidebar）を通常画面と共有する。
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/index.tsx"),
    route("pages", "routes/admin/pages.tsx"),
    route("tags", "routes/admin/tags.tsx"),
  ]),
]),
```

`route()` の第 1 引数（URL）は 1 つも書き換えない。移動するのは配置だけ。

### 2. `app/routes/admin/layout.tsx` — 重複シェルの撤去（121 行 → 20 行程度）

`Navbar` / `BaseSidebar` / `useMediaQuery` / `desktopOpen` / `mobileOpen` /
`localStorage` 復元 / `toggleSidebar` / `NAV_ITEMS` をすべて削除する。
`_app.tsx` が既に提供しているものの重複であり、これが幅の不一致の原因そのもの。

残すのは認可と余白コンテナだけ:

```tsx
export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAdmin(request, context.cloudflare.env);
  return null; // user は _app.tsx の loader が既に持っている
}

export default function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6 md:p-8">
      <Outlet />
    </div>
  );
}
```

`_app.tsx` の `<main className="flex-1">` は padding を持たないため、
旧 `admin/layout.tsx` の `p-8` 相当をここで補う必要がある。これを忘れると管理画面が端に貼り付く。

`requireAdmin` はこの loader に残すこと。`_app.tsx` の loader は `getAccessIdentity` を呼ぶだけで
admin を要求しないので、ここを消すと管理画面が誰でも開けるようになる。

### 3. `app/components/AdminNavSection.tsx`（新規）と `Sidebar.tsx`

現在の単発 `NavItem to="/admin"`（`Sidebar.tsx:175-183`）を管理セクションに差し替える。
`Sidebar.tsx` は 225 行あり 400 行上限に余裕を残したいので、管理ナビは別ファイルに切る。

`AdminNavSection.tsx` の仕様:

- props: `{ isCollapsed: boolean }`
- 親項目「管理」（`t("admin.label")`、`Settings` アイコン）。リンク先は **`/admin/pages`**。
  `/admin` にするとサーバ側リダイレクトを 1 往復踏むので直リンクにすること
- `useLocation()` で `pathname.startsWith("/admin")` のとき、子項目を親の下にインデントして展開する:
  - `/admin/pages` — `FileText`、`t("admin.nav.pages")`
  - `/admin/tags` — `Tag`、`t("admin.nav.tags")`
- 管理画面の外にいるときは親項目のみ表示する（通常画面のサイドバーを管理ナビで埋めない）
- `isCollapsed` のときは子項目を出さず、親項目のアイコンだけにする
- リンクは `~/components/Sidebar` の `NavItem` をそのまま使う。`isActive` は
  `location.pathname.startsWith(to)`

`Sidebar.tsx` 側は該当ブロックを次に置き換える:

```tsx
{isAuthenticated && isAdmin && <AdminNavSection isCollapsed={isCollapsed} />}
```

`Settings` アイコンの import が `Sidebar.tsx` で未使用になるなら削除する（Biome が拾う）。

### 4. `app/routes/admin/index.tsx` — 変更しない

`/admin` への直 URL アクセスや外部ブックマークのために `redirect("/admin/pages")` は残す。
サイドバーが直リンクになることで、通常導線からはこのホップを踏まなくなる。

### 5. `app/components/NavigationProgress.tsx`（新規）と `_app.tsx`

体感速度の改善。`useNavigation()` の `state !== "idle"` のあいだ、画面上端に
細い進捗バー（`fixed top-0 inset-x-0 h-0.5 z-50`、`bg-action-primary`）を出す。
同じ仕組みが `tinyurl/app/components/dashboard-shell.tsx` にあり、体感差の一因になっている。

`_app.tsx` では `<Navbar ... />` の直前に `<NavigationProgress />` を 1 行足すだけ。
`_app.tsx` へのそれ以外の変更はしない。

### 6. 統計ページの削除

- `wiki/app/routes/admin/stats.tsx` を削除
- `app/routes.ts` から `route("stats", ...)` を削除（上記 1 でまとめて実施）
- 管理ナビから統計項目を削除（`AdminNavSection` に統計を作らない）。
  `BarChart3` の import も残さない
- `wiki/app/locales/ja/common.json` と `wiki/app/locales/en/common.json` から
  `admin.stats.*`（オブジェクトごと）と `admin.nav.stats` を削除。両ロケールを必ず揃える
- `wiki/tests/architecture/__snapshots__/route-urls.test.ts.snap` から `/admin/stats` の行を削除。
  スナップショット更新は下記コマンドで行い、**差分が `/admin/stats` の 1 行削除だけ**であることを
  必ず目視確認する

### 制約

- **`route()` の第 1 引数（URL）を書き換えない。** このステージはルートの配置を変えるだけ。
  URL が動くと外部リンク・ブックマーク・`gdg` CLI が壊れる。`route-urls` スナップショットの差分が
  `/admin/stats` の 1 行以外に出たら、移動を間違えている
- **`app/components/BaseSidebar.tsx` を変更しない。** 通常サイドバーが使い続ける
- **`admin/layout.tsx` の `requireAdmin` を消さない。** `_app.tsx` は admin を要求しない
- **`app/routes/admin/pages.tsx` と `tags.tsx` の中身を触らない。** Stage 02 / 03 の担当。
  このステージ完了時点では、旧 UI のまま新しいシェルの中で正常に動くこと
- **非テストソースは 400 行以下**（`tests/architecture/file-size.test.ts`）。
  `ALLOWLIST` への追加は禁止
- **デザイントークンを使う**（`tests/architecture/design-token-policy.test.ts`）。
  Tailwind デフォルト色と色リテラルは禁止。`surface-*` / `content-*` / `border-*` /
  `action-*` / `feedback-*` を使う
- 旧 localStorage キー `gdg-admin-sidebar-open` / `gdg-admin-sidebar-width` は使わなくなる。
  移行コードは書かない（ユーザーの幅設定は通常サイドバー側の値に一本化されるだけで実害がない）

---

## Files to touch — 変更ファイル

### `wiki/`

- `app/routes.ts` — admin ブロックを `_app.tsx` レイアウト配下へ移動、`stats` の行を削除
- `app/routes/admin/layout.tsx` — シェル撤去。`requireAdmin` loader + `<Outlet/>` のみに
- `app/routes/admin/stats.tsx` — **削除**
- `app/components/Sidebar.tsx` — 管理リンクを `AdminNavSection` に差し替え
- `app/components/AdminNavSection.tsx` — **新規**
- `app/components/NavigationProgress.tsx` — **新規**
- `app/routes/_app.tsx` — `NavigationProgress` を 1 行追加（他は無変更）
- `app/locales/ja/common.json` — `admin.stats.*` と `admin.nav.stats` を削除
- `app/locales/en/common.json` — 同上
- `tests/architecture/__snapshots__/route-urls.test.ts.snap` — `/admin/stats` を削除

**触らないファイル**: `app/components/BaseSidebar.tsx`、`app/routes/admin/index.tsx`、
`app/routes/admin/pages.tsx`、`app/routes/admin/tags.tsx`、`app/routes/admin/pages.test.ts`

---

## Verification — 完了条件と検証

### 完了条件

1. 通常画面 → 管理画面の移動でサイドバーの**幅と開閉状態が変わらず**、ページツリーも消えない
2. サイドバーの「管理」からリダイレクトを踏まず `/admin/pages` に直行する
3. `/admin/pages` ↔ `/admin/tags` の往復でアプリシェルの loader リクエストが飛ばない
4. `/admin/stats` が 404 になる
5. `/admin/pages` と `/admin/tags` の**中身は旧 UI のまま正常に動く**（このステージでは作り直さない）
6. 非管理者は `/admin/pages` で 403

### コマンド

```bash
pnpm --filter @gdgjp/wiki exec vitest run tests/architecture/route-urls.test.ts -u
```

```bash
git diff wiki/tests/architecture/__snapshots__/route-urls.test.ts.snap
```

```bash
pnpm --filter @gdgjp/wiki test && pnpm --filter @gdgjp/wiki typecheck && pnpm lint
```

### 回帰として固定すべきテスト — 静かに壊れる経路

ここが一番効く。ビルドも typecheck も通るのに壊れるのは次の 4 経路。

- **`/admin/stats` 以外の URL が 1 つも動いていない。** `route-urls` スナップショットを
  `-u` で更新するとき、`/admin/stats` の 1 行削除以外の差分が混ざっていても緑になる。
  **必ず `git diff` を目視すること。** これを見落とすと外部リンクが本番で 404 になる
- **`requireAdmin` が生きている。** `admin/layout.tsx` を削り込む過程で loader ごと消しても
  typecheck は通り、画面も（管理者で見ている限り）正常に見える。
  非管理者セッションで `/admin/pages` が 403 になることを実際に確認する。
  可能なら `app/routes/admin/layout.tsx` の loader が `requireAdmin` を呼ぶことの
  ユニットテスト（`app/routes/admin/layout.test.ts`、`requireAdmin` を `vi.mock` して
  呼び出しを assert）を追加する
- **`_app.tsx` の `shouldRevalidate` を壊していない。** ここを触ると管理画面だけでなく
  通常画面のページツリーが毎回再取得される。`_app.tsx` の差分が
  `<NavigationProgress />` の 1 行追加と import だけであることを `git diff` で確認する
- **管理画面に padding が残っている。** 旧 `admin/layout.tsx` の `p-8` を移し忘れると、
  `_app.tsx` の `<main className="flex-1">` は padding を持たないので表が画面端に貼り付く。
  typecheck も lint も通る

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. admin ユーザーでサインインし、`/wiki/<既存ページ>` を開く
3. サイドバーの幅をドラッグで変更してから「管理」をクリックする。
   **幅が維持され、ページツリーが消えず、サイドバーが再マウントされない**
4. URL が `/admin/pages` になっている（`/admin` を経由したリダイレクトが Network に出ない）
5. サイドバーで「管理」の下に「ページ」「タグ」が展開されている。「統計」がない
6. `/admin/pages` ↔ `/admin/tags` を往復し、DevTools Network にシェル分の loader が出ない
7. サイドバーを畳んだ状態でも管理ナビのアイコンが機能する
8. `/admin/stats` に直接アクセスして 404
9. 幅 767px 以下に縮め、モバイルドロワー（`Sheet`）から管理画面へ入れる
10. 非管理者ユーザーでサインインし直し、`/admin/pages` が 403 になる
