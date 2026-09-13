# Unit 04 — Wiki ページ・共有・Editor UI の移行

## Context

全体計画は [`index.md`](index.md)、app foundation は
[`02-app-foundation-and-ci.md`](02-app-foundation-and-ci.md)。Unit 02 と Unit 03 の shell 完了後に着手し、
Unit 05/06 とは並行可能。

対象は Wiki read/edit/new/history/search/recent/archive、page action、page tree、right sidebar、comments、
reactions、share flow、TipTap/Markdown renderer、collaboration presence。page/ACL/editor domain logic は
`wiki/` に残し、操作 primitive、visual state、icon、overlay、form を `@gdgjp/ui` へ移す。

`app.css` の editor bridge 自体は Unit 02 が契約を確定する。この unit は必要な selector/token 要件を
満たしているか利用側から検証し、共通 CSS へ汎用 style を戻さない。

## External Goals

- 閲覧、検索、作成、編集、履歴、最近、アーカイブの全導線が shared UI で一貫する。
- page actions の copy/duplicate/move/archive/display preference と permission visibility が変わらない。
- share dialog の async search、複数 chip、general access、role/owner 変更、descendant sync が keyboard と
  pointer の両方で動く。
- editor/renderer が Light/Dark、mobile、共同編集、長文、code/table/image で読み書き可能なまま保たれる。
- comment/reaction/presence は dynamic identity color だけを狭く保持し、状態を色だけで伝えない。
- D&D page tree と mobile contents sheet が focus、touch target、reduced motion を保つ。

受け入れ条件:

- page/editor 領域に hand-written menu/dialog/popover/tooltip/outside-click primitive が残らない。
- shared Combobox が keyboard/listbox behavior を所有し、ShareDialog controller は候補取得・ACL・chip state
  だけを所有する。
- clipboard/storage/network failure の既存 user-visible feedback と再試行可能性が維持される。
- TipTap/Markdown content output、route/action/ACL contract、10-version retention 等の非 UI 挙動は不変。

## Design

### 画面単位の進行

search、recent、archived、history、read、new/edit、share compound flow のように route/screen 単位で進める。
各画面を Light/Dark の 390px/1280px で実ブラウザー確認し、intentional visual difference を一文で記録して
個別 commit にする。share の subcomponent は一つの画面 flow としてまとめてよいが、別 route は混ぜない。

### Page navigation and state surfaces

SearchView、RecentContent、StarredContent、ArchivedContent、recent/archive routes、PageTree、mobile contents を
shared PageHeader、Input/Select、Card/Item、Button/IconButton、DropdownMenu、Sheet、Skeleton/Spinner/EmptyState
で構成する。page tree の hierarchy、D&D sensor、optimistic reorder、active slug は app domain に残す。

### Page toolbar and actions

desktop/mobile の action set を一つの domain action model から構成し、shared Button/IconButton/
DropdownMenu/Tooltip/AlertDialog を表示 surface として使う。star、share、history、edit、copy、duplicate、
move、archive、small text、full width の permission と side effect を保持する。

destructive action は AlertDialog、設定 toggle は menu checkbox/switch semantics を使う。menu selection 時の
close/preventDefault、dialog 遷移、focus return を明示し、手組み popup を残さない。

### Share flow

Unit 01 の async/multi-select Combobox に controller の query/fetch/candidates/selection を接続する。
候補 item は stable id と `aria-selected` を持ち、Arrow navigation と pointer hover で同じ active state を
共有する。選択後は chip を追加して検索を継続でき、Escape は list/dialog の階層に応じて閉じる。

General access、role、ownership、descendant sync は shared Select/Radio/Alert/Dialog/Button/Avatar/Badge 等で
構成する。permission 説明や error を toast だけに隠さない。

権限変更成功かつ子孫がある場合は、share dialog を閉じてから descendant-sync dialog へ state と focus
chain を引き継ぐ。変更なし・失敗時は prompt を出さない。mutation 中は Escape/outside-click で閉じず、
`includeUnsynced` の選択、同期失敗後の再試行、最終 close 後の元 share trigger への focus return を保つ。

### Editor and collaboration

TipTap editor/renderer、Markdown editor は専門 engine の DOM/contenteditable を維持する。toolbar action、
language control、save state、image upload、history list は shared primitive を使う。theme は `useTheme` の
resolved value を外部 editor bridge に渡すが、mount 前後で document structure を変えない。

Presence avatar/cursor、reaction/tag の dynamic color は data contract を維持し、name/initial/icon/count で
意味を補う。reduced motion では decorative animation を止め、remote cursor の機能は維持する。

PageEditor は日英の title/content を常に同じ form snapshot で送り、manual save の `intent=save`、30秒
autosave の `intent=autosave`、言語切替をまたぐ dirty state を維持する。送信中に加えた編集を完了 response
だけで saved 扱いにせず、失敗時は内容を保持して再試行できる。

## Protocols

- page loader/action、form fields/intents、API endpoint、ACL decision、translation fallback を変更しない。
- copy は表示済み redacted content と language fallback を使い、raw hidden content を漏らさない。
- duplicate/move/archive は既存 authorization と subtree behavior を維持する。
- page-local/user-local display setting の key と isolation を維持する。
- share candidate fetching と permission mutation は Wiki controller 所有。shared Combobox は domain object を
  解釈しない。
- share mutation 成功時だけ descendant sync へ遷移し、mutation 中 close 抑止、`includeUnsynced`、retry、
  最終 focus return を保持する。
- controlled overlay は nesting order と focus return を持ち、mobile viewport 内で scroll できる。
- editor schema/content serialization と golden output は UI wrapper の都合で変更しない。
- manual/autosave は日英 title/content の送信 snapshot と intent を保持し、pending 中の追加入力を dirty の
  まま残す。
- dynamic color の例外は user/API data の行だけに置き、固定 UI 色を許可しない。

## Tests to add/update

- 既存 `page-menu.spec.ts` と `access-control.spec.ts` を shared component の role/accessible name に合わせつつ、
  behavior expectation は弱めない。
- Share Combobox: async loading/empty/error、ArrowUp/Down、Enter、Escape、multiple chips、remove、focus return、
  mobile scroll、owner transfer。
- descendant sync: 成功後のみ prompt、変更なし/失敗時は prompt なし、mutation 中 close 抑止、
  `includeUnsynced`、sync failure/retry、最終 trigger focus 復帰。
- page actions: permission matrix、clipboard/storage failure、duplicate/move/archive、display isolation。
- editor unit/golden: content DOM/serialization、theme bridge、toolbar disabled/loading、upload error、collab presence。
- editor save: 言語切替後の manual save が日英両 title/content と `intent=save` を送り、autosave が
  `intent=autosave` を送り、pending 中の追加入力、failure/retry、dirty/saved 表示を正しく扱う。
- page tree: keyboard/pointer navigation、D&D reorder、mobile Sheet、active/current semantics。
- Light/Dark、390px/1280px の各 touched screen screenshot と axe。
- console/hydration error と horizontal overflow を代表 page で検査する。

## Tech Stack

- React 19、React Router Form/fetcher/Await、react-i18next
- `@gdgjp/ui` Combobox/Dialog/AlertDialog/Sheet/Menu/Select/Button/Form/feedback/layout/icon components
- TipTap 3、Yjs、CodeMirror/Markdown editor、dnd-kit、emoji-picker（専門 engine として app 所有）
- Vitest、Testing Library、golden snapshots、Playwright、axe、visual snapshots
