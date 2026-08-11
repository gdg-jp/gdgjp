# Connpass HTML fixtures

Place saved HTML snapshots of real connpass admin pages here. The Playwright
selectors in `app/lib/connpass-ui/` treat these as the primary source of truth.

## Required files

| File | Page |
|---|---|
| `login.html` | `https://connpass.com/login/` |
| `group-home.html` | `https://<group>.connpass.com/` (logged in as group admin, showing 「イベントを作成」) |
| `event-create-dialog.html` | Title dialog after clicking create |
| `event-edit.html` | `https://connpass.com/event/<id>/edit/` |
| `event-publish.html` | Publish confirmation UI |
| `group-events.html` | `https://<group>.connpass.com/event/` (event list cards) |

Optional: sibling `*.meta.md` with URL, capture date, and notes.

## Capture tips

1. Open the page while logged in as the bot (or an equivalent admin).
2. Save complete HTML (or copy `document.documentElement.outerHTML`).
3. Mask personal data if needed (emails, names of participants).

Until these files exist, selector unit tests skip fixture assertions and drivers
use Japanese label-based fallbacks from the public organizer help docs.
