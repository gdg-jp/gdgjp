# My events

A signed-in user sees the events they own at `/events`, newest first, with slot and
participant counts. Events they only joined, events created anonymously, and
soft-deleted events are not listed. Anonymous visitors are sent to sign-in.

## Sub-features

- `scheduler-my-events` shows the `No events yet` empty state, then lists the owner's
  event with its counts and opens it.
- `scheduler-my-events-gate` redirects an anonymous visitor to `/signin` with
  `return_to=%2Fevents`.

## How to get to it (user POV)

- Choose `My events` in the header while signed in.
- Sign in from the header; the default return target is `/events`.
- Open `http://localhost:6168/events` directly.

## Driving it with Orca Browser

Preconditions: the helper is ready and the seed is applied. `verify-owner` has
created no event yet. The seeded deleted event is owned by `verify-owner`, and the
seeded foreign event, which `verify-owner` does not own, exists.

- **Empty state.** In a new profile, navigate to the `verify-owner` login URL. The tab
  lands on `/events`. Require the heading `My events`, the link `New event`, the title
  `No events yet`, and the text `Create a meeting to start gathering availability.`
  `Verify deleted event` and `Verify foreign event` are absent. Independent read:
  `curl -s -b <scratch>/owner.jar http://localhost:6168/events` contains `No events yet`.
- **New event link.** Choose `New event`. Require `/` and the heading `Schedule a meeting`.
- **Listed event.** After `scheduler-create-owner`, choose `My events` in the header.
  Require one card linking to `/e/<owner-id>` with the text `Verify owner sync` and
  `15 slots · 0 participants ·` followed by today's date. After
  `scheduler-respond-signed-in` or another join on that event, the count reads
  `1 participant`. Choose the card and require the event heading. The anonymous event
  from `scheduler-create-anon` and the event `verify-owner` joined are absent.
  Independent read: `SELECT id, title FROM events WHERE owner_user_id =
  'dev-user-verify-owner' AND deleted_at IS NULL ORDER BY created_at DESC` lists the same
  IDs in the same order as the cards.
- **Other user.** Navigate to the `verify-other` login URL. Require `My events` to show
  no `Verify owner sync` card. `Verify foreign event` is listed with
  `3 slots · 2 participants`, or a different participant count if
  `scheduler-owner-remove-participant` has already run.
- **Anonymous gate.** In an anonymous profile, open `/events`. Require a redirect to
  `/signin?return_to=%2Fevents`, then onward to Accounts when `--platform <verify-platform ready.json>` is running.
  Independent read: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'
  http://localhost:6168/events` returns `302` and
  `http://localhost:6168/signin?return_to=%2Fevents`.

## Gotchas

- The date uses the browser locale and time zone through `toLocaleDateString`. Assert
  the date's presence, not its format.
- The empty-state proof is valid only before `verify-owner` creates an event. If an
  earlier journey created one, restart the helper instead of deleting rows by hand.
- Without `--platform <verify-platform ready.json>`, the anonymous gate's second hop to `/api/auth/signin` fails.
  The first 302 to `/signin?return_to=%2Fevents` is the proof for this map.
- Joining an event does not add it to `My events`. Only ownership does.
