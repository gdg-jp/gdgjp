# CLAUDE.md — `@gdgjp/scheduler`

scheduler.gdgs.jp. Repo-wide conventions in `../../CLAUDE.md`.

## Auth — RP of accounts, no local IdP

`app/features/auth/auth.server.ts` calls `initializeRpAuth` from `gdg-lib` (`IDP_URL` / `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET`); `RpAuthInstance` cached per-`env`. Auth HTTP lives on two passthroughs: `app/routes/api.auth.$.ts` (loader+action → `handleAuthRequest`) and `auth.signout.ts`.

There IS a local `user` table (see `schema.sql`) populated by SSO, but app code must treat the IdP as source of truth — use `requireUser` / `getOptionalUser` from `app/features/auth/auth-redirect.server.ts`, not direct table reads. `requireUser` translates IdP 401s to `redirect("/signin?return_to=…")` with a path-based return target (rejects protocol-relative + control-char return_tos — preserve).

## Dual identity: cookie-token anon vs signed-in owners

Anonymous users are first-class. Anyone can create/join/edit-own-response without signing in; signing in adds cross-device "My events" (`/events`) and owner edit/delete.

`event_participants.user_id` is **nullable**. Auth participants matched by `user_id`; anon matched by per-event cookie `scheduler_p_<eventId>` containing `<participantId>.<token>`. **Only the SHA-256 hash (`edit_token_hash`) is stored**; compare with constant-time `verify`.

`resolveCurrentParticipant` in `app/features/participants/event.server.ts` is the canonical lookup — prefer signed-in user, fall back to validated cookie. Re-use (or mirror order) for new response-editing endpoints. Don't trust the cookie if a user is signed in. Don't trust a raw `participantId` from the form.

Cookie `Path` is scoped to `/e/<eventId>` so each event has its own anon identity — `serializeCookie` / `clearCookie` enforce that. Don't broaden.

Owner-only mutations (`updateEventForOwner`, `softDeleteEvent`) take `ownerUserId` and short-circuit if `owner_user_id` doesn't match. Soft-delete uses `deleted_at`; every read filters `deleted_at IS NULL`.

## Data layer

No ORM. Feature-local `repository.server.ts` modules define `*Row` types matching snake_case, `to*` mappers to camelCase, and column-list constants (`EVENT_COLS`, `SLOT_COLS`, `PARTICIPANT_COLS`) reused across queries. Keep new queries in their owning feature, follow the pattern (RETURNING the column list, mapping through `toX`).

Slot reconciliation on event edit: `updateEventForOwner` keeps slots whose `(dayOfWeek, startTime)` key matches new set (preserves `event_availabilities`), only deletes/inserts the diff. Pure key-diff in `app/features/scheduling/reconcile.ts` is used by slot replacement and exported as `reconcileSlotKeys` for unit testing — preserve separation.

## Slot model (`app/features/scheduling/slots.ts`)

- `day_of_week` is `0=Mon..6=Sun` (ISO weekday — **NOT** JS `Date.getDay()`).
- `event_slots.start_time` is `HH:MM` (DB CHECK enforces length 5).
- `deriveDayRanges` reassembles per-day contiguous ranges; contiguity = consecutive starts exactly `slotMinutes` apart.
- `slots.test.ts` fails when a `MEETING_LENGTH_OPTIONS` value is not a multiple of the `TIME_OPTIONS` step.
