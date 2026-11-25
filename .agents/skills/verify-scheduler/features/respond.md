# Respond to an event

Anyone with an event URL can mark the slots that work for them. An anonymous
participant gives a name and is remembered by an HttpOnly cookie scoped to that
event's path; only the token's hash is stored. A signed-in participant is matched
by user ID and is not asked for a name. Each participant can update or remove their
own availability, and everyone sees the `Who's available` table with per-slot totals.

## Sub-features

- `scheduler-respond-anon` joins as a named guest, sees the identity survive reload,
  updates the selection, removes it, and restores it with `Undo`.
- `scheduler-respond-signed-in` joins without a name field, updates, and removes the
  response as `verify-owner`.
- `scheduler-anon-identity` proves that a valid guest cookie identifies the seeded
  guest, that a wrong token does not, and that one event's cookie does not identify a
  guest on another event.
- `scheduler-event-missing` returns 404 for an unknown or soft-deleted event.

## How to get to it (user POV)

- Open a shared URL `http://localhost:6168/e/<id>`, or choose an event card on
  `My events`.
- `Copy` beside `Share:` copies the current page URL.

## Driving it with Orca Browser

Preconditions: the helper is ready, the seed is applied, and
`scheduler-create-anon` has recorded the anonymous event `<anon-id>`. Interactive
slots are checkboxes named `<Day> <HH:MM>`, for example `Mon 19:00`. Day headers are
buttons named `Select all Mon slots` or, when every slot of that day is checked,
`Deselect all Mon slots`.

- **Anonymous join.** In a new anonymous profile, open `/e/<anon-id>`. Require the card
  heading `Pick the times that work`, the textbox `Your name`, and the button `Join`.
  Fill `Your name` with `Verify Guest`. Check `Mon 19:00` and `Mon 19:30`. Choose
  `Join`. Wait for the toast `Joined event`. The `Who's available` table appears with
  a column `Verify Guest`, rows `Mon 19:00` and `Mon 19:30` show `Available`, and each
  row's `Total` is 1. Capture the POST response's `Set-Cookie`: a cookie named
  `scheduler_p_<anon-id>` with `Path=/e/<anon-id>`, `HttpOnly`, and `SameSite=Lax`.
  Do not retain its value.
- **Anonymous identity after reload.** Reload `/e/<anon-id>`. Require the card heading
  `Update your availability`, the text `Participating as Verify Guest`, checked
  `Mon 19:00` and `Mon 19:30`, the button `Update`, and the button
  `Remove my availability`. There is no `Your name` textbox.
- **Anonymous update.** Uncheck `Mon 19:30` and check `Sat 09:00`. Choose `Update`.
  Wait for the toast `Availability updated`. The table shows `Available` for
  `Mon 19:00` and `Sat 09:00` and not for `Mon 19:30`. Reload; the same two boxes stay
  checked. Independent read: `SELECT s.day_of_week, s.start_time FROM event_availabilities a
  JOIN event_slots s ON s.id = a.slot_id JOIN event_participants p ON p.id = a.participant_id
  WHERE p.event_id = '<anon-id>' AND p.display_name = 'Verify Guest' ORDER BY 1, 2`
  returns day 0 at 19:00 and day 5 at 09:00. The participant row has `user_id` null and a
  64-character `edit_token_hash`.
- **Anonymous remove and undo.** Choose `Remove my availability`. Wait for the toast
  `Removed your availability`. The card returns to `Pick the times that work`, and the
  `Verify Guest` column is gone. Choose `Undo` in the toast. Wait for
  `Availability restored`. The `Verify Guest` column returns with `Mon 19:00` and
  `Sat 09:00`. Reload and require `Participating as Verify Guest`. Independent read: one
  `event_participants` row named `Verify Guest` for `<anon-id>`, with a new `id`.
- **Second guest.** In a second new anonymous profile, open `/e/<anon-id>`. Require
  `Pick the times that work` and the textbox `Your name`, not `Participating as`.
  Join as `Verify Second` with `Mon 19:00`. The `Mon 19:00` row's `Total` reads 2 and its
  pill shows `·2`.
- **Signed-in join.** Navigate to the `verify-owner` login URL with
  `return_to=%2Fe%2F<anon-id>`. Require `Pick the times that work` with no `Your name`
  textbox. Choose `Select all Sat slots`; both `Sat 09:00` and `Sat 09:30` become checked
  and the button is renamed `Deselect all Sat slots`. Choose `Join`. Wait for
  `Joined event`. A column `verify-owner (dev)` appears. The card reads
  `Update your availability` and `Participating as verify-owner (dev)` without reload.
  Uncheck `Sat 09:30`, choose `Update`, and wait for `Availability updated`. Choose
  `Remove my availability` and wait for `Removed your availability`; the column is
  gone. Independent read after each step: `SELECT id, user_id, display_name,
  edit_token_hash FROM event_participants WHERE event_id = '<anon-id>' AND user_id =
  'dev-user-verify-owner'` returns one row with a null `edit_token_hash` after join and
  update, and no row after removal.
- **Seeded guest identity.** In a new anonymous profile, set the seeded guest cookie from
  the README with `orca cookie set`, using path `/e/evt_0VERFYSCHEDXFRGN0000000001`.
  Open that event. Require the heading `Verify foreign event`, `Participating as
  Seed Guest`, and `Mon 19:00` checked. The `Who's available` table lists `Seed Guest`
  and `verify-other (dev)`; `Mon 19:00` totals 2 and `Mon 20:00` totals 1. Open
  `/e/<anon-id>` in the same profile and require `Pick the times that work` with the
  `Your name` textbox. Replace the cookie value with `9201.WRONGTOKEN0000000000000000`
  and reload the seeded event; require `Pick the times that work`. Independent read:
  `curl -s -H 'Cookie: scheduler_p_evt_0VERFYSCHEDXFRGN0000000001=9201.VERFYSEEDGVESTT0KEN0000001'
  http://localhost:6168/e/evt_0VERFYSCHEDXFRGN0000000001` contains
  `Participating as`, and the same request with the wrong token does not.
- **Missing event.** Open `/e/evt_0000000000000000000000000Z` and
  `/e/evt_0VERFYSCHEDXGNE00000000002`. Each renders the framework error page whose
  heading begins with `404`, without the Scheduler header. Independent read:
  `curl -s -o /dev/null -w '%{http_code}'` for both paths returns `404`.

## Gotchas

- Source analysis predicts that anonymous identity fails in the browser after the
  first join. The cookie path is `/e/<id>`, while React Router's client data requests
  go to `/e/<id>.data`. Under RFC 6265 path matching that path does not match, so
  the browser omits the cookie from revalidation and from `Update` and
  `Remove my availability`. Expect the card to stay on `Pick the times that work`
  right after `Join`, and expect the later `Update` or `Remove my availability` to
  return 403 `Not joined`. Expect a full document reload to show the identity, because
  `/e/<id>` itself matches. Keep the mapped expectations. Record the network status
  and whether the cookie was sent, and report the journey as failed if this occurs.
  curl sends cookies regardless of path, so the HTTP read-back cannot detect this.
  Only the browser can.
- When a signed-in user opens an event, an anonymous cookie for that event is ignored.
  A guest who joined anonymously and then signs in appears as not joined, and joining
  again creates a second participant.
- `Join` with no slot checked is accepted and records a participant with zero
  availability.
- Toasts disappear after a few seconds. `Undo` must be clicked while the toast is
  visible; wait on the toast text, not a fixed delay.
- `Copy` writes `window.location.href` to the clipboard and shows no confirmation.
  Treat the clipboard check as optional when the profile lacks clipboard permission.
- The 404 page is React Router's built-in boundary, not a Scheduler page. Its exact
  status text depends on the runtime. Assert the status code and the `404` prefix only.
