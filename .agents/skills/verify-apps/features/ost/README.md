# OST feature map

OST (`apps/ost`, `ost.gdgs.jp`) supports Open Space Technology sessions: participants submit
and vote on topics, organizers show them on a projector, merge them, lay out desks and
auto-assign top-voted topics. Each event's live state is one `OstBoard` Durable Object.

Drive these journeys in the stack started by [verify-apps](../../SKILL.md) with `--app ost`
at `http://localhost:6185` (built Worker preview, fresh D1 and Durable Object state). The
helper seeds `verify-ost` (title `Verify OST`) and `verify-ost-layout` (`Verify Layout`) in
chapter `1:dev-chapter` through `/dev/seed`. Fresh state avoids the stale-vote failure that a
reused `.wrangler/state/v3/do` causes. Every journey starts as `NOT VERIFIED`.

## Identities

| Identity | How | Reaches |
| --- | --- | --- |
| Anonymous participant | isolated profile, no session | `/<slug>`; gets an `ost-voter` cookie on first vote |
| `owner` | fixture login (`as=verify-owner`, `1:dev-chapter`) | dashboard, `/<slug>/screen`, `/tables`, `/edit` for chapter 1 events |
| `outsider` | fixture login (`as=verify-outsider`, `2:other-chapter`) | dashboard without chapter 1 events; 403 on their admin pages |

## Routes

| Route | Who | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | chapter member | form **イベント名**, **URL（ost.gdgs.jp/◯◯◯）**, **チャプター**, **作成する**; per event links **参加者ページ**, **スクリーン**, **机の割り当て**, **設定** | `まだイベントがありません。`; alert `URL「<slug>」は既に使われています。` |
| `/:slug` | anyone | textbox with placeholder `例: Cloudflare Workers でリアルタイム機能をどう作る？`, **送信する**, **投票する** dialog (**テーマに投票**, one **👍** per topic, **閉じる**), **もう一つ投稿する** | `話したいテーマは？`; `送信しました 🎉`; 404 for unknown or reserved slugs |
| `/:slug/screen` | chapter member | drag a card onto another to merge; tap a stack to spread; **このテーマをグループから外す**; **このテーマを削除**; **すべてクリア** | `ライブ` or `再接続中…`; `テーマを募集中…`; `N 票`; `まとめて N 票 ・ タップで展開` |
| `/:slug/tables` | chapter member | none | each desk (`机`) with its topics; `未割り当て` |
| `/:slug/edit` | chapter member | **机を追加**, drag a desk, **サイズ変更**, **回転**, **机を削除**, **自動割り当て**, **割り当てクリア**, **割り当てを表示**, topic **削除**, **すべて削除** | `テーマ（N）` |
| `/signin`, `/api/auth/*`, `/auth/signout`, `/no-chapter`, `/dev/login`, `/dev/seed` | plumbing | none | `GDG チャプターへの参加が必要です` on `/no-chapter` |

## Journeys

| ID | Feature | Identity | Recipe | Map |
| --- | --- | --- | --- | --- |
| `ost-gate` | Admin pages need sign-in | anonymous | [access](access.md) | local |
| `ost-chapter-isolation` | Another chapter cannot see or open the event | outsider | [access](access.md) | local |
| `ost-unknown-event` | Unknown slug is 404 | anonymous | [access](access.md) | local |
| `ost-dashboard` | Create an event, duplicate slug | owner | [access](access.md) | local |
| `ost-submit-topic` | Submit a topic, seen live on the screen | participant, owner | [participant](participant.md) | local |
| `ost-vote` | Vote, retract, persist per device | participant, owner | [participant](participant.md) | local |
| `ost-screen-merge` | Merge, spread and ungroup cards | owner | [screen](screen.md) | local |
| `ost-screen-delete` | Delete one topic, clear all | owner | [screen](screen.md) | local |
| `ost-layout-editor` | Add and resize desks, persist | owner | [layout](layout.md) | local |
| `ost-desk-rotate` | Rotate a desk | owner | [layout](layout.md) | local |
| `ost-auto-assign` | Auto-assign by votes, tables view | owner | [layout](layout.md) | local |
| `ost-oidc-signin` | Real Accounts sign-in | owner | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
