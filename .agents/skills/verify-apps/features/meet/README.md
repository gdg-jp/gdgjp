# Meet feature map

Meet (`apps/meet`, `meet.gdgs.jp`) lets chapter members create Google Meet meetings on a shared
host account (`community-support@gdgoc.jp`) without the password: Meet space, Calendar event,
co-host and participant registration, and automatic sharing of recordings, transcripts and
Gemini notes.

Drive these journeys in the stack started by [verify-apps](../../scripts/verify-apps.mjs) at
`http://localhost:6193` (Vite dev with wrangler local bindings, fresh local D1, no seed rows).
Every journey starts as `NOT VERIFIED`; a recipe here is not execution evidence.

Local limits that shape the whole map:

- No Google connection exists and none can be made: `.dev.vars` has no `GOOGLE_CLIENT_SECRET`
  or `GOOGLE_TOKEN_ENCRYPTION_KEY`, so OAuth is "not configured". Every button that calls a
  Google API (**会議を作成**, **変更を保存**, **チャプターから再同期**, **会議を取り消す**,
  **Google アカウントを接続**, **購読を今すぐ確認・更新**) renders disabled.
- The `ACCOUNTS` and `ACCOUNTS_DIRECTORY` service bindings point at `gdgjp-accounts-e2e`, which is
  not running unless the helper was started with `--accounts`. Chapter names fall back to
  `チャプター #<id>` (lists, detail) or the chapter slug (create form), and anything that lists
  chapter members fails with a visible message.
- Meetings only exist when seeded into local D1 (see [meeting-detail.md](meeting-detail.md)).

## Identities

Sign-ins use the local-only `/dev/login` route (gdg-lib `handleDevLogin`). The user id is
`dev-user-<as>`, the email `<as>@dev.local`, the display name `<as> (dev)`. A chapter value is
`<id>:<slug>[:member]`; without `:member` the role is organizer. `chapter=none` (or `0:none`)
yields no chapter; omitting `chapter` yields `1:dev-chapter` organizer. `admin=1` sets `isAdmin`.

| Identity | Sign-in path | Reaches |
| --- | --- | --- |
| Anonymous | none | `/api/auth/me` (`{"user":null}`), static assets; every screen 302s to `/signin` |
| `member` (helper fixture) | `/dev/login?as=verify-meet&chapter=1:dev-chapter&return_to=<path>` | `/`, `/meetings/new`, meetings it created or is invited to; 403 on `/admin/google` |
| `no-chapter` | `/dev/login?as=verify-meet-nochapter&chapter=none&return_to=<path>` | `/` without **新しい会議**, `/no-chapter`; `/meetings/new` redirects to `/no-chapter` |
| `admin` | `/dev/login?as=verify-meet-admin&chapter=1:dev-chapter&admin=1&return_to=<path>` | everything, including `/admin/google` and every meeting |
| `participant` | `/dev/login?as=verify-meet-guest&chapter=1:dev-chapter:member&return_to=<path>` | seeded meetings where it is a participant (view only) |

Only `member` is defined in `apps.mjs`; the other rows are ad hoc `/dev/login` URLs on the same
origin. Use a separate isolated Orca profile per identity: the session cookie
`gdgjp-meet-session` is per origin, so a second `/dev/login` in the same profile replaces it.
The helper's `member` uses chapter `1:dev-chapter` with no suffix, so it is an organizer.

## Routes

| Route | Who can reach it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` 会議一覧 | Any signed-in user; anonymous 302 to `/signin?return_to=%2F` | **新しい会議** (chapter members only), meeting row links, sidebar 会議一覧 / Google 接続設定 (admin), account menu **ログアウト**, **テーマを切り替える** | Heading **GDG Japan Meet**; alert 共有 Google アカウントが未接続です; empty **まだ会議がありません**; sections 今後の会議 / 過去の会議 with status badge 作成中 / 有効 / 作成失敗 / 取り消し済み |
| `/meetings/new` | Signed in with a chapter; chapterless 302 to `/no-chapter` | Form 基本情報, 主催チャプターとアクセス設定, 自動記録設定 checkboxes, 追加の招待先 (**他チャプターを追加**, email textareas, **人数を確認**), **キャンセル**, **会議を作成** | Heading **新しい会議を作成**; unconnected alert; **会議を作成** disabled; preview counts or 招待者数の確認エラー |
| `/meetings/:id` | Creator, any invitee, or admin; others and unknown ids get 404 | Cohosts/admin on active meetings: **編集**, **チャプターから再同期**, **会議を取り消す** (dialog); **Google Meet に参加**, **Google カレンダーで開く** when links exist | 会議情報, ご利用上の注意, 参加状況・会議統計, 生成ファイル, 招待者; status alerts (取り消し済み, 作成失敗, 作成中, メンバー同期の警告); flash alerts from `?updated=1` etc. |
| `/meetings/:id/edit` | Cohost invitee or admin on an `active` meeting; participant 403, non-active 409, unrelated 404 | Prefilled form, **人数を確認**, **キャンセル**, **変更を保存** | Heading **会議を編集**; 編集時のご注意; **変更を保存** disabled while unconnected |
| `/admin/google` | Admin only; non-admin 403 (アクセスできません) | **Google アカウントを接続**, **購読を今すぐ確認・更新**, per failed artifact **再試行** | Google OAuth 環境変数が未設定です; badge 未接続; Workspace Events 購読状態 with 未登録; 失敗・未完了の生成ファイルジョブ (0 件); flash from `?status=connected` or `?error=<code>` |
| `/admin/google/callback` | Admin only | Google OAuth redirect target | Always redirects to `/admin/google?status=connected` or `?error=<code>` |
| `/no-chapter` | Signed-in users without a chapter; members 302 to `/` | **チャプターに参加する** (Accounts `/onboarding`) | Heading **GDG チャプターへの参加が必要です** |
| `/signin` | Anyone | none | 302 to `/api/auth/signin`, which starts OIDC against Accounts |
| `/auth/signout` | Anyone | none | Clears `gdgjp-meet-session`, 302 to `/signin` |
| `/api/auth/*` | OIDC plumbing; `/api/auth/me` returns the session user as JSON | none | not a screen |
| `/api/google/events` | Google Pub/Sub Push only (JWT verified) | none | 405 on GET |
| `/dev/login` | Local only (404 unless `APP_URL` is loopback) | fixture sign-in | 302 to `return_to` |
| `/dev/simulate-event` | Local only; POST a Pub/Sub envelope JSON | none | JSON `{ ok, action }`; 405 on GET |
| Unknown path | Anyone | none | Root error page **ページが見つかりません** (404) |

## Journeys

| Journey ID | Feature | Identity | Recipe | Status |
| --- | --- | --- | --- | --- |
| `meet-access` | Anonymous gate, chapter gate, `/no-chapter` both ways, sign-out | Anonymous, `no-chapter`, `member` | [access.md](access.md) | In map |
| `meet-admin-gate` | Non-admin 403 on `/admin/google` and its callback | `member` | [access.md](access.md) | In map |
| `meet-home` | Empty list, unconnected alert, **新しい会議** visibility, theme toggle, static logos | `member`, `no-chapter` | [meetings.md](meetings.md) | In map |
| `meet-create-form` | Create form defaults, 自動記録設定 toggles, disabled submit, add-chapter row | `member` | [meetings.md](meetings.md) | In map |
| `meet-invitee-preview` | **人数を確認** counts and validation errors; directory-failure message | `member` | [meetings.md](meetings.md) | In map |
| `meet-meeting-list` | Seeded upcoming and past meetings on `/` with badges and fallbacks | `member` | [meeting-detail.md](meeting-detail.md) | In map |
| `meet-meeting-detail` | Seeded meeting detail, invitees, disabled Google actions, status alerts, 404 | `member`, `participant` | [meeting-detail.md](meeting-detail.md) | In map |
| `meet-meeting-edit` | Edit form prefill, disabled save, participant 403, canceled 409 | `member`, `participant` | [meeting-detail.md](meeting-detail.md) | In map |
| `meet-admin-google` | Admin connection page in the unconfigured state, callback error flashes | `admin` | [admin-google.md](admin-google.md) | In map |
| `meet-create-meeting` | Actually creating a meeting (Meet space, Calendar event, member sync) | `member` | none | Outside: needs a connected shared Google account and live Meet/Calendar APIs; submit is disabled locally |
| `meet-edit-resync-cancel` | Saving edits, chapter resync, cancellation | cohost | none | Outside: every path calls Google Calendar/Meet; buttons are disabled while unconnected |
| `meet-google-connect` | Shared host OAuth connection and token refresh | `admin` | none | Outside: real Google OAuth; OAuth is not configured locally, so the button is disabled |
| `meet-workspace-events` | Pub/Sub Push to `/api/google/events`, subscription create/renew | none | none | Outside: requires a Google-signed OIDC JWT and the Workspace Events API |
| `meet-simulate-event` | `/dev/simulate-event` envelope handling | HTTP only | none | Outside: no UI; it skips only Pub/Sub delivery and JWT verification, and every conference or artifact event then calls the Meet API with the (missing) Google token (see [admin-google.md](admin-google.md) Gotchas) |
| `meet-artifacts-share` | Artifact fetch, Drive sharing, Calendar attachment, **再試行** | `admin` | none | Outside: Meet and Drive APIs; queue jobs fail without a Google token |
| `meet-conference-stats` | Attendance and speaker statistics | invitee | none | Outside: collected from the Meet API by queue jobs; only the empty card is local (covered in `meet-meeting-detail`) |
| `meet-oidc-signin` | Real sign-in through Accounts OIDC | Accounts session | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
