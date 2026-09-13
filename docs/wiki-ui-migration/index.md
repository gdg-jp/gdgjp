# Wiki UI の `@gdgjp/ui` 全面移行計画

- [実装状況](status.md)
- [01 — Shared library defects](01-shared-library-defects.md)
- [02 — Wiki app foundation and CI](02-app-foundation-and-ci.md)
- [03 — Shell and public surfaces](03-shell-and-public-surfaces.md)
- [04 — Wiki pages and editor](04-wiki-pages-and-editor.md)
- [05 — Ingestion, sources, and notifications](05-ingestion-sources-and-notifications.md)
- [06 — Tasks, admin, and settings](06-tasks-admin-and-settings.md)
- [07 — Integration and visual QA](07-integration-and-visual-qa.md)

## Context

### 背景

`wiki/` は React Router v7 の Cloudflare Workers アプリであり、公開ランディング、認証後の
Wiki 閲覧・編集、共有、検索、ソース取り込み、AI 生成、タスク、設定、管理画面という複数の
UI サーフェスを持つ。共通デザインシステム `@gdgjp/ui` は React 19、Radix、semantic token、
Light/Dark theme、アクセシブルな操作 primitive、共通レイアウトを提供しているが、Wiki 側には
歴史的にローカル実装された primitive、直接の `lucide-react` 利用、手組みの menu/dialog/form、
個別の色・形状・motion が残っている。

この計画は、Wiki の業務ロジックや URL を変えず、一般化できる見た目と操作契約を
`@gdgjp/ui` に一本化する。全面移行とは、すべての JSX を機械的に共有コンポーネントへ置換する
ことではない。ページツリー、共同編集、ACL 共有、取り込み状態、タスク表などの
プロダクト固有 composition は `wiki/` に残し、その内部で使う一般 UI primitive と visual
language を共有契約へ移す。

### 未コミットの移行途中状態

着手時の working tree には、ユーザーが進めている未コミット WIP がある。これは破棄・巻き戻し・
別案での全面上書きをせず、実装開始時に差分を inventory し、各変更を「採用」「共有契約へ昇格」
「既存の `@gdgjp/ui` API に合わせて修正」に分類して継続する。

確認済みの途中状態は次のとおり。

- `wiki/package.json` は `@gdgjp/ui: workspace:*` を宣言済み。
- `wiki/app/app.css` は shared Tailwind/component/font CSS と layer order を導入済みで、Wiki 固有の
  editor/collaboration 表示だけを残す方向へ縮小中。
- `wiki/app/root.tsx` は文書単位の `ThemeProvider` と共有 `Toaster` を導入済み。
- `wiki/app/components/ui/`、ローカル Toast、ローカル theme hook、旧 theme-init script は削除途中。
- shell、dialog、share、source、notification など一部は `@gdgjp/ui` import へ移行途中。
- 現状の scan では `@gdgjp/ui` import が 44 行ある一方、`button/input/select/textarea` の native
  要素が 217 箇所・62 ファイルにある。hidden input、file/color input、editor 内部など正当な native
  利用も含むため、件数をゼロにするのではなく、共有 primitive を再実装している箇所をゼロにする。
- `pnpm -C wiki typecheck` は、AlertDialog action の variant/size、IconButton/Select/Button の size、
  消えた `inputClass`、DropdownMenu checkbox の binding 不備により現在 9 エラーで失敗する。
- `node scripts/check-ui-conventions.mjs --app wiki` は、直接 icon dependency、任意値 utility、
  component API の使い方を含む多数の未解消箇所を報告する。
- Wiki の theme/layering architecture test と `@gdgjp/ui` typecheck は通るが、それだけでは移行完了を
  示さない。
- clean CI/deploy job では `@gdgjp/ui` の dist を先に build する必要があり、その workflow 対応も
  WIP に含まれている。

### 対象範囲

- `ui/`: Wiki が必要とする汎用 capability の public API、CSS、story、test、consumer documentation。
- `wiki/app/`: root/theme、shell、公開画面、全機能画面、一般 UI primitive の利用箇所。
- `wiki/tests/`: architecture、unit、golden、E2E、visual/accessibility regression。
- `scripts/check-ui-conventions.mjs` と関連 test: 全面移行後の逆戻り防止。
- `wiki/package.json`、lockfile、Turbo/CI/deploy: shared package の build dependency と不要依存の整理。

### 非対象

- URL、loader/action/API、D1 schema、認証・認可、ACL、同期、取り込み、通知、タスクの業務仕様変更。
- `@gdgjp/gdg-lib/ui` が所有する account menu と app launcher の `@gdgjp/ui` への吸収。
- Markdown/editor/drag-and-drop/emoji picker 等の専門ライブラリを design system に移すこと。
- `wiki/` 固有の page tree、share controller、task domain component を `ui/` に移すこと。
- 他アプリの UI 移行。共有 API の変更による既存 consumer の regression 防止は対象に含む。

### 依存関係と実装順

1. 確認済み library defect を `ui/` だけの独立 task で解消する。app workaround は作らない。
2. WIP を基準化し、Wiki の theme、build/CI、静的 guardrail を確定する。
3. 共有契約確定後、shell/public を先に確定する。その後 Wiki/editor、ingestion/sources、
   tasks/admin/settings を、ファイル所有を分けて並行移行できる。`app.css`、barrel export、共通 locale、
   共通 E2E fixture は競合点なので foundation または最終統合だけが編集する。
4. 全領域完了後、残存 scan、全 test、実ブラウザーによる theme/viewport/keyboard QA を統合実施する。

実装中に共有 API の不足が見つかった場合、Wiki 内に新しい汎用 wrapper を作らない。library defect
report を作り、独立 `ui/` task で API・story・test・documentation を同一変更で整えてから領域移行を
続ける。

### 画面・認証 inventory

実装時は `app/routes.ts` の全 UI route file を列挙し、次の区分と loader の実装が一致することを開始前と
完了後に確認する。API-only route は visual migration 対象外だが、画面の form/fetcher contract として保持する。

| 区分 | route/surface | 認証・可視性契約 |
| --- | --- | --- |
| public | `/privacy`, `/terms`, catch-all error, sign-in/logout pass-through | anonymous 可。auth redirect の return_to を保持 |
| signed-in public-style | `/about` | `requireUser` を保持。no-shell 表示だけを変更 |
| access-aware | `/`, `/search`, `/wiki/*`, `/wiki/:slug/history`, `/tasks/:slug` | anonymous を含む identity と page visibility/ACL で結果を制限 |
| authenticated authoring | `/wiki/new`, `/wiki/:slug/edit`, `/recent`, `/archived`, `/ingest*`, `/analyze`, `/sources`, `/settings`, `/tasks/new`, `/tasks/:slug/settings`, `/tasks/:slug/history` | `requireUser` と各 domain permission を保持 |
| admin | `/admin/pages`, `/admin/tags` | layout の `requireAdmin` を保持 |

同じ route file 内の loader/action と UI は分離せず、visual edit が server contract に触れていないことを
差分で確認する。

### 確認済み library defect report

`gdg-ui` の開始条件を source と照合した結果、`DropdownMenuRadioItem`、`Stack align`、`Button fullWidth`、
`FormField hideLabel`、working `SidebarTrigger` を持つ `AppShell` は存在する。一方、次は app migration の
blocker なので、Wiki 内の回避ではなく最初の独立 unit で修正する。

| library file | 期待 behavior | 回避すると必要になる app work | fix 後の workaround |
| --- | --- | --- | --- |
| `ui/src/components/Combobox/Combobox.tsx:40,150,170` | remote filtering、controlled query、継続選択、active option/Arrow key/`aria-activedescendant` を composition 可能 | ShareDialog が listbox keyboard/focus/filtering を再実装 | 無効。shared behavior に置換して削除 |
| `ui/src/components/Icons/IconName.ts:450`, `Icons.tsx:66-74` | Wiki の semantic icon inventory 64種を public path から利用可能 | 未収録30種を `lucide-react` から直接 import、または意味の違う近似 icon へ置換 | 無効。shared wrapper に一本化して direct dependency を削除 |
| `ui/src/components/DatePicker/DatePicker.tsx:144,167` | controlled empty、外部 clear/replace、uncontrolled default を区別 | Wiki が custom calendar/date dropdown を維持 | 無効。shared DatePicker と app の date adapter に置換して削除 |

新しい defect を発見した場合も、library file/line、期待 behavior、必要だった app workaround、fix 後に
その workaround が有効かを同じ形式で追記する。空 report を当然視しない。

## External Goals

### 利用者から見える成果

- 公開ページ、認証後 shell、Wiki、共有、editor、source/ingestion、task、settings、admin の全画面が
  同じ色、typography、spacing、shape、elevation、motion の体系で表示される。
- Light/Dark/system theme が初回 SSR から一貫し、遷移、reload、portal を使う dialog/menu/toast でも
  theme flash や局所的な旧 theme が発生しない。
- dialog、sheet、popover、menu、select、tooltip は Escape、Tab、矢印キー、外側クリック、focus
  restoration を共有 primitive の契約どおり維持する。
- desktop と mobile の navigation、page action、share dialog、table、task interaction が同じ機能を
  保ち、狭い画面でも横方向にページ全体を押し広げない。
- loading、empty、success、warning、danger、disabled、read-only、permission-denied の状態が色だけに
  依存せず、適切な文言・ARIA・focus を持つ。
- 既存の日本語・英語文言、field name、submit intent、navigation destination、clipboard/storage failure、
  optimistic update、権限ごとの表示差は維持される。

### 完了条件

- `wiki/app/components/ui/` と同等のローカル primitive 群は存在せず、一般的な Button/Input/Select/
  Dialog/Menu/Popover/Sheet/Tooltip/Toast/theme/icon/motion は `@gdgjp/ui` から利用される。
- `wiki/` から `radix-ui`、`@radix-ui/*`、`sonner`、`next-themes`、`class-variance-authority`、
  `tailwind-merge`、`clsx`、`lucide-react` への直接 UI import がない。不要になった direct dependency は
  package manifest と lockfile から除く。
- product-specific component は Wiki に残せるが、共有 primitive の focus/keyboard/ARIA/portal/motion を
  自前で再実装しない。例外的な native control は semantic necessity と test を持つ。
- `wiki/app/app.css` は shared CSS の正規 layer order と Wiki 固有 integration style だけを持ち、
  token、base component、theme reset、汎用 animation を複製しない。
- `scripts/check-ui-conventions.mjs --app wiki` が rationale なしの違反ゼロで通る。検査を黙らせるための
  broad allowlist、ディレクトリ除外、ルール弱体化は行わない。
- `@gdgjp/ui` の public API を追加・変更した場合、実装、barrel export、stable `gdg-*` CSS、story、
  behavior test、browser/accessibility test、`README.md`、必要な `DESIGN.md` が同期する。
- Wiki の typecheck、unit/golden/architecture、build、E2E と UI package の typecheck、unit、build、
  consumer、E2E が通る。既知の brand contrast failure が残る場合は別問題として正確に報告し、
  新規 failure と混同しない。
- 触れた各画面を Light/Dark、390px/1280px の実ブラウザーで確認し、anonymous/member/author/admin の
  該当 identity、keyboard、screenshot 差分を意図別に review する。

## Design

### 1. 所有境界

`@gdgjp/ui` は routing、auth、data fetching、Wiki domain を知らない。次を所有する。

- semantic token と Tailwind mapping
- general-purpose input/action/feedback/surface/layout primitive
- Radix に基づく overlay、selection、focus、keyboard、portal lifecycle
- theme provider と shared motion/reduced-motion behavior
- icon wrapper と component-level styling contract

`wiki/` は URL、React Router Form/fetcher、translation、permission、domain state、product composition を
所有する。共有 component には domain data を props として詰め込まず、children、native props、
controlled state、event callback で組み合わせる。

### 2. WIP の取り込み方

最初に staged、unstaged、untracked を別々に列挙し、その union を path/behavior 単位で inventory する。
index と working tree の両方に差分があるファイルは二段階の差分を保持し、片方をもう片方で上書きしない。
WIP 全体を基準 commit 相当の patch として扱う。
既に正しい shared import、CSS layer、ThemeProvider、削除は維持する。compile error は Wiki 側を旧 API
へ戻して隠すのではなく、現在の shared public contract と利用意図を照合して解消する。

共有 API を拡張するのは、(a) design system が本来所有する behavior、または (b) 複数の独立した
Wiki surface で同じ汎用問題を解く場合に限る。Wiki 固有 wrapper の props をそのまま public API に
コピーしない。既存 API で表現できる場合は consumer を修正する。

### 2.1 画面単位の実行規律

foundation 後の app 移行は一画面ずつ行う。各画面で Light/Dark を 390px と 1280px の実ブラウザーで
確認し、keyboard reachability と focus、document overflow、long Japanese を確認する。visual difference は
一件ずつ「token 由来」「shared component geometry」「意図しない regression」に分類し、意図した差分を
一文で記録してから、その画面だけを commit する。複数画面を一 commit にまとめない。

領域 unit は実装の委譲境界であって commit 境界ではない。各 unit は依存の少ない leaf screen から
compound flow へ進め、途中の commit でも typecheck と対象 test を通す。

### 3. foundation と theme

- CSS layer は `theme, base, gdg-tokens, gdg-base, gdg-components, utilities` を文書の唯一の順序とする。
- `ThemeProvider` は root の一箇所だけに置き、storage key `gdg-apps-theme` と system default を維持する。
- ErrorBoundary も shared CSS/theme の契約外へ出ない。hydration 前後で theme-dependent DOM を変えない。
- Wiki 固有 CSS は TipTap/Markdown renderer、collaboration cursor、page preference、外部 widget の
  token bridge に限定する。外部 library の CSS variable も `--gdg-*` semantic token を参照する。
- persistent team/tag/presence color のような dynamic data は既存の狭い例外方針を保ち、固定 UI 色を
  dynamic-color 例外で通さない。

### 4. primitive と compound interaction

- action は `Button`/`IconButton`/`Link`、form は `FormField` と適切な Input/Textarea/Select/
  NativeSelect/Checkbox/Switch/DatePicker、feedback は Alert/Message/Toast/Spinner/Skeleton/EmptyState を
 意味に応じて使い分ける。
- AlertDialog の action/cancel、menu checkbox/radio、select trigger、icon button size など WIP で
 露呈した型の不一致は、共有側の documented contract と Wiki の UX 要件を一致させる。Radix semantics
  を失う `div`/hand-written outside-click listener への置換は禁止する。
- shared Combobox は controlled query、server/async 候補を client filtering しないモード、選択後に閉じるか
  継続するかの制御、active option と `aria-activedescendant`、端で停止する ArrowUp/ArrowDown、Home/End、
  Enter/Escape の責務を公開契約にする。async 更新で active option が消えたら存在しない id を残さない。
  候補取得、ACL、複数選択 chip の domain state は Wiki に残し、ShareDialog が shared keyboard/listbox
  behavior を composition できるようにする。既存の単一選択 consumer は壊さない。
- shared DatePicker は controlled empty/clear/replace と uncontrolled default を区別する。Wiki は既存の
  `YYYY-MM-DD | null` を timezone で日付をずらさず local calendar date に変換する。
- product-specific toolbar、filter、page tree、share flow は app に残すが、その menu/popover/dialog/
  action/input は shared primitive を composition する。
- hidden input、file input、color input、contenteditable/editor surface など native semantics が必要なものは
  残せる。見た目を持つ通常の text/select/button を native の class bundle で再現することはしない。
- icon は `@gdgjp/ui` の公開 icon contract を通す。装飾 icon は `aria-hidden`、意味を持つ単独 icon は
  label を持ち、hover animation は reduced-motion と keyboard interaction を損なわない。

### 5. 画面領域

| 領域 | 主な surface | 移行上の重点 |
| --- | --- | --- |
| root/shell/public | ErrorBoundary、Navbar、Sidebar、Footer、home、landing、about/legal | SSR theme、skip/focus、responsive navigation、account launcher 境界 |
| Wiki/pages/editor | read/edit/new/history/search/recent/archive、page tree、comments/reactions、share、right sidebar | toolbar/menu、ACL state、clipboard/storage errors、editor theme bridge、D&D |
| ingestion/sources | start/session/analyze、operation review、Google/Discord/Drive dialogs、source list/toolbars | long-running state、warning/error、file input、progress、nested overlays |
| tasks/admin/settings | task list/table/timeline/detail/history/settings、tag/page admin、user settings | dense table、custom dropdown replacement、date/filter/team color、forms、destructive action |

公開 landing の supplied brand illustration や Wiki コンテンツ本文は、shared component に押し込まず
token と layout primitive で囲う。task/presence/team/tag の domain color はラベルやアイコンを併用する。

### 6. guardrail と CI

- UI convention checker は source 全体と staged path の両方で同じ判定を行い、deleted file を安全に扱う。
- staged mode は path だけでなく source/package/CSS/directory state を Git index から読み、partially staged
  file や staged deletion 後の同名再作成で commit 対象の違反を見逃さない。
- 禁止対象は direct primitive dependency、literal theme color、general component の再実装、契約違反。
  レイアウト上必要な任意値をすべて色違反として誤検知する場合は、ルールを意味別に分けて test し、
  検査を弱めず false positive だけを除く。
- 例外 pragma は rule id と具体的 rationale を直前行に要求し、stale 例外を検出する。移行完了時に
  例外 inventory を review する。
- foundation は未移行領域の残存違反を report-only inventory にし、全 source の違反ゼロ gate は全画面
  移行後に有効化する。未移行箇所へ一時 allowance を付けない。
- Turbo の `^build` と clean hosted jobs の双方で `@gdgjp/ui/dist` が consumer より先に生成される。
  全 job で無条件に重複 build する構成は最終的に workflow test と実行時間を見て整理するが、clean
  checkout で暗黙の既存 dist に依存しないことを優先する。
- Wiki を changed-workspace E2E matrix の対象にし、clean CI 内で test-only `.dev.vars` を生成する。
  `global-setup` が local migration を適用してから決定的な admin/author/member/page fixture と署名済み
  storage state を生成できる順序を workflow test で固定する。実アカウント、共有開発 DB、手元に残った
  `.wrangler` state には依存しない。

## Protocols

### Shared package consumer contract

- Wiki は `@gdgjp/ui` の package root と公開 CSS export だけを参照し、`ui/src/**` や内部 class 構造を
  import しない。
- DOM component は native props/ref を透過し、Button は default `type="button"`、form submission は
  明示 `type="submit"` でのみ行う。
- controlled/uncontrolled state、`onOpenChange`、`onValueChange`、`onSelect` の意味は Radix 契約を保つ。
- Combobox は query/open/value/active option の controlled/uncontrolled 境界を文書化し、async 候補では
  consumer が filtering と loading/empty を所有できる。single-select の既定 close を維持しつつ、
  multi-select composition は選択後も入力を継続できる。
- overlay は accessible title/description を持ち、trigger がない controlled overlay は close 後の
  focus destination を明示する。
- loading は二重実行を防ぎ `aria-busy` または可視ラベルを持つ。error は解決箇所にも表示し、toast
  だけを唯一の error channel にしない。

### Wiki behavior invariants

- route URL、loader/action response、form `name`/`value`/`intent`、fetcher method/action、permission check、
  optimistic state、i18n key は UI 移行前後で不変とする。
- anonymous/member/author/admin の表示と操作権限は既存 contract を維持する。disabled に見せるだけで
  server authorization を代替しない。
- page action の copy/duplicate/move/archive、display preference、share、history restore、source refresh/
  archive/visibility、ingestion resume/clarify/commit、task CRUD/reorder/filter は既存 failure behavior を
  含めて保持する。
- editor の日英 title/content、manual/autosave intent、pending 中の dirty state、share 後の descendant sync、
  source batch staging の partial success、Google Picker handoff、task の未割当/期限 clear を保持する。
- mobile/desktop で同じ action set を提供し、surface の違いによって action が欠落しない。
- ja/en の文言と長い日本語で layout が破綻せず、翻訳ファイルを領域間で同期する。

### Error and exception behavior

- shared primitive が表現できない場合はローカル模倣で fallback せず、共有契約の gap として扱う。
- browser API failure（clipboard、storage、notification、file picker）は現在の user-visible error を保つ。
- portal/hydration failure、missing provider、unknown icon、invalid component prop は test/build 時に発見可能な
  failure とし、production で silent degradation させない。
- known contrast baseline は記録するが、新しい contrast/focus/ARIA failure の免責には使わない。

## Tests to add/update

### `@gdgjp/ui`

- public export と型: Wiki が使う新規/変更 component、variant、size、ref/native props を consumer code で
  compile する。
- component unit: controlled/uncontrolled state、default button type、loading/disabled、event forwarding、
  focus restoration、SSR deterministic output。
- Combobox unit/browser: client-filtered single select と async multi-select composition の双方で、controlled
  query、close policy、active option、端で停止する ArrowUp/ArrowDown、Home/End、Enter/Escape、
  `aria-activedescendant`、async 更新で active が消える場合を検証する。
- Storybook: default/disabled/loading/error/destructive、long Japanese、Light/Dark、narrow composition を追加。
- Playwright: menu/select/dialog/sheet/popover/tooltip の keyboard、Escape、focus、axe、reduced motion、
  forced colors と必要な visual snapshot。
- `build` 後に `test:consumer` を実行し、package export、CSS/font asset、SSR/Vite build を clean consumer
  として検証する。

### `wiki/`

- architecture test: shared CSS layer、単一 ThemeProvider、legacy UI directory 不在、禁止 direct import、
  app CSS の責務、例外 inventory を固定する。
- component test: migration で触れる form field/error、dialog/menu state、toolbar action、loading/disabled、
  domain color の非色ラベルを behavior 単位で追加・更新する。
- high-risk domain regression: editor manual/autosave snapshot、descendant sync handoff、source batch staging の
  failed-only retry、Google Picker callback、task empty sentinel と date clear/timezone round-trip を検証する。
- golden test: TipTap/Markdown の DOM 変更は意図した semantic wrapper だけを snapshot 更新し、content
  output の変化を許容しない。
- E2E: 既存 access-control/page-menu/sources-theme を維持し、代表 route matrix を扱う
  `ui-migration.spec.ts` を追加する。anonymous landing/legal、member shell/search/settings、author page
  edit/share/source/ingestion、admin task/admin を Light/Dark と mobile/desktop に割り当て、全 route の
  主要 heading、overflow、interactive smoke、console/hydration error を確認する。
- keyboard E2E: shell navigation、page/task action menu、share dialog、source dialog、admin destructive
  confirmation で Tab/Enter/Space/Escape と focus return を確認する。
- visual QA: representative screenshot を baseline と比較し、意図した design-system 差分だけを承認する。
- CI harness: Wiki を変更したとき E2E matrix に `wiki` が入り、secret ではない test-only env が生成され、
  fresh `.wrangler` state に migration → seed → server/test の順で実行されることを script/workflow test で
  固定する。

### 統合コマンド

実装時は少なくとも次を順に実行する。`test:consumer` は必ず UI build 後に行う。

```sh
pnpm ci:quick
pnpm --filter @gdgjp/ui run typecheck
pnpm --filter @gdgjp/ui test
pnpm --filter @gdgjp/ui build
pnpm --filter @gdgjp/ui run test:consumer
pnpm --filter @gdgjp/ui test:e2e
node scripts/check-ui-conventions.mjs --app wiki
pnpm -C wiki typecheck
pnpm --filter @gdgjp/wiki test
pnpm --filter @gdgjp/wiki build
pnpm --filter @gdgjp/wiki test:e2e
pnpm lint
```

`pnpm --filter @gdgjp/wiki typecheck` が wrapper の都合で「TypeScript: No errors found」にもかかわらず
non-zero になる環境では、実エラーを隠さず `pnpm -C wiki typecheck` で検証する。

最終 handoff は changed files、開始前/最終 inventory、library defect report、各 command の結果、未検証事項、
触れた各画面の4条件確認と intentional visual difference、画面別 commit を集約する。locale は ja/en key set
だけでなく使用箇所を照合し、移行で未使用になった key を両方から削除する。

## Tech Stack

- React 19、TypeScript ESM、React Router v7 SSR
- Cloudflare Workers/Vite、Tailwind CSS v4
- `@gdgjp/ui` private workspace package
- Radix primitives（`ui/` 内部のみ）、next-themes（`ui/` 内部のみ）
- shared semantic CSS tokens、stable `gdg-*` component classes、Google Sans/Noto Sans JP fonts
- lucide-animated based `Icons` contract（consumer は `@gdgjp/ui` 経由）
- Vitest、Testing Library、Storybook、Playwright、axe、visual snapshots
- pnpm workspace、Turborepo、Biome、repository UI convention checker
