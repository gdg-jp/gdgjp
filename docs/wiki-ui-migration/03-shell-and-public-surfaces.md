# Unit 03 — Root・アプリシェル・公開画面の移行

## Context

全体計画は [`index.md`](index.md)、app foundation は
[`02-app-foundation-and-ci.md`](02-app-foundation-and-ci.md)。Unit 02 完了後に着手し、Unit 04〜06 と
並行せず shell を先に確定する。Unit 04〜06 はこの unit の完了に依存する。

この unit は `wiki/app/root.tsx` の利用確認、`app/components/` の shell component、`routes/_app.tsx`、
home、catch-all、public landing/about/privacy/terms を担当する。`@gdgjp/gdg-lib/ui` の account menu と
app launcher は専門所有境界として維持する。

`app.css`、UI package export、E2E global fixture、workflow は Unit 01/02/07 所有とし、この unit から
競合編集しない。locale は shell/public namespace のキーだけを最小差分で変更する。

## External Goals

- anonymous の landing/legal/error、signed-in の about、identity/visibility に応じる共通 shell が同じ
  shared visual language を使う。
- header/sidebar/footer/navigation progress/search/theme/language/account action が desktop/mobile で機能する。
- navigation 開閉、route change、mobile Sheet の Escape/outside click/focus return が一貫する。
- SSR から hydration 後まで theme flash、provider error、console/hydration warning がない。
- keyboard user が skip link から main content へ移動でき、active navigation を認識できる。
- 既存 URL、auth return_to、loader revalidation、sidebar persistence、page-tree data を変更しない。

受け入れ条件:

- shell の一般 action/input/tooltip/sheet/menu/skeleton/icon は `@gdgjp/ui` contract を使う。
- shell component は app routing/data composition に限定され、Radix behavior や shared styling を再実装しない。
- mobile と desktop で navigation/action が欠落せず、狭い viewport と長い日本語でも overflow しない。
- public route と ErrorBoundary は Light/Dark で読め、primary action は画面ごとに優先度が一貫する。

## Design

### 画面単位の進行

authenticated/anonymous の両方を支える app shell を最初に確定し、続いて catch-all/ErrorBoundary、
privacy、terms、signed-in about、home/index の順に一画面ずつ移行する。
各画面を Light/Dark の 390px/1280px で実ブラウザー確認してから個別 commit にする。各 commit に
intentional visual difference を一文で記録し、複数画面を同じ commit に含めない。

### Root and error surface

Unit 02 の単一 ThemeProvider/Toaster/CSS contract を利用する。ErrorBoundary は status/title/description/
home action の semantic hierarchy を shared Heading/Text/Button/Stack 等で構成し、404 と 500 の違いを
icon と文言で伝える。error 発生時にも document metadata、scripts、theme hydration を維持する。

### App shell

Navbar、BaseSidebar、Sidebar、AdminNavSection、NavItem、Footer、NavigationProgress、SidebarDialog、
SidebarPopover、Tooltip、Skeleton を監査する。

- shared AppShell/Sidebar を composition できる箇所は使い、Wiki の page-tree data と React Router Link は
  app 側 slot に残す。
- mobile Sheet と desktop sidebar の state/persistence、route change close、focus return を維持する。
- search は shared Input と React Router Form、theme/language menu は shared DropdownMenu/useTheme を使う。
- icon-only action は IconButton と accessible label、active link は `aria-current` を持つ。
- loading placeholder は shared Skeleton を基礎に、親の labelled loading/`aria-busy` を補う。

### Public and home composition

`routes/_index.tsx`、`routes/_components/HomeCta.tsx`、public landing sections、about/privacy/terms、catch-all を
Card/PageHeader/Heading/Text/Stack/Inline/Button/Link/Badge/EmptyState 等で構成する。supplied landing icon/
illustration や public content はそのまま保持し、design system に domain asset を移さない。

各画面は一つの primary action を基本とし、secondary navigation を primary style で競合させない。
legal content の semantic heading/order/link destination と本文は変更しない。

## Protocols

- route path、loader data、`shouldRevalidate`、auth URL/`return_to`、page-tree fetch を変更しない。
- `GdgAccountMenu` と `GdgAppLauncher` は `@gdgjp/gdg-lib/ui` から利用し続ける。
- shared component に React Router や user object の知識を追加しない。`asChild`/children で Link を合成する。
- mobile overlay は close 後に元 trigger へ focus を戻す。route change 後に hidden overlay を残さない。
- responsive breakpoint で action set は同じ意味を保ち、表示場所だけを変える。
- decorative icon は `aria-hidden`、icon-only action は翻訳済み `aria-label` を持つ。
- public copy、ja/en key、analytics script、metadata を保持する。

## Tests to add/update

- component tests: Navbar search/theme/language、Sidebar active/admin states、mobile close/focus、Skeleton semantics。
- root/error tests: 404/500 structure、home link、SSR output、ThemeProvider 外参照がないこと。
- route tests: auth `return_to`、`shouldRevalidate`、public/legal URL と text contract の回帰。
- Playwright: anonymous landing/privacy/terms/error と `/about` の sign-in redirect/return_to、signed-in about、
  member shell に加えて public Wiki を見る anonymous shell の desktop/mobile、Light/Dark、keyboard skip
  link、sidebar/menu Escape/focus return、horizontal overflow、console/hydration error。
- screenshot review: 各画面の Light/Dark 390px/1280px、expanded/collapsed shell、mobile navigation、404。
- Unit 02 の convention/architecture/typecheck をこの所有範囲に対して再実行する。

## Tech Stack

- React 19、React Router v7 SSR、react-i18next
- `@gdgjp/ui` AppShell/Sidebar/Sheet/DropdownMenu/Input/Button/Typography/layout/state components
- `@gdgjp/gdg-lib/ui` account menu/app launcher
- Tailwind v4 consumer utilities、shared semantic tokens
- Vitest、Testing Library、Playwright、axe、visual snapshots
