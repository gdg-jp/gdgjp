# Unit 01 — `@gdgjp/ui` library defect の解消

## Context

全体計画は [`index.md`](index.md)。`gdg-ui` の全面移行手順では、shared library に必要な capability が
欠ける場合、app 内 workaround を作らず library defect として別 task で先に解消する。

開始時に次の required API は source で存在を確認済みであり、defect ではない。

- `DropdownMenuRadioItem`
- `Stack align`
- `Button fullWidth`
- `FormField hideLabel`
- working `SidebarTrigger` を含む `AppShell`

一方、現在の Wiki WIP と `ui/` source の照合から、少なくとも3件の blocker が確認されている。

1. `ui/src/components/Combobox/Combobox.tsx:40,150,170`: reference は remote search を app 所有とするが、実装は
   internal query による client filtering を常に行い、単一選択後に常に close し、active option/
   `aria-activedescendant`/Arrow navigation を所有しない。ShareDialog の async multiple selection を shared
   keyboard contract のまま composition できない。
2. `ui/src/components/Icons/IconName.ts:450` と `Icons.tsx:66-74`: Wiki が直接 `lucide-react` から使う64 icon のうち、
   現 public `IconName` で確認できるのは34、30は未提供。直接 import を禁止する移行契約と両立しない。
3. `ui/src/components/DatePicker/DatePicker.tsx:144,167`: `value === undefined` を uncontrolled 判定にも使うため、
   controlled な空値を表現できない。期限を選択後に親が clear しても内部値が再表示され、Wiki の
   `string | null` 期限契約を保持できない。同じ判定は子の `Calendar.tsx:79,145` にもあり、DatePicker だけを
   修正しても Calendar の内部選択が stale になるため、同じ defect の companion fix として扱う。

依存: なし。Unit 02〜07 はこの library-only task の完了に依存する。この unit では `wiki/` の画面を
移行しない。修正後の app 接続と app-local keyboard/date/icon workaround の削除は後続 unit が担当する。

### 確認済み consumer evidence

- ShareDialog は `query`、remote fetch、selected chips、active index、list open、outside click、Arrow/Home/End/
  Enter を app 内で所有している。shared Combobox が引き取るのは listbox identity、active option、keyboard、
  focus、selection close policy までで、fetch/debounce/ACL/chip/domain state は引き取らない。
- Wiki の direct icon inventory は AST scan 時点で64種。既存 `IconName` にある34種に加え、次の30種が必要。

  `AlertCircle`, `AlertTriangle`, `BellDot`, `BellOff`, `CheckCircle2`, `Clipboard`, `ExternalLink`,
  `FileInput`, `FileQuestion`, `Folder`, `Globe`, `Globe2`, `Hash`, `LayoutList`, `Link2`, `ListChecks`,
  `ListFilter`, `ListTodo`, `Loader2`, `MoreHorizontal`, `MoveHorizontal`, `PanelLeft`, `Pencil`,
  `ServerCrash`, `Share2`, `Star`, `Tag`, `Trash2`, `Type`, `UserRound`.
- Wiki の icon usage は `size`、`className`、`aria-label`、`style` に加えて `strokeWidth` を使う。
  static source を追加しても、これらを app 側の selector や icon-source 判定なしで保持する。
- Wiki の task due date は `string | null` の local calendar date である。shared DatePicker との
  `Date | undefined` 変換は後続 unit の app adapter が所有し、timezone-aware timestamp へ変えない。
- `Command` は item collection を持つが、実 DOM focus を item へ移し、Arrow navigation を wrap する。
  input focus と `aria-activedescendant` を使い端で停止する Combobox とは異なるため、この unit で
  `Command` の公開挙動まで変更しない。共通化は identity/collection の内部 helper が安全に共有できる場合に限る。

## External Goals

- Wiki が app-local Radix/listbox/icon/calendar workaround を作らず、public `@gdgjp/ui` contract だけで
  移行できる。
- 既存の Combobox single-select consumer、既存 icon consumer、uncontrolled Calendar/DatePicker consumer を
  壊さない。
- async remote search、multiple-selection composition、keyboard/listbox semantics が library で再利用できる。
- Wiki で必要な semantic icon が shared wrapper を通り、animated/static の差を consumer が知らずに済む。
- DatePicker と Calendar が controlled/uncontrolled を明示的に区別し、controlled empty と外部
  clear/replace を保持する。

### 受け入れ条件

- Combobox は client-filtered single select と async/multiple composition の両方を公開 API で表現できる。
- `query`、`open`、selected `value`、active option は controlled/uncontrolled の両方を持つ。空値は query の
  `""` と value/active の `null` で明示し、internal state へ読み替えない。
- active option は現在表示中かつ enabled の option だけを参照する。stable id、
  `aria-activedescendant`、ArrowUp/ArrowDown/Home/End/Enter/Escape、Tab、pointer/keyboard 同期を shared
  behavior として検証する。
- client filtering、remote result 更新、item 削除・並べ替え、disabled 化、loading/empty/error 遷移の後も、
  存在しない option id が `aria-activedescendant` に残らない。
- 既定の `shouldFilter=true` と `closeOnSelect=true`、既存 `value/defaultValue/onValueChange`、既存 CSS class、
  single-select の selected indicator は変わらない。
- Wiki inventory の64 icon すべてが `IconName` の型と runtime resolution を通る。30種の static icon も
  意味の違う近似 icon へ置換せず、`Icon` suffix、size、style、stroke width、label/decorative semantics、
  ref handle を維持する。
- DatePicker で prop 未指定、controlled `value={undefined}`、選択、親からの clear/replace、Dialog が閉じている
  間の value 更新後の reopen が stale な input value、Calendar selection、表示月を残さない。
- Calendar 単体も `selected={undefined}` を controlled empty として扱い、`defaultSelected` を再表示しない。
- implementation、tracked JS counterpart、barrel export、CSS、story、unit/browser test、consumer、README、
  `DESIGN.md`、必要な `gdg-ui` component reference が同期する。
- library defect report の各項目に、修正 file/line、期待 behavior、回避していた app work、fix 後の workaround
  有効性を記録する。

## Library Defect Report

| current library evidence / planned files | 期待 behavior | 未修正なら必要な app work | fix 後の workaround |
| --- | --- | --- | --- |
| `Combobox.tsx:40,150,170`; `Combobox.tsx/.js`, story/test/E2E, `components.css` | remote filtering、controlled query、継続選択、stable active option、input-focus keyboard/listbox contract | ShareDialog が query filtering、outside click、item identity、Arrow/Home/End/Enter、focus を再実装 | 無効。fetch/domain/chips だけ app に残し、interaction workaround は shared behavior に置換して削除 |
| `IconName.ts:450`, `Icons.tsx:66-74`; icon type/registry/adapter/export/test/story/E2E | Wiki inventory 64種を同じ public type/runtime/ARIA/ref contract で表示 | 未収録30種を `lucide-react` から直接 import、または近似 icon へ置換 | 無効。direct icon dependency と source 分岐を削除し `Icons` に一本化 |
| `DatePicker.tsx:144,167`, `Calendar.tsx:79,145`; DatePicker/Calendar source/story/test/E2E | omitted prop と controlled empty、clear/replace、selected month、uncontrolled default を区別 | Wiki が custom Calendar/portal/focus handler を維持、または key remount で state を捨てる | 汎用 UI workaround は無効。`string \| null` と local `Date \| undefined` の純粋 adapter だけは app contract として残す |

## Design

### 1. Combobox public contract

既存 API に次の optional props を追加する。名称と default は実装、型 declaration、README、component
reference、story で同一にする。

| prop | 型 | default | ownership |
| --- | --- | --- | --- |
| `query` | `string` | なし | controlled input query |
| `defaultQuery` | `string` | `""` | uncontrolled query 初期値 |
| `onQueryChange` | `(query: string) => void` | なし | query 通知。network request は行わない |
| `activeValue` | `string \| null` | なし | controlled active option identity。`null` は active なし |
| `defaultActiveValue` | `string` | なし | uncontrolled active option 初期値 |
| `onActiveValueChange` | `(value: string \| null) => void` | なし | active option 変更通知 |
| `shouldFilter` | `boolean` | `true` | `false` なら rendered items を再 filter しない |
| `closeOnSelect` | `boolean` | `true` | `false` なら選択後も open/input focus を維持 |

`open/defaultOpen/onOpenChange` と `value/defaultValue/onValueChange` は現行 API を維持し、selected `value` には
後方互換な additive empty として `null` を許可する。各 state は `undefined` を uncontrolled、`false`/`""`/
`null` を controlled empty と判定する。mount 後に controlled/uncontrolled mode を切り替える使い方は非対応と
文書化し、必要なら development warning を出すが、mode switch を暗黙に state migration しない。

`ComboboxItem` の `value` は同一 Combobox 内で一意とする。item は `useId()` 由来または consumer が指定した
stable `id`、`value`、`disabled`、DOM ref を root collection に登録する。async reorder で mount 順が変わらない
場合にも対応するため、keyboard 操作時と reconciliation 時の順序は registration 順ではなく現在の DOM 順から
導出する。consumer ref と内部 ref は compose し、native button props/event を落とさない。

### 2. Combobox interaction state machine

- input が DOM focus を持ち続け、active item は `aria-activedescendant` で示す。option は
  `tabIndex={-1}` とし、Tab 順序に個別 item を追加しない。
- `aria-selected` は selected `value` と一致する item を表す。keyboard/pointer の active state は別の
  `data-active` attribute で表し、CSS は selected と active のどちらも識別可能にする。
- open/query/result/item state が変わったとき、現在の active item が表示中かつ enabled なら維持する。
  消失・非表示・disabled の場合は先頭の eligible item へ移し、eligible item がなければ `null` にする。
  closed 時は active state を clear し、再 open 時に先頭 eligible item を選ぶ。
- ArrowDown/ArrowUp は popup を開き、eligible items の範囲内で1件移動し、端で停止する。Home/End は open 中に
  先頭/末尾へ移動する。wrap はしない。
- Enter は open 中で、active id が現在も eligible collection に存在する場合だけ選択する。stale response や
  item removal 後の value を選択しない。
- Escape はまず Combobox popup だけを閉じ、選択や query を変更せず、親 Dialog へ同じ Escape を伝播しない。
  次の Escape は親 overlay の契約に委ねる。
- Tab/Shift+Tab は prevent せず、次/前の focusable element へ移動して popup を閉じる。single-select の
  select/close 後は Radix の trigger focus restoration を維持する。
- pointer move は enabled item を active に同期する。mouse/pen の primary pointer down は option 自体へ focus を
  移さず click selection を保持し、touch scroll は妨げない。disabled item は pointer/keyboard のどちらでも
  active/select しない。
- consumer の `onChange`、`onKeyDown`、`onPointerMove`、`onClick` を compose し、consumer が
  `preventDefault()` した event に shared default behavior を重ねない。

`ComboboxContent` は open 時に registered input を focus し、Radix が最初の button へ自動 focus するのを防ぐ。
button trigger + popup 内 input の既存構成では close 後に button へ戻し、input-as-trigger の composition では
input focus を維持する。`ComboboxInput` は open 中かつ active option が実在するときだけ
`aria-activedescendant` を出力し、`aria-controls` は実際の list id と一致させる。

`ComboboxEmpty` は root collection の現在の visible item 数が0のときだけ表示する。remote loading/error は
library state に取り込まず、consumer が `shouldFilter={false}` と条件分岐した `ComboboxEmpty` または適切な
`role="status"`/`role="alert"` content を composition する。library は debounce、request sequence、abort、ACL、
ShareSubject、selected chips を持たない。

### 3. Icon catalog and adapter

`lucide-animated` に存在する既存 icon を優先し、上記30種だけを `lucide-react` から明示 import した internal
static registry を追加する。namespace import で `lucide-react` 全 catalog を新しい public surface にせず、
registry key と `IconName` type を同じ source から導出または type assertion で相互検証する。

resolution は suffix を除いた base name を正規化し、animated registry、static registry の順に解決する。
どちらにもない場合は現行どおり明示的に throw し、silent fallback や意味の近い別 icon は使わない。
`IconName` と必要なら `IconBaseName` を `ui/src/components/Icons/index.ts` から public type export し、top-level
barrel から consumer が import できることを declaration/consumer test で固定する。

static icon は current `Icons` の outer `<div class="gdg-icons">` contract に adapter し、内側 SVG は
`aria-hidden`/non-focusable にする。accessible name と `role="img"` は outer wrapper が所有する。
`className`、HTML attributes、mouse events、`style`、`size` を animated icon と同じ場所へ渡し、Wiki の error
surface に必要な optional `strokeWidth` を wrapper の inheritable style と inner SVG の両方で検証する。

`animateOnHover` は animated icon では現行どおり動作し、reduced-motion では停止する。static icon では
accepted no-op とし、hover の有無で source を切り替えない。`IconsHandle.startAnimation/stopAnimation` は static
icon でも安全な no-op として同じ ref shape を返す。既存 icon の DOM、default size 24、event order、
labelled/decorative behavior を変えない。

### 4. DatePicker and Calendar controlled-empty contract

`DatePicker` は destructuring 前の props に `value` key が存在するかで controlled mode を確定する。

- uncontrolled: `value` prop がなく、`defaultValue` から internal value を初期化し、選択/clear で internal value を
  更新する。
- controlled non-empty: `value={date}` を唯一の committed value とし、選択/入力 commit は `onChange` で通知する。
- controlled empty: `value={undefined}` を空の committed value とし、過去の `defaultValue`/internal value を
  fallback 表示しない。

`inputValue`/`inputState` は編集中の draft として残すが、prop の clear/replace が来たら committed value を
優先して同期し、invalid state と pending selection を reset する。controlled consumer が `onChange` を受理せず
同じ value を維持した場合、commit 後の表示を prop value に戻し、未承認の draft を committed value に見せない。
uncontrolled input の既存 auto-format、全選択、Enter commit、Escape revert、min/max/disabled behavior は維持する。

`Calendar` も `selected` prop の key presence で controlled selection を判定する。DatePicker が
`selected={undefined}` を渡した場合に Calendar の `internalSelected` を使わず、過去の day button に
`aria-pressed=true` を残さない。Calendar 単体の `selected/defaultSelected/onSelect` contract も同じ規則で
document する。

DatePicker は Calendar の表示月を独立した local calendar month state として持つ。consumer が
`calendarProps.month` を controlled にしている場合はそれを優先し、それ以外では有効な external value の
replace 時に選択日の月へ同期する。clear 時は直前の表示月を維持し、再 open 時に stale な別 selection だけを
表示しない。`calendarProps.onMonthChange` は内部更新と compose し、consumer callback を落とさない。

日付生成・比較は既存どおり local year/month/day と正午を使い、ISO timestamp や UTC conversion を導入しない。
Wiki の `YYYY-MM-DD | null` adapter は後続 unit で `new Date(year, month - 1, day, 12)` と local component 取得に
限定し、この library unit へ Wiki domain type を持ち込まない。

### 5. Compatibility and non-goals

- 新規 props は optional とし、既存 story の client filtering、single selection、selected check、close behavior を
  regression fixture として残す。
- `Command` の roving focus/wrap behavior、Calendar の range/multiple selection、Popover の一般 contract は
  この unit で再設計しない。
- Combobox に fetch hook、debounce、virtualization、creatable domain item、chips state を追加しない。
- Icons に Wiki 固有 alias や business semantic name を追加せず、Lucide の同一 icon 名を公開する。
- DatePicker を timestamp/timezone picker にせず、Wiki の compact task-cell presentation も shared component に
  入れない。
- visual token の追加は予定しない。`data-active` styling は既存 selected/hover semantic token と motion token を
  再利用し、forced-colors と reduced-motion を維持する。

## Implementation Plan

### Phase 0 — Baseline and contract freeze

1. `git status --short`、staged/unstaged diff、対象 path の tracked JS を確認し、既存 Wiki WIP と無関係な
   `ui/` change を上書きしない。
2. AST で `wiki/app/**/*.{ts,tsx}` の `lucide-react` named imports を再収集し、64/34/30 inventory と usage props
   (`size`, `className`, `aria-*`, `style`, `strokeWidth`) を保存する。件数が変わっていれば本文と test fixture を
   同じ変更で更新する。
3. 現行の Searchable Combobox、Icons、DatePicker、Calendar story を実ブラウザーで開き、single select close、
   filtering motion、icon markup、date text focus/format を compatibility baseline として記録する。
4. focused test を修正前に実行し、既知の package-wide failure と今回の regression を分けられる状態にする。

### Phase 1 — Combobox behavior

1. `Combobox.tsx` に controlled/uncontrolled query/active state、item collection、DOM-order sort、eligible-item
   reconciliation を追加する。既存 open/value state も同じ controlledness rule に揃える。
2. Input/Content/Item の ref と event を compose し、input-focus + active-descendant keyboard state machine、
   `closeOnSelect`、`shouldFilter`、disabled、automatic empty visibility を実装する。
3. `components.css` は current filtered-item exit animationを保持し、`data-active`、disabled、forced-colors、
   reduced-motion に必要な差分だけを加える。
4. existing Searchable story を互換 fixture のまま残し、Remote、Loading、Empty、Error、Multiple chips、
   Disabled/Reordered、Long Japanese の stateful stories を追加する。
5. SSR/type unit test と `e2e/combobox.spec.ts` を追加し、下記 test matrix を通してから次 phase へ進む。

### Phase 2 — Icon catalog

1. 30種の explicit static registry と type coverage を追加し、`IconName` の base/suffix union と runtime map を
   一致させる。
2. `Icons.tsx` に animated/static adapter resolution、static no-op handle、stroke width forwarding を追加し、
   existing animated path の event/reduced-motion behavior を保持する。
3. `Icons/index.ts` と package barrel から `IconName` を type export し、consumer fixture で64種、suffix、unknown
   compile failure boundary を確認する。
4. unit test は64種すべての runtime render、animated/static の代表、unknown error、decorative/labelled markup、
   props/ref を検証する。story/E2E は animated hover、static no-motion、reduced-motion、Light/Dark を分ける。

### Phase 3 — DatePicker and Calendar state

1. `Calendar.tsx` の controlled selection 判定を prop presence に変更し、single/multiple/range の既存 selection
   algorithm と uncontrolled default を維持する。
2. `DatePicker.tsx` の committed value と draft input state を分離し、controlled empty、親 clear/replace、
   rejected change、uncontrolled update の同期順を実装する。
3. Calendar 表示月の local/controlled ownership を整理し、external replace、clear、Dialog close/reopen を通して
   selected day と表示月が矛盾しないようにする。
4. Controlled lifecycle story を追加し、Clear、Replace、Unmount/Remount、Dialog を閉じている間の value 更新後の
   reopen を story 内の control から再現できるようにする。既存 Default story は uncontrolled compatibility
   fixture として残す。
5. Calendar/DatePicker の SSR/type unit と Playwright を追加し、local date が `TZ=UTC` と
   `TZ=Asia/Tokyo` のどちらでも同じ year/month/day として扱われることを確認する。

### Phase 4 — Contract synchronization and final gate

1. TypeScript source を正とし、現在 tracked されている対応 `.js` files を同じ behavior へ同期する。
   無関係な generated JS を一括再生成・削除しない。
2. `ui/README.md`、`ui/DESIGN.md`、`gdg-ui` の Combobox/Icons/Calendar/DatePicker references に public props、
   controlled-empty rule、keyboard/focus、static icon no-op animation を記録する。
3. `ui/consumer/App.tsx` または専用 type fixture に new props と全 icon name を package root import だけで使用する
   example を追加する。内部 path import は使わない。
4. focused checks、build、consumer、Storybook、Playwright を順に実行し、visual snapshot が変わる場合は
   Light/Dark × 390/1280 の差分を目視して意図を記録する。
5. 最終 diff を acceptance criteria と defect report に逆照合し、`wiki/` に implementation change が混入して
   いないこと、Unit 02〜07 が public API だけで着手可能なことを確認する。

## Expected File Changes

| area | files | planned change |
| --- | --- | --- |
| Combobox source | `ui/src/components/Combobox/Combobox.tsx`, tracked `Combobox.js` | public props、collection、active state、keyboard/focus、filter/close policy |
| Combobox style | `ui/src/styles/components.css` | `data-active`、disabled、forced-colors/reduced-motion。既存 filter exit motion は維持 |
| Combobox coverage | `Combobox.stories.tsx/.js`, new `Combobox.test.tsx/.js`, new `ui/e2e/combobox.spec.ts` | compatibility、remote/multiple、async mutation、keyboard、axe |
| Icons source | `IconName.ts`, `Icons.tsx`, tracked `Icons.js`, optional internal static registry | 30 static names、resolver、adapter、stroke width、no-op handle |
| Icons exports/coverage | `Icons/index.ts/.js`, `Icons.test.tsx/.js`, `Icons.stories.tsx/.js`, `ui/e2e/icons.spec.ts` | public type、64-name runtime/type、animated/static browser contract |
| Date source | `DatePicker.tsx/.js`, `Calendar.tsx/.js` | prop-presence controlled state、draft sync、selected/month reconciliation |
| Date coverage | DatePicker/Calendar stories and tracked JS, new or updated unit tests, `ui/e2e/date-picker.spec.ts`, `ui/e2e/calendar.spec.ts` | clear/replace/reopen、uncontrolled、constraints、local date |
| package contract | `ui/src/components/index.ts/.js`, `ui/src/index.ts`, `ui/src/index.test.tsx/.js`, `ui/consumer/App.tsx` | intended exports と package-only compile/SSR fixture |
| documentation | `ui/README.md`, `ui/DESIGN.md`, `.agents/skills/gdg-ui/references/components/{combobox,icons,calendar,date-picker}.md` | source と public guidance の同期 |

barrel files は既存 export で足りる場合に意味のない touch をしない。ただし `IconName` の public type export と
consumer compile fixture は必須とする。新規 `.js` counterpart の作成要否は実装開始時の tracked state に従い、
TSX だけ変更して既存 tracked JS を stale にしない。

## Test Matrix

### Combobox

| case | assertion |
| --- | --- |
| existing default | client filtering、selected check、item click 後 close、trigger focus return |
| controlled query | typing は `onQueryChange`、rerender は prop が正、外部 `""` replace を反映 |
| remote mode | `shouldFilter=false` で server result を query により再 filter しない |
| multiple composition | `closeOnSelect=false` で popup/input focus を維持し、app が chip/query/result を更新できる |
| initial/open navigation | open 時は先頭 eligible、Arrow は端で停止、Home/End は先頭/末尾、wrap しない |
| disabled | active/Enter/pointer selection の対象外、`aria-disabled` と visual state が一致 |
| async removal | active item の削除・非表示・disabled 化で先頭へ reconcile、0件なら active clear |
| async reorder | active value が残れば同一 identity を保持し、次の Arrow は新しい DOM 順を使う |
| stale Enter | `aria-activedescendant` が存在しない瞬間を作らず、0件時 Enter は no-op |
| Escape/Tab | 1回目 Escape は popup のみ close、Tab は自然な順序で移動、親 Dialog を誤って閉じない |
| pointer | hover/move と keyboard active が同期し、click 時に不意に input focus を失わない |
| accessibility | input name、controls/expanded/activedescendant、listbox/option、axe、forced-colors |
| responsive/theme | long Japanese、loading/empty/error、Light/Dark、390px で viewport overflow なし |

### Icons

| case | assertion |
| --- | --- |
| inventory | 64 base names と `Icon` suffix が public `IconName`/package import を通る |
| runtime | 34 animated + 30 static が同じ `Icons` entry point で render できる |
| unknown | type boundary と runtime error の両方で silent fallback しない |
| props | default/custom size、className、data attrs、style、strokeWidth、mouse handler を保持 |
| accessibility | labelled outer wrapper は `role=img`、decorative は `aria-hidden`、inner SVG は重複露出しない |
| animation | animated hover は動く、static は no-op、reduced-motion は animated も停止 |
| ref | animated は start/stop、static は同じ methods の安全な no-op |
| theme | currentColor が Light/Dark で一致し、selected `Star` の fill style を保持 |

### DatePicker and Calendar

| case | assertion |
| --- | --- |
| uncontrolled | omitted `value` + `defaultValue`、input edit、Calendar select、clear が internal state を更新 |
| controlled empty | `value={undefined}` は空 input/selection。`defaultValue` や過去の internal selection を出さない |
| parent clear | selected date から `undefined` へ変えると input、`aria-pressed`、invalid draft が clear |
| parent replace | 別日・別月へ変えると input、selected day、非 controlled 表示月が同期 |
| rejected change | parent が value を変えなければ未承認 draft/Calendar click を committed 表示に残さない |
| reopen/reuse | Dialog を閉じている間に親が clear/replace した value を reopen 時に表示し、前回 state を復活させない |
| Calendar direct | `selected={undefined}` と omitted `selected` を区別し、uncontrolled `defaultSelected` は維持 |
| constraints | min/max/function/array disabled、disabled control、invalid text の既存 behavior を維持 |
| input | 全選択、numeric auto-format、`/` suppression、Enter/Escape、open 中 input focus を維持 |
| date zone | UTC/Tokyo で local year/month/day と format が変わらない。timestamp behavior は追加しない |

## Protocols

- `ui/` は routing、network request、Wiki ACL/subject/chip type、i18n resource を import しない。
- Combobox は accessible name を consumer から受け、listbox/option id と active state を安定させる。既存の
  Japanese fallback label は互換のため維持できるが、new examples は明示的な localized label を渡す。
- remote mode では library が候補を再 filter せず、consumer result をそのまま表示する。
- Enter は現在表示中かつ enabled の active option だけを選択する。候補更新後に存在しない
  `aria-activedescendant` を残さず、active 不在時の Enter は何も選択しない。
- selection close policy の既定は後方互換、multiple continuation は明示 opt-in とする。
- `Icons` は unknown name を silent fallback せず、装飾 icon の `aria-hidden`、labelled icon の role を保持する。
- static icon のために consumer が `lucide-react` を import したり、animation 対応を分岐したりしない。
- DatePicker/Calendar は controlled empty/replace を internal state より優先し、uncontrolled usage を壊さない。
- app-side direct icon import、copied keyboard handler、custom calendar remount は一時 fallback としても追加しない。
- current filtered-item motion を保持する場合、hidden item は `aria-hidden`、`inert`、`tabIndex=-1` を同時に持つ。
- keyboard interaction と reduced-motion は transform を使わず即時、pointer filter motion は既存 120ms token を使う。

## Validation Commands

focused development checks:

```sh
rtk pnpm --filter @gdgjp/ui exec vitest run \
  src/components/Combobox/Combobox.test.tsx \
  src/components/Icons/Icons.test.tsx \
  src/components/Calendar/Calendar.test.tsx \
  src/components/DatePicker/DatePicker.test.tsx
rtk pnpm --filter @gdgjp/ui typecheck
rtk pnpm --filter @gdgjp/ui build
rtk pnpm --filter @gdgjp/ui test:consumer
rtk pnpm --filter @gdgjp/ui build:storybook
rtk pnpm --dir ui exec playwright test \
  e2e/combobox.spec.ts e2e/icons.spec.ts e2e/calendar.spec.ts e2e/date-picker.spec.ts
```

final package gate:

```sh
rtk pnpm --filter @gdgjp/ui test
rtk pnpm --filter @gdgjp/ui test:e2e
rtk pnpm exec biome check \
  ui/src/components/Combobox \
  ui/src/components/Icons \
  ui/src/components/Calendar \
  ui/src/components/DatePicker \
  ui/e2e
rtk git diff --check
```

`test:consumer` は必ず `build` 後に行う。`pnpm --filter @gdgjp/ui typecheck` が TS5096 wrapper/configuration
baseline で失敗する checkout では、原因を確認した上で `ui/` から `rtk pnpm exec tsc --noEmit` を追加実行し、
wrapper failure と source error を分けて報告する。Playwright は stale Storybook port を再利用せず、full suite の
既知 failure と focused regression を分離する。

## Library Defect Report at Handoff

| library file | 期待 behavior | 回避すると必要になる app work | fix 後の workaround |
| --- | --- | --- | --- |
| `ui/src/components/Combobox/Combobox.tsx:76-358,388-678`（tracked `Combobox.js`、`components.css`） | remote filtering、controlled query/value/active、継続選択、listbox keyboard/focus | ShareDialog が listbox identity、keyboard、focus、outside click を再実装 | 無効。shared behavior に置換して削除。検証: [`Combobox.test.tsx`](../../ui/src/components/Combobox/Combobox.test.tsx)、[`combobox.spec.ts`](../../ui/e2e/combobox.spec.ts) |
| `ui/src/components/Icons/IconName.ts:1-480`, `Icons.tsx:73-189`, `StaticIcons.ts:1-69`（tracked JS、barrel） | Wiki の64 semantic icon を同じ public wrapper/type/ref から利用 | 30種を直接 import、近似 icon へ置換、または source 別に分岐 | 無効。shared wrapper に一本化して direct dependency を削除。検証: [`Icons.test.tsx`](../../ui/src/components/Icons/Icons.test.tsx)、[`icons.spec.ts`](../../ui/e2e/icons.spec.ts) |
| `ui/src/components/DatePicker/DatePicker.tsx:20-333`, `Calendar/Calendar.tsx:58-267`（tracked JS） | controlled empty、外部 clear/replace、uncontrolled default、selected/month sync | Wiki が custom calendar/date dropdown、remount key、stale-state guard を維持 | 無効。shared DatePicker と app の date adapter に置換して削除。検証: [`DatePicker.test.tsx`](../../ui/src/components/DatePicker/DatePicker.test.tsx)、[`Calendar.test.tsx`](../../ui/src/components/Calendar/Calendar.test.tsx)、[`date-picker.spec.ts`](../../ui/e2e/date-picker.spec.ts) |

handoff 時は実際の変更後 line を記入し直し、期待 behavior を test 名へ link する。追加 defect が見つかった場合も、
library file/line、期待 behavior、必要だった app workaround、fix 後に workaround が有効かを同じ表へ追記する。
未解消項目が1件でもあれば Unit 01 を完了にせず、Unit 02〜07 の blocker を解除しない。

## Tech Stack

- React 19、TypeScript ESM
- `@gdgjp/ui` component-first source/export structure
- Radix Popover と shared Calendar composition
- `lucide-animated`、library-internal `lucide-react` static registry
- stable `gdg-*` CSS、semantic tokens、forced-colors、reduced-motion media query
- Vitest、Storybook、Playwright、axe、consumer TypeScript/Vite build
