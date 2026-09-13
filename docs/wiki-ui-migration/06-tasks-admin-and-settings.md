# Unit 06 — Tasks・Admin・Settings UI の移行

## Context

全体計画は [`index.md`](index.md)、app foundation は
[`02-app-foundation-and-ci.md`](02-app-foundation-and-ci.md)。Unit 02 と Unit 03 の shell 完了後に着手し、
Unit 04/05 とは並行可能。

対象は task list/table/timeline/detail/history/new/settings、team/assignee/dependency/date/filter controls、
`/admin/pages`、`/admin/tags`、`/settings`。現状は hand-written dropdown/popover/outside-click、native
visible form control、dense table action が多く、全面移行の主要残存領域である。

task CRUD/reorder、admin authorization、tag/page mutation、user preference action は変更しない。

## External Goals

- task の作成・編集・一覧・残件・table・timeline・history・settings が shared UI で一貫する。
- assignee/team/dependency/date/filter/menu が keyboard、pointer、touch で操作でき、手組み popup の focus
  問題がなくなる。
- admin page tree/tag table/dialog の status、destructive action、error が明確で mobile scroll できる。
- user settings の name/language/push/Discord field が label/description/error/loading/saved state を持つ。
- dense data UI でも Light/Dark、long Japanese、empty/loading、permission denied が読みやすい。

受け入れ条件:

- task/admin/settings の一般 dropdown/popover/dialog/select/date/button/input/table/badge/icon は
  `@gdgjp/ui` contract を使う。
- `app/features/tasks/components/DropdownMenu.tsx` の一般選択 behavior は shared Select/Combobox/Menu へ
  移し、domain-specific adapter だけが必要なら名前と責務を domain に限定する。
- `TaskDetailToolbar` など desktop/mobile action は同一 action model を使い、outside-click listener を
  Radix/shared overlay behavior で置き換える。
- admin/user action の method、field、intent、validation、authorization は不変。

## Design

### 画面単位の進行

task new、detail の各 view、task history、task settings、admin pages、admin tags、user settings を一画面ずつ
移行する。各画面を Light/Dark の 390px/1280px で実ブラウザー確認し、intentional visual difference を
一文で記録して個別 commit にする。task detail 内の view switch は一 route flow として扱える。

### Task controls and views

TaskCreateDialog、NewTaskRow、TaskRow、AssigneeCell、DepsDropdown、DatePickerDropdown、ColumnFilterPopover、
TeamManager、TaskDetailToolbar を shared Dialog/FormField/Input/Textarea/Select/Combobox/DatePicker/Popover/
DropdownMenu/Button/IconButton/Tooltip/AlertDialog で構成する。

task option、member/team/dep filtering、CRUD payload、optimistic update は app domain が所有する。shared
component に task status や member object を理解させない。選択 adapter は option id/label/content slot と
event を接続するだけにする。

既存 payload の未割当/チームなしは `""` または `null` だが、Radix Select item の空 value へ直接渡さない。
NativeSelect 等の空 option を正式に扱える control を選ぶか、UI 内だけの衝突しない sentinel を用い、
open/value 表示の境界で既存 `""`/`null` payload へ双方向変換する。sentinel を API/DB に送らない。

task 期限は既存 `YYYY-MM-DD | null` と Unit 01 で修正した DatePicker の local calendar `Date | undefined` を
境界 adapter で変換する。UTC midnight parsing による日ずれを避け、期限解除、server からの外部更新、
dialog close/reopen で stale value を残さない。

TaskList/Remaining/Table/Timeline/History は shared Table/DataTable/Card/Item/Badge/Skeleton/EmptyState/
PageHeader/Tabs を使い、table は自身の scroll region を持つ。row action と inline edit は keyboard focus を
失わず、mobile は機能を削らず別 surface へ再構成する。

team/presence/status の dynamic color は domain data として残し、text/icon/pattern で意味を併記する。

### Admin

admin pages/tags と PageTreeTable/TagTable/TagDialog を shared PageHeader/Table/Badge/Button/IconButton/
Dialog/AlertDialog/FormField/Input/Select/EmptyState で構成する。tree hierarchy、expand state、slug validation、
archive/restore/delete authorization は保持する。

destructive action は confirm surface と pending state を持ち、row 内 hidden input は native submit contract
として残せる。table caption/header scope と mobile overflow を整える。

### User and task settings

`/settings` と `/tasks/:slug/settings` は shared PageHeader/Card/Stack/Separator/FormField/Input/NativeSelect/
Select/Switch/Button/Alert を使う。save/saving/saved は loading button と accessible status で表し、3 秒後の
表示解除、i18n/localStorage 同期、server validation mapping を維持する。

## Protocols

- task API URL、fetcher method、optimistic state、reorder、filter meaning、date representation を変更しない。
- task/admin/user form の `name`、hidden field、intent、validation error key、redirect を維持する。
- admin route は server の `requireAdmin` を維持し、disabled/hidden UI で authorization を代替しない。
- shared overlay は open/value を controlled に接続でき、Escape/outside click/focus return を保持する。
- date control は既存保存形式と locale 表示境界を保つ。
- `YYYY-MM-DD | null` と local calendar date の変換は timezone で日付をずらさず、clear/外部更新/dialog
  再利用を controlled に反映する。
- 未割当/チームなしの UI sentinel は既存 `""`/`null` payload に戻してから送信し、空 value を Radix
  SelectItem に渡さない。
- dynamic team color は narrow exception と non-color label を持つ。固定 status 色は shared Badge tone を使う。
- table は semantic caption/header/scope を持ち、page 全体でなく table region が横 scroll する。
- primary action は screen ごとに一つを基本とし、danger は destructive confirmation に限定する。

## Tests to add/update

- task controls: create/edit validation、assignee/team/dep selection、search、date、filter、keyboard、Escape/focus。
- task empty selection: 選択済みから未割当/チームなしへ戻して保存し、sentinel が payload に漏れない。
- task date: `YYYY-MM-DD | null` round-trip、期限解除、外部更新、dialog reopen、JST/UTC 境界の日ずれ防止。
- task views: list/table/timeline/remaining/history の empty/loading/status、row action、reorder、mobile overflow。
- toolbar: desktop/mobile action parity、star/share/archive permission、focus return、double-submit prevention。
- admin: page tree expand/archive/restore/delete、tag create/edit/delete、validation error、non-admin denial。
- settings: field association、server errors、save/saving/saved、language/localStorage sync、push section composition。
- Light/Dark 390px/1280px screenshots: dense task table、timeline、task dialog、admin tables/dialog、settings。
- axe/keyboard と console/hydration error を task/admin/settings representative routes で検査する。

## Tech Stack

- React 19、React Router Form/fetcher、react-i18next
- `@gdgjp/ui` Table/DataTable/form/date/selection/overlay/action/feedback/layout/icon components
- dnd-kit と Wiki task domain adapters
- Vitest、Testing Library、Playwright、axe、visual snapshots
