# CLAUDE.md — `@gdgjp/scheduler`

scheduler.gdgs.jp. Repo-wide conventions in `../../CLAUDE.md`.

## Auth — RP of accounts, no local IdP

`app/features/auth/auth.server.ts` calls `initializeRpAuth` from `gdg-lib` (`IDP_URL` / `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET`); `RpAuthInstance` cached per-`env`. Auth HTTP lives on two passthroughs: `app/routes/api.auth.$.ts` (loader+action → `handleAuthRequest`) and `auth.signout.ts`.

There IS a local `user` table (see `schema.sql`) populated by SSO, but app code must treat the IdP as source of truth — use `requireUser` / `getOptionalUser` from `app/features/auth/auth-redirect.server.ts`, not direct table reads. `requireUser` translates IdP 401s to `redirect("/signin?return_to=…")` with a path-based return target (rejects protocol-relative + control-char return_tos — preserve).

## Dual identity: cookie-token anon vs signed-in owners

Anonymous users are first-class. Anyone can create/join/edit-own-response without signing in; signing in adds cross-device "My events" (`/events`) and owner edit/delete.

`event_participants.user_id` is **nullable**. Auth participants matched by `user_id`; anon matched by per-event cookie `scheduler_p_<eventId>` containing `<participantId>.<token>`. **Only the SHA-256 hash (`edit_token_hash`) is stored**; compare with constant-time `verify`.

`resolveCurrentParticipant` in `app/features/participants/event.server.ts` is the canonical lookup — prefer signed-in user, fall back to validated cookie. Re-use (or mirror order) for new response-editing endpoints. Don't trust the cookie if a user is signed in. Don't trust a raw `participantId` from the form; only the owner-only intents take one, and only for a participant of the same event.

The cookie name carries the event ID, so each event keeps its own anon identity. Its `Path` is `/e` because React Router sends loader and action requests to `/e/<id>.data`, which a `/e/<id>` path does not match. `participantCookieHeaders` sets it and expires the `/e/<id>`-scoped cookie that earlier releases wrote; the event loader re-issues it whenever a cookie identifies a guest, which moves those guests over on their next page load.

Owner-only mutations (`updateEventForOwner`, `softDeleteEvent`) take `ownerUserId` and short-circuit if `owner_user_id` doesn't match. Soft-delete uses `deleted_at`; every read filters `deleted_at IS NULL`.

Participants are soft-deleted the same way (`event_participants.deleted_at`). Removing a response keeps the row, its token hash and its availability, so Undo (`restore-response`, `admin-restore-participant`) brings back the same identity and the guest's cookie keeps working. Event reads skip removed participants; restore and a signed-in rejoin look rows up by ID or user including removed ones.

## Data layer

No ORM. Feature-local `repository.server.ts` modules define `*Row` types matching snake_case, `to*` mappers to camelCase, and column-list constants (`EVENT_COLS`, `SLOT_COLS`, `PARTICIPANT_COLS`) reused across queries. Keep new queries in their owning feature, follow the pattern (RETURNING the column list, mapping through `toX`).

Slot reconciliation on event edit: `updateEventForOwner` keeps slots whose `(dayOfWeek, startTime)` key matches new set (preserves `event_availabilities`), only deletes/inserts the diff. Pure key-diff in `app/features/scheduling/reconcile.ts` is used by slot replacement and exported as `reconcileSlotKeys` for unit testing — preserve separation.

## Slot model (`app/features/scheduling/slots.ts`)

- `day_of_week` is `0=Mon..6=Sun` (ISO weekday — **NOT** JS `Date.getDay()`).
- `event_slots.start_time` is `HH:MM` (DB CHECK enforces length 5).
- `deriveDayRanges` reassembles per-day contiguous ranges; contiguity = consecutive starts exactly `slotMinutes` apart.
- `slots.test.ts` fails when a `MEETING_LENGTH_OPTIONS` value is not a multiple of the `TIME_OPTIONS` step.
