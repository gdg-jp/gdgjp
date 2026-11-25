# Publish and the public view

The organizer publishes a sheet and shares its URL. Anyone with the URL reads the roster without
signing in; the page never shows email addresses or experience levels.

## Sub-features

- `roster-public-view` share page: `/e/:id/share` lists each sheet with 公開中 / 非公開 and its
  URL `/r/<viewToken>/s/<sheetId>`; details **本編の旧URLを確認** reveals the legacy `/r/<viewToken>`
  for the default sheet.
- Publication: **公開にする** / **非公開にする** on each sheet card at `/e/:id`. Visibility is per
  sheet and independent of the event ステータス.
- Public page: シフト表はまだ公開されていません。 while private; once published, the event and
  sheet heading, tabs **スタッフ別**, **役割別**, **個人**, and a search box. Unknown token 404.

## How to get to it (user POV)

Organizer: sidebar **共有**, or **共有画面へ** on `/e/:id`. Viewer: open the shared link.

## Driving it with Orca Browser

Preconditions: [roster-generate.md](roster-generate.md) has run on the default sheet, so both
applicants have assignments. Identities: `owner` for the share and publish steps, then a fresh
profile with no cookies (Anonymous) for every `/r/...` step.

- Share page while private. As `owner`, `goto /e/<id>/share`. Require heading **共有**, a 本編
  card with 非公開 and the text 非公開です。公開するまでURLからシフト表の内容は見られません。
  Record its `code` URL as the sheet path. Open **本編の旧URLを確認**, require
  本編の互換URL, and record the `details code` URL as the legacy path.
- Private view. Anonymous, `goto <sheet path>` and `goto <legacy path>`. Require
  シフト表はまだ公開されていません。 on both, the heading `Verify Roster Event — 本編`, and no
  applicant names. HTTP `GET` each without cookies and require 200.
- Publish. As `owner`, `goto /e/<id>`, click **公開にする** on the 本編 card. Require the card to
  show 公開 and **非公開にする**, and `1件公開中`. On `/e/<id>/staff` require ステータス unchanged.
  On `/e/<id>/share` require 公開中 on 本編.
- Published view. Anonymous, `goto <sheet path>`. Require the heading, a table in **スタッフ別**,
  and `verify-roster-staff (dev)`. Click **役割別** and require a table. Click **個人**, choose
  `verify-roster-staff (dev)` in the select, and require 休憩 / 担当なし rows and a
  `一緒に: … Proxy Staff2` line where both share a slot. Require no **懇親会** tab.
- Isolation. If the 懇親会 sheet exists and is still private, its URL from the share page shows
  シフト表はまだ公開されていません。 while 本編 is published.
- Unknown token. HTTP `GET` the sheet path with its last token character changed and require 404.

Independent check: HTTP `GET <sheet path>` with no cookies after publishing; require 200, the
event name, and that the body contains none of `@dev.local`, `リード`, `経験あり`, `初参加`.
Evidence: screenshots of the private message, the published staff view, and the 個人 view; the
saved HTTP body check.

## Gotchas

The event ステータス option 公開 does not publish anything; only the sheet card's **公開にする**
does. Copy URLs from the `code` elements rather than building them: the token is random and the
default sheet id contains a colon. The **コピー** buttons write to the clipboard and may fail
silently in an automated tab. The 懇親会 tab depends on the event's `has_party` flag, which no
screen can set, so it never appears.
