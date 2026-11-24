# Meeting list, detail, and edit

Users see the meetings they created or were invited to, split into 今後の会議 and 過去の会議. A
meeting page shows its schedule, access type, recording settings, links, invitees, statistics,
and generated files. Co-hosts get edit, resync, and cancel controls; participants get a
read-only page; everyone else gets 404.

## Sub-features

- `meet-meeting-list`: `/` rows link to `/meetings/<id>`, show `<schedule>（Asia/Tokyo） · チャプター #1`
  and a status badge 有効 / 取り消し済み / 作成失敗 / 作成中.
- `meet-meeting-detail`: heading = meeting title, badge, **会議一覧へ戻る**, 会議情報 (日時, 主催チャプター,
  アクセスの種類, 自動記録設定, Meet URL, 会議コード, 説明), **Google Meet に参加** and
  **Google カレンダーで開く**, ご利用上の注意, 参加状況・会議統計, 生成ファイル, 招待者. Co-hosts on an
  active meeting see **編集**, **チャプターから再同期** (disabled), **会議を取り消す** (disabled) and the
  alert 共有 Google アカウントが接続されるまで、会議の編集・再同期・取り消しを実行できません。 Status
  alerts: この会議は取り消し済みです, 会議の作成に失敗しました (with `last_error`), 会議を作成しています.
- `meet-meeting-edit`: `/meetings/<id>/edit` heading **会議を編集**, description = title,
  編集時のご注意, prefilled form with fixed 主催チャプター text, **変更を保存** disabled.

## How to get to it (user POV)

From `/` click a meeting title. On the detail page click **編集**. Links from Calendar
descriptions also point at `/meetings/<id>`.

## Driving it with Orca Browser

Preconditions: the helper is ready. Seed D1 once, before the journeys, from the snapshot's
`apps/meet` directory (`<scratch>/apps/meet`, `scratch` from `ready.json`), with
`pnpm exec wrangler d1 execute gdgjp-meet-db --local --command "<sql>"` and this SQL:

```sql
INSERT INTO meetings (id, host_chapter_id, title, description, start_at, end_at, time_zone,
  access_type, meeting_uri, meeting_code, calendar_html_link, status, last_error,
  created_by_user_id, created_by_email, created_at, updated_at, canceled_at,
  auto_transcription, auto_smart_notes, auto_recording) VALUES
 ('verify-upcoming', 1, '検証 定例ミーティング', '検証用の説明', '2030-01-15T01:00:00.000Z',
  '2030-01-15T02:00:00.000Z', 'Asia/Tokyo', 'RESTRICTED', 'https://meet.google.com/abc-defg-hij',
  'abc-defg-hij', 'https://calendar.google.com/calendar/event?eid=verify', 'active', NULL,
  'dev-user-verify-meet', 'verify-meet@dev.local', '2026-11-01T00:00:00.000Z',
  '2026-11-01T00:00:00.000Z', NULL, 1, 1, 0),
 ('verify-past', 1, '検証 過去の会議', '', '2025-10-01T01:00:00.000Z', '2025-10-01T02:00:00.000Z',
  'Asia/Tokyo', 'TRUSTED', NULL, NULL, NULL, 'active', NULL, 'dev-user-verify-meet',
  'verify-meet@dev.local', '2025-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z', NULL, 0, 0, 1),
 ('verify-canceled', 1, '検証 取り消し済み', '', '2030-02-01T01:00:00.000Z',
  '2030-02-01T02:00:00.000Z', 'Asia/Tokyo', 'RESTRICTED', 'https://meet.google.com/xyz-abcd-efg',
  'xyz-abcd-efg', NULL, 'canceled', NULL, 'dev-user-verify-meet', 'verify-meet@dev.local',
  '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 0, 0, 0),
 ('verify-failed', 1, '検証 作成失敗', '', '2030-03-01T01:00:00.000Z', '2030-03-01T02:00:00.000Z',
  'Asia/Tokyo', 'RESTRICTED', NULL, NULL, NULL, 'failed', 'Calendar API error (verify)',
  'dev-user-verify-meet', 'verify-meet@dev.local', '2026-11-01T00:00:00.000Z',
  '2026-11-01T00:00:00.000Z', NULL, 0, 0, 0),
 ('verify-hidden', 1, '検証 非公開の会議', '', '2030-04-01T01:00:00.000Z',
  '2030-04-01T02:00:00.000Z', 'Asia/Tokyo', 'RESTRICTED', NULL, NULL, NULL, 'active', NULL,
  'dev-user-someone-else', 'someone@dev.local', '2026-11-01T00:00:00.000Z',
  '2026-11-01T00:00:00.000Z', NULL, 0, 0, 0);
INSERT INTO meeting_invitees (meeting_id, email_normalized, email, display_name, user_id, role,
  source_kinds) VALUES
 ('verify-upcoming', 'verify-meet@dev.local', 'verify-meet@dev.local', 'verify-meet (dev)',
  'dev-user-verify-meet', 'cohost', '["creator"]'),
 ('verify-upcoming', 'verify-meet-guest@dev.local', 'verify-meet-guest@dev.local', 'Verify Guest',
  'dev-user-verify-meet-guest', 'participant', '["email"]'),
 ('verify-upcoming', 'external@example.com', 'external@example.com', NULL, NULL, 'participant',
  '["email"]'),
 ('verify-past', 'verify-meet@dev.local', 'verify-meet@dev.local', 'verify-meet (dev)',
  'dev-user-verify-meet', 'cohost', '["creator"]'),
 ('verify-canceled', 'verify-meet@dev.local', 'verify-meet@dev.local', 'verify-meet (dev)',
  'dev-user-verify-meet', 'cohost', '["creator"]'),
 ('verify-failed', 'verify-meet@dev.local', 'verify-meet@dev.local', 'verify-meet (dev)',
  'dev-user-verify-meet', 'cohost', '["creator"]');
INSERT INTO meeting_invite_sources (id, meeting_id, kind, chapter_id, email, role, created_at)
VALUES ('verify-src-1', 'verify-upcoming', 'email', NULL, 'verify-meet-guest@dev.local',
  'participant', '2026-11-01T00:00:00.000Z'),
 ('verify-src-2', 'verify-upcoming', 'email', NULL, 'external@example.com', 'participant',
  '2026-11-01T00:00:00.000Z');
```

Require `SELECT COUNT(*) FROM meetings` = 5 afterwards and record the command receipt.

- List. As `member` (`/dev/login?as=verify-meet&chapter=1:dev-chapter&return_to=/`), require
  heading 今後の会議 with links **検証 定例ミーティング**, **検証 取り消し済み**, **検証 作成失敗** in
  start order, heading 過去の会議 with **検証 過去の会議**, badges 有効 / 取り消し済み / 作成失敗,
  `チャプター #1` in each row, and no **検証 非公開の会議**. Screenshot.
- Detail as co-host. Click **検証 定例ミーティング**. Require URL `/meetings/verify-upcoming`,
  level-1 heading **検証 定例ミーティング**, badge 有効, links **Google Meet に参加**
  (`href` `https://meet.google.com/abc-defg-hij`) and **Google カレンダーで開く**, 主催チャプター
  `チャプター #1`, アクセスの種類 制限付き（招待者のみ）, 自動記録設定 `文字起こし: オン`,
  `Gemini Notes: オン`, `録画・チャット保存: オフ`, 会議コード `abc-defg-hij`, 説明 `検証用の説明`,
  the notice 録画・チャット保存がオフのため、Google Meet のチャット履歴は保存されません。…, 参加状況・会議統計
  with 会議の開催記録はまだありません。会議終了後に自動で集計されます。, 生成ファイル with its empty hint,
  and 招待者 `合計 3 名（共同主催者 1 名 / 参加者 2 名）` with a 作成者 badge. Require link **編集**
  enabled and buttons **チャプターから再同期** and **会議を取り消す** disabled, plus the warning
  **共有 Google アカウントが未接続です**. Do not click Meet or Calendar links.
- Status alerts. `goto /meetings/verify-canceled`: require badge 取り消し済み, alert
  **この会議は取り消し済みです**, no **編集** link, no **Google Meet に参加** link. `goto
  /meetings/verify-failed`: require **会議の作成に失敗しました** with `Calendar API error (verify)`
  and no **編集** link.
- Not visible. `goto /meetings/verify-hidden` and `/meetings/nope`; require `404` and
  **ページが見つかりません** for both.
- Edit. `goto /meetings/verify-upcoming`, click **編集**. Require URL
  `/meetings/verify-upcoming/edit`, heading **会議を編集**, 編集時のご注意, 会議タイトル value
  `検証 定例ミーティング`, 日付 `2030-01-15`, 開始時刻 `10:00`, 終了時刻 `11:00`, 主催チャプター text
  `チャプター #1`, the host-organizer checkbox unchecked, 個別に招待する参加者のメールアドレス containing
  `verify-meet-guest@dev.local` and `external@example.com`, and **変更を保存** disabled. Click
  **キャンセル**; require `/meetings/verify-upcoming`. HTTP `GET /meetings/verify-canceled/edit` with
  the member cookie; require 409.
- Participant. In a new profile,
  `goto /dev/login?as=verify-meet-guest&chapter=1:dev-chapter:member&return_to=/meetings/verify-upcoming`.
  Require the heading, no **編集**, no **チャプターから再同期**, no unconnected warning, and the
  invitee list. `goto /meetings/verify-upcoming/edit`; require `403` and **アクセスできません**.
  `goto /`; require **検証 定例ミーティング** listed and **検証 過去の会議** absent.

Independent check: with a `curl -c` member jar, `GET /meetings/verify-upcoming` returns 200, its
body contains `abc-defg-hij`, and its `referrer-policy` header is `no-referrer`; `GET
/meetings/verify-hidden` returns 404. With a participant jar, `GET /meetings/verify-upcoming/edit`
returns 403.
Evidence: the seed receipt, screenshots of the list, the co-host detail, the canceled and failed
alerts, the edit form, and the participant view.

## Gotchas

Seeded rows stand in for meetings that only Google-backed creation can produce; they prove
rendering and access rules, not creation. Keep the seed dates far from today: a row is
"upcoming" while `end_at >= now`. Chapter names show `チャプター #1` because the Accounts
directory is unreachable. The participant identity must keep the email `verify-meet-guest@dev.local`,
since view access matches invitees by normalized email. Avatars fall back to a person icon: the
directory RPC is absent and the seeded users have no `image`. Do not submit **変更を保存** by
HTTP; `updateMeeting` calls Google Calendar.
