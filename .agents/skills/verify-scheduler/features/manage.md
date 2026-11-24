# Owner management

The signed-in owner of an event can edit its title, description, meeting length,
and weekly ranges, remove any participant (with undo), and soft-delete the event.
Editing keeps availability for slots whose day and start time are unchanged. Other
users and anonymous visitors see none of these controls, and the server refuses
their requests.

## Sub-features

- `scheduler-edit` edits the owner event and keeps a participant's pick on an
  unchanged slot while dropping picks on removed slots.
- `scheduler-owner-boundaries` refuses edit, delete, and participant removal to a
  non-owner, and sends an anonymous visitor on an edit URL to sign-in.
- `scheduler-owner-remove-participant` removes a participant from the table and
  restores them with `Undo`.
- `scheduler-delete` confirms, soft-deletes the event, returns to `My events`, and
  makes the event URL return 404.

## How to get to it (user POV)

- On an owned event page `/e/<id>`, choose `Edit` (to `/e/<id>/edit`) or `Delete`.
- In the `Who's available` table header, choose `Remove <name>` beside a participant.
- `GET /e/<id>/delete` redirects to `/e/<id>`; deletion is a POST from the dialog.

## Driving it with Orca Browser

Preconditions: the helper is ready, the seed is applied, and `scheduler-create-owner`
has recorded `<owner-id>` (`Verify owner sync`, 1 hour, Mon to Fri 19:00–22:00).
`scheduler-anon-identity` has already run.

- **Participant before edit.** Navigate to the `verify-other` login URL with
  `return_to=%2Fe%2F<owner-id>`. The page has no `Edit` or `Delete` button. Check
  `Mon 19:00` and `Fri 21:00`, choose `Join`, and wait for `Joined event`. Record the
  slot IDs: `SELECT id, day_of_week, start_time FROM event_slots WHERE event_id =
  '<owner-id>' AND ((day_of_week = 0 AND start_time = '19:00') OR (day_of_week = 4 AND
  start_time = '21:00'))`.
- **Edit.** Navigate to the `verify-owner` login URL with `return_to=%2Fe%2F<owner-id>`.
  Choose `Edit`. Require the heading `Edit event`, the textbox `Title` holding
  `Verify owner sync`, `Meeting length` showing `1 hour`, Mon to Fri at 19:00–22:00,
  and the preview `15 slots (60 min each)`. Replace `Title` with
  `Verify owner sync edited`. Fill `Description (optional)` with `Edited by the run.`
  Choose `Remove time range for Fri`; the preview reads `12 slots (60 min each)`. Choose
  `Save changes`. The URL returns to `/e/<owner-id>`, with the heading
  `Verify owner sync edited` and the new description. The `verify-other (dev)` column
  shows `Available` on `Mon 19:00`. No `Fri` row remains. Independent read:
  `SELECT title, description, updated_at >= created_at FROM events WHERE id = '<owner-id>'`
  shows the new values. `SELECT COUNT(*) FROM event_slots WHERE event_id = '<owner-id>'`
  returns 12, and the recorded `Mon 19:00` slot ID still exists. A query for the
  `verify-other` participant's availability returns only that slot ID. Choose `Edit`
  again, then the first `Cancel`; the tab returns to `/e/<owner-id>` with no change.
- **Non-owner page.** As `verify-owner`, open `/e/evt_0VERFYSCHEDXFRGN0000000001`. Require
  no `Edit`, no `Delete`, and no `Remove Seed Guest` button. Open
  `/e/evt_0VERFYSCHEDXFRGN0000000001/edit`. The framework error page heading begins
  with `403`. Independent read: with the owner jar, `curl -s -o /dev/null -w
  '%{http_code}'` for that edit path returns `403`.
- **Non-owner writes.** With the `verify-other` jar, send
  `curl -s -o /dev/null -w '%{http_code}' -b <scratch>/other.jar -H 'Origin: http://localhost:6168'
  --data-urlencode 'title=Hijacked' -d slot_minutes=60 -d day_0_start=09:00 -d day_0_end=10:00
  http://localhost:6168/e/<owner-id>/edit`, which returns `404`. Send `-X POST` to
  `/e/<owner-id>/delete`, which returns `404`. Send
  `-d intent=admin-delete-participant -d participantId=<verify-other participant id>`
  to `/e/<owner-id>`, which returns `403`. Independent read: the event's title is still
  `Verify owner sync edited`, `deleted_at` is null, and the participant row remains.
- **Anonymous edit URL.** In an anonymous profile, open `/e/<owner-id>/edit`. Require a
  redirect to `/signin?return_to=%2Fe%2F<owner-id>%2Fedit`. Independent read:
  `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'` returns `302` with that
  location.
- **Remove participant and undo.** Navigate to the `verify-other` login URL with
  `return_to=%2Fe%2Fevt_0VERFYSCHEDXFRGN0000000001`. Require `Edit`, `Delete`,
  `Remove Seed Guest`, and `Remove verify-other (dev)`. Choose `Remove Seed Guest`.
  Wait for the toast `Removed Seed Guest`. The `Seed Guest` column is gone, and
  `Mon 19:00` totals 1. Choose `Undo` in the toast. Wait for `Participant restored`. A
  `Seed Guest` column returns, after `verify-other (dev)`, with `Mon 19:00` available.
  Independent read: `SELECT id, user_id, edit_token_hash FROM event_participants WHERE
  event_id = 'evt_0VERFYSCHEDXFRGN0000000001' AND display_name = 'Seed Guest'` returns
  one row whose `id` is not 9201, whose `user_id` is null, and whose hash differs from
  the seeded hash. Its availability is slot 9101 only.
- **Delete.** As `verify-owner` on `/e/<owner-id>`, choose `Delete`. An alert dialog
  titled `Delete this event?` shows `The event and all participant availability will be
  removed.` Choose `Cancel`; the dialog closes and the event remains. Choose `Delete`,
  then `Delete event`. The tab lands on `/events`, and no `Verify owner sync edited` card
  remains. Open `/e/<owner-id>` and require the `404` error page. Independent read:
  `SELECT deleted_at IS NOT NULL FROM events WHERE id = '<owner-id>'` returns 1, and
  the `event_slots` and `event_participants` rows for that ID still exist. Soft delete
  keeps them.

## Gotchas

- A non-owner edit or delete POST returns 404, not 403, while a non-owner edit GET
  returns 403. Assert each status separately.
- Undo after an owner removal recreates the participant with a new ID. An anonymous
  participant also gets a new token hash that no cookie holds, so the original guest
  can no longer edit their response. The seeded guest cookie is useless afterwards.
- The restore request carries the removed participant's `userId` from the form. The
  server trusts any value the owner submits.
- Changing `Meeting length` changes most slot start times. Every slot whose day and
  start time changed loses its availability, which is the intended reconciliation.
- The edit page has two `Cancel` links with the same name. Both go to `/e/<id>`.
- Delete is the last mutation on the owner event. Run `scheduler-my-events` listing
  checks before it.
