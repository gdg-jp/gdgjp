# Unit 05 — Ingestion・Sources・連携・通知 UI の移行

## Context

全体計画は [`index.md`](index.md)、app foundation は
[`02-app-foundation-and-ci.md`](02-app-foundation-and-ci.md)。Unit 02 と Unit 03 の shell 完了後に着手し、
Unit 04/06 とは並行可能。

対象は `/ingest`、`/ingest/:sessionId`、`/analyze`、ingestion component 群、`/sources`、Google Docs/Drive、
Google Chat、Discord、ZIP import、notification bell、push toggle。長時間処理、file input、nested dialog、
warning/error、realtime update が多く、見た目の統一と同時に状態の明確さを守る必要がある。

Worker orchestration、source driver、queue、API、OAuth scope は変更しない。

## External Goals

- ingest の入力、確認、clarification、URL 選択、処理中、review、commit/error が shared state component で
  一貫し、現在地と次の操作が分かる。
- source 一覧、filter、visibility、refresh、archive、Google/Discord/Chat 接続が keyboard/mobile で使える。
- file/ZIP/Google import は progress、cancel、validation、failure、retry を失わない。
- notification bell と push setting は unread/loading/permission/error state を色だけに頼らず表現する。
- Light/Dark と長い日本語で warning、dialog、list、operation diff が読め、nested overlay の focus が正しい。

受け入れ条件:

- 一般 dialog/select/popover/button/input/progress/alert/toast/icon は `@gdgjp/ui` を使う。
- native file input など必要な browser control は残せるが、visible label、description、error、focus style を
  shared FormField contract で包む。
- realtime reconnect と loader authoritative state、import/refresh/archive の side effect は不変。
- Google Chat reauthorization warning など既存 semantic warning contract を維持する。

## Design

### 画面単位の進行

ingest start、analyze、ingest session、sources、各 import dialog、notification surface を一画面/flow ずつ
移行する。各画面を Light/Dark の 390px/1280px で実ブラウザー確認し、intentional visual difference を
一文で記録して個別 commit にする。独立 route を同じ commit にまとめない。

### Ingestion state machine UI

IngestInputScreens、InputPanel、ProcessingScreen、ChangesetReview/OperationCard、PageStructurePreview、
SensitiveReviewModal と route surface を、shared PageHeader/Card/Stack/Inline/FormField/Input/Textarea/Select/
Button/Alert/Progress/Spinner/Skeleton/Badge/Dialog/AlertDialog で構成する。

domain state machine と polling/realtime event はそのまま app controller が持つ。shared component は
phase 名や operation type を知らず、状態・tone・label・action slot だけを受け取る。

processing は visual spinner だけでなく `aria-live`/labelled status を持つ。sensitive data confirmation は
明示 action/cancel と focus containment を持つ。operation edit control は native form contract を保つ。

### Sources and integrations

SourceList/ListItem/Toolbar、AddSourceSection、ChatSender/Discord dialogs、Google document import、ZIP dialog を
shared Table/Item/Card/Badge、Select/Combobox、Dialog/Popover/DropdownMenu、Button/IconButton、Alert/Toast で
構成する。visibility/status の domain label と dynamic chapter/team data は app 側に残す。

Drive/Chat/Discord/URL の staging は mixed-source candidate list、重複防止、候補編集/削除、共通
visibility/chapter と `create-batch` payload を維持する。partial success では `addedIds` だけを除去し、失敗
候補と個別 error は retry 用に保持する。`enqueue_failed` は登録自体は成功した candidate として除去する。

nested dialog や OAuth popup/return flow は close reason と focus destination を明示する。archive/refresh 等の
destructive/long-running action は disabled/loading で二重実行を防ぎ、error は行または dialog に残す。

Google Picker は通常の nested overlay として扱わない。Picker 表示前に app Dialog を閉じるが import state を
reset せず、PICKED/CANCEL callback または起動失敗後に dialog を再表示し、直前の選択と focus destination を
復元する。app Dialog の focus trap と外部 Picker を同時に active にしない。

### Notifications

NotificationBell は shared Popover、IconButton、Badge/Item、Button、Spinner/EmptyState を使う。mark-read と
navigation の順序、unread count、auto-dismiss behavior を維持する。PushNotificationToggle は shared Switch
を使い、browser permission が denied/unavailable/error の場合に可視説明を出す。

## Protocols

- ingestion API、Agents SDK/Workflow/realtime event、D1 authoritative loader の優先順位を変更しない。
- form field name、multipart/file payload、URL list、operation edit payload、commit intent を維持する。
- source refresh/archive/unarchive/visibility と OAuth/Drive/Discord callback URL を変更しない。
- batch staging は candidate identity、共通 visibility/chapter、`create-batch` payload、partial-success の
  `addedIds` 除去、failed candidate/error 保持、`enqueue_failed` 除去を維持する。
- loading 中の action は二重送信を防ぎ、cancel/retry availability を既存仕様どおり保つ。
- toast は完了通知に使えるが、修正が必要な validation/network error は該当 surface にも表示する。
- native file input は accept/multiple/name/ref と browser security model を保持する。
- overlay stack は Escape が最上位だけを閉じ、focus を起点へ戻す。
- Google Picker handoff 中は app Dialog を閉じたまま state を保持し、PICKED/CANCEL/起動失敗で再表示と
  focus を復元する。
- notification permission は browser result が正本で、Switch の見た目だけを先行させない。

## Tests to add/update

- ingestion component: phase/state/tone、clarification、URL selection、operation edit、sensitive confirm、loading/
  retry/error、double-submit prevention。
- source component: status/visibility、refresh/archive failure、filter/select、empty/loading、long labels。
- source staging: mixed Drive/Chat/Discord/URL、duplicate prevention、candidate edit/delete、batch payload、
  partial success 後の failed-only retry、`addedIds` と `enqueue_failed` の除去規則。
- import dialogs: file validation、Google/Discord/Chat async loading/error、nested Escape/focus return、mobile scroll。
- Google Picker browser callback: Dialog close without reset、PICKED/CANCEL/launch failure 後の再表示、selection
  persistence、focus restoration、focus-trap conflict 不在。
- notification: unread badge、mark-read/navigation、empty/error、push permission granted/denied/unavailable。
- E2E: representative ingest resume/clarify/commit smoke、sources warning/theme、dialog keyboard、mobile overflow。
- Light/Dark 390px/1280px screenshots: input、processing、review、sources table、reauthorization warning、
  notification popover。
- Worker/domain tests は UI import の影響を受けず従来どおり通ることを確認する。

## Tech Stack

- React 19、React Router loader/action/fetcher、react-i18next
- `@gdgjp/ui` form/overlay/feedback/data/layout/icon components
- Agents SDK client state、Workflow/realtime events、browser file APIs
- Google/Discord integration UI（protocol/domain は Wiki 所有）
- Vitest、Testing Library、Playwright、axe、visual snapshots
