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
   現 public `IconName` で確認できるのは34、30は未提供。欠ける例は `MoreHorizontal`、`Pencil`、`Share2`、
   `Star`、`Trash2`、`FileQuestion`、`BellDot`、`ListFilter`。直接 import を禁止する移行契約と両立しない。
3. `ui/src/components/DatePicker/DatePicker.tsx:144,167`: `value === undefined` を uncontrolled 判定にも使うため、
   controlled な空値を表現できない。期限を選択後に親が clear しても内部値が再表示され、Wiki の
   `string | null` 期限契約を保持できない。

依存: なし。Unit 02〜07 はこの library-only task の完了に依存する。この unit では `wiki/` の画面を
移行しない。修正後の app 接続は後続 unit が担当する。

## External Goals

- Wiki が app-local Radix/listbox/icon workaround を作らず、public `@gdgjp/ui` contract だけで移行できる。
- 既存の Combobox single-select consumer と既存 icon consumer を壊さない。
- async remote search、multiple-selection composition、keyboard/listbox semantics が library で再利用できる。
- Wiki で必要な semantic icon が shared wrapper を通り、reduced-motion と accessibility contract に従う。
- DatePicker が controlled/uncontrolled を明示的に区別し、controlled empty と外部 clear を保持する。

受け入れ条件:

- Combobox は client-filtered single select と async/multiple composition の両方を公開 API で表現できる。
- active option、stable id、`aria-activedescendant`、ArrowUp/ArrowDown/Enter/Escape、pointer/keyboard 同期を
  shared behavior として検証する。
- Wiki inventory の64 icon すべてに、意味を変えずに使える shared public path がある。
- DatePicker で未指定、選択、親からの clear/replace、dialog 再利用が stale internal value を表示しない。
- implementation、barrel export、CSS、story、unit/browser test、consumer、README、必要な DESIGN/skill
  reference が同期する。
- library defect report の各項目に、修正 file/line、期待 behavior、回避していた app work、fix 後の workaround
  有効性を記録する。

## Design

### Combobox defect

既定の single-select/client-filtering contract は互換維持する。その上で、query/open/value/active option を
controlled/uncontrolled に接続でき、consumer が remote result と loading/empty state を所有できる境界を
追加する。選択後 close は既定のまま、multiple composition では継続入力を opt-in できる。

候補取得、debounce、ACL、domain object、selected chip 配列は library に入れない。library は listbox/input/
item の identity、keyboard active state、selection event、close policy だけを所有する。

active option は現在表示中かつ enabled の option だけを参照する。remote response、filter、chip 追加、
並べ替え、削除で active item が消えた場合は、存在しない id を保持せず clear または documented policy で
再選択する。Wiki の既存 ShareDialog に合わせ、ArrowUp/ArrowDown は端で停止し、Home/End は先頭/末尾へ
移動する。別の既存 consumer に wrap contract がある場合は explicit option として両立させる。

### Icon catalog defect

`Icons` の public name contract が Wiki の semantic icon inventory を満たすよう、library 内部で animated/
static source の違いを吸収する。consumer に `lucide-react` または `lucide-animated` の直接 import を要求せず、
既存 `IconName`、unknown-name failure、size、HTML attributes、ref behavior、decorative/label semantics、
reduced-motion contract を保つ。

icon が animation 非対応でも、意味の違う近似 icon へ置換しない。静的表示を shared wrapper 内で提供し、
animation の有無を consumer の業務ロジックにしない。

### DatePicker controlled-empty defect

controlled/uncontrolled 判定を値の有無から分離し、controlled consumer が `undefined` など documented empty
value を渡して選択を解除できるようにする。uncontrolled default、入力、Calendar、min/max/disabled、
`onChange(Date | undefined)` の既存 contract を維持する。timezone-aware timestamp picker には拡張しない。

### Documentation and compatibility

public props/type の追加は optional とし、既存 story/consumer の markup と behavior を壊さない。reference と
source が一致するよう更新し、breaking change が避けられない場合は migration guidance を明示する。

## Protocols

- `ui/` は routing、network request、Wiki ACL/subject/chip type、i18n resource を import しない。
- Combobox は accessible name を consumer から受け、listbox/option id と active state を安定させる。
- remote mode では library が候補を再 filter せず、consumer result を表示する。
- Enter は現在表示中かつ enabled の active option だけを選択する。Arrow は documented edge policy、
  Home/End は先頭/末尾、Escape は popup contract に従い、Tab/focus return を壊さない。
- 候補更新後に存在しない `aria-activedescendant` を残さず、active 不在時の Enter は何も選択しない。
- selection close policy の既定は後方互換、multiple continuation は明示 opt-in とする。
- `Icons` は unknown name を silent fallback せず明示 failure とし、装飾 icon の `aria-hidden` を保持する。
- DatePicker は controlled empty/replace を internal state より優先し、uncontrolled usage を壊さない。
- app-side direct icon import や copied keyboard handler は一時 fallback としても追加しない。

## Tests to add/update

- Combobox unit: controlled/uncontrolled query/open/value、client/remote filtering、close policy、empty/loading。
- Combobox browser: ArrowUp/Down の端停止、Home/End、Enter、Escape、disabled item、pointer/keyboard 同期、
  `aria-activedescendant`、focus return、single/multiple composition、axe。
- Combobox async update: active item の filter/削除/並べ替え、loading/empty への遷移、存在しない active id
  での Enter、response race 後の active policy。
- Storybook:既存 searchable single select、remote loading/empty/error、multiple chip composition、long Japanese、
  narrow viewport、Light/Dark。
- Icons unit/type: Wiki の64-name inventory が public type/runtime resolution を通り、unknown name は明示 error。
- Icons browser/story: labelled/decorative、animated/static、hover、reduced-motion、Light/Dark。
- DatePicker unit/browser: controlled empty、選択後 clear、外部 replace、dialog reopen、uncontrolled default、
  min/max/disabled と timezone の影響を受けない local calendar date。
- UI full: typecheck、unit、build、`test:consumer`、Storybook Playwright/axe/visual。

## Tech Stack

- React 19、TypeScript ESM
- `@gdgjp/ui` component-first source/export structure
- Radix Popover/listbox composition、lucide-animated と library-internal icon source
- stable `gdg-*` CSS、semantic tokens、reduced-motion media query
- Vitest、Storybook、Playwright、axe、consumer TypeScript/Vite build
