# Create an event

Anyone can create a meeting poll from `/` without signing in. The user enters a
title, an optional description, a meeting length, and weekly time ranges per day.
A live preview shows the generated slots. Creating redirects to the new event page.
An event created while signed in belongs to that user; an anonymous event has no
owner and can never be edited or deleted.

## Sub-features

- `scheduler-create-anon` creates an ownerless event and lands on `/e/<id>`.
- `scheduler-create-owner` creates an event owned by the signed-in user, which then
  shows `Edit` and `Delete` and appears in `My events`.
- `scheduler-create-validation` rejects a submission whose ranges produce no slot,
  or whose range is shorter than the meeting length, without creating an event.

## How to get to it (user POV)

- Open `http://localhost:6168/`, the `Scheduler` header link, or `New event` on
  `My events`.
- `GET /events/new` redirects to `/`. The form posts to `/events/new`.

## Driving it with Orca Browser

Preconditions: the helper is ready and the seed is applied. The form starts with
`Meeting length` set to `1 hour` and Mon to Fri each set to 19:00–22:00, so the
preview reads `15 slots (60 min each)`. Sat and Sun read `Unavailable`.

- **Anonymous create.** In a new anonymous profile, open `/`. Require the heading
  `Schedule a meeting` and the link `Sign in`. Fill the textbox `Title` with
  `Verify anonymous sync` and the textbox `Description (optional)` with
  `Created by the verification run.` Choose the combobox `Meeting length`, then
  `30 min`; the preview reads `30 slots (30 min each)`. Choose
  `Remove time range for Tue`, `Remove time range for Wed`, `Remove time range for Thu`,
  and `Remove time range for Fri`; the preview reads `6 slots (30 min each)`. Choose
  `Add time range for Sat`; the comboboxes `Sat start time` and `Sat end time` show
  `09:00` and `17:00`. Set `Sat end time` to `10:00`; the preview reads
  `8 slots (30 min each)`. Choose `Create event`. The URL becomes
  `http://localhost:6168/e/evt_<26 characters>`. The page shows the heading
  `Verify anonymous sync`, the description, `Each meeting is 30 min.`, `Share:` with
  the path `/e/<id>`, a `Copy` button, the card heading `Pick the times that work`,
  the textbox `Your name`, and checkboxes `Mon 19:00` through `Mon 21:30`,
  `Sat 09:00`, and `Sat 09:30`. No `Edit` or `Delete` button is present, and no
  `Who's available` section is present.
  Independent read: `pnpm exec wrangler d1 execute gdgjp-scheduler-db --local --command
  "SELECT id, title, description, slot_minutes, owner_user_id FROM events WHERE title = 'Verify anonymous sync'"`
  returns one row with `slot_minutes` 30 and `owner_user_id` null. `SELECT day_of_week,
  start_time FROM event_slots WHERE event_id = '<id>' ORDER BY day_of_week, start_time`
  returns eight rows: day 0 at 19:00, 19:30, 20:00, 20:30, 21:00, 21:30, and day 5 at
  09:00 and 09:30. `curl -s http://localhost:6168/e/<id>` contains
  `Verify anonymous sync`. Record `<id>` as the anonymous event.
- **Owner create.** Run this only after `scheduler-my-events` has observed its
  empty state. In a new profile, navigate to the `verify-owner` login URL with
  `return_to=%2F`. The header shows `My events` and `Account menu` instead of `Sign in`.
  Fill `Title` with `Verify owner sync`. Keep `1 hour` and the default ranges. Choose
  `Create event`. On `/e/<id>`, require the heading `Verify owner sync`,
  `Each meeting is 1 hour.`, and the buttons `Edit` and `Delete`. The response card
  has no `Your name` textbox. Independent read: the D1 row for that title has
  `owner_user_id` `dev-user-verify-owner`, `slot_minutes` 60, and 15 `event_slots`
  rows. Record `<id>` as the owner event.
- **Validation.** In the anonymous profile, open `/`. Fill `Title` with
  `Verify invalid event`. Choose `Remove time range for Mon` and the same for Tue, Wed,
  Thu, and Fri. The preview shows `Add a time range to see the slots.` and
  `0 slots (60 min each)`. Choose `Create event`. Require that the URL does not become
  `/e/...` and that a message reading `Enable at least one day with a time range` is
  visible. Then add a Mon range with `Add time range for Mon`, set `Mon start time` to
  `19:00` and `Mon end time` to `19:30`, and choose `Create event`. Require a visible
  message containing `shorter than the meeting length`. Capture the network response
  for each POST to `/events/new`: status 400 with the message as its body.
  Independent read: `SELECT COUNT(*) FROM events WHERE title = 'Verify invalid event'`
  returns 0.

## Gotchas

- The browser blocks an empty `Title` through the `required` attribute before the
  server sees it. That is native validation, not this journey's server rejection.
- Source analysis predicts that the validation journey fails its visible-message
  check. The action returns a plain 400 text response and the page renders no action
  data, and the app defines no error boundary. Expect either an unchanged form with no
  message or the framework's default error page. Record what is shown, keep the
  journey failed, and do not weaken the expectation.
- An end time earlier than the start time marks both time comboboxes `aria-invalid`
  in the browser, but the preview silently drops that range.
- An event created anonymously can never gain an owner. Signing in later does not
  make its `Edit` or `Delete` controls appear.
- Event IDs are random. Read the ID from the URL after the redirect, never from list
  order.
- `Meeting length` and the time selects are Radix comboboxes. Choose the option from
  the opened listbox; typing into the trigger does nothing.
