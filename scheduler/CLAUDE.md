# CLAUDE.md — `@gdgjp/scheduler`

scheduler.gdgs.jp. Repo-wide conventions in `../CLAUDE.md`.

## Dev

- `pnpm dev` — :5176
- `pnpm test:e2e` boots BOTH `../accounts` (:5173) and this app (:5176) via `webServer` — IdP must be runnable
- D1: `migrate:local` / `migrate:remote` (both regenerate `schema.sql`)
- Re-run `pnpm typecheck` after `wrangler.toml` binding edits

`.dev.vars`: `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`, and dev-only `APP_URL` / `ACCOUNTS_URL` / `IDP_URL` overrides. See `.dev.vars.example`.

## Auth — RP of accounts, no local IdP

`app/lib/auth.server.ts` calls `initializeRpAuth` from `gdg-lib` (`IDP_URL` / `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET`); `RpAuthInstance` cached per-`env`. Auth HTTP lives on two passthroughs: `app/routes/api.auth.$.ts` (loader+action → `handleAuthRequest`) and `auth.signout.ts`.

There IS a local `user` table (see `schema.sql`) populated by SSO, but app code must treat the IdP as source of truth — use `requireUser` / `getOptionalUser` from `app/lib/auth-redirect.server.ts`, not direct table reads. `requireUser` translates IdP 401s to `redirect("/signin?return_to=…")` via `safeReturnTo` (rejects protocol-relative + control-char return_tos — preserve).

## Dual identity: cookie-token anon vs signed-in owners

Anonymous users are first-class. Anyone can create/join/edit-own-response without signing in; signing in adds cross-device "My events" (`/events`) and owner edit/delete.

`event_participants.user_id` is **nullable**. Auth participants matched by `user_id`; anon matched by per-event cookie `scheduler_p_<eventId>` containing `<participantId>.<token>`. **Only the SHA-256 hash (`edit_token_hash`) is stored**; compare with constant-time `verify`.

`resolveCurrentParticipant` in `app/routes/e.$id.tsx` is the canonical lookup — prefer signed-in user, fall back to validated cookie. Re-use (or mirror order) for new response-editing endpoints. Don't trust the cookie if a user is signed in. Don't trust a raw `participantId` from the form.

Cookie `Path` is scoped to `/e/<eventId>` so each event has its own anon identity — `serializeCookie` / `clearCookie` enforce that. Don't broaden.

Owner-only mutations (`updateEventForOwner`, `softDeleteEvent`) take `ownerUserId` and short-circuit if `owner_user_id` doesn't match. Soft-delete uses `deleted_at`; every read filters `deleted_at IS NULL`.

## Data layer

No ORM. `app/lib/db.ts` defines `*Row` types matching snake_case, `to*` mappers to camelCase, and column-list constants (`EVENT_COLS`, `SLOT_COLS`, `PARTICIPANT_COLS`) reused across queries. Keep new queries in this file, follow the pattern (RETURNING the column list, mapping through `toX`).

Slot reconciliation on event edit: `updateEventForOwner` keeps slots whose `(dayOfWeek, startTime)` key matches new set (preserves `event_availabilities`), only deletes/inserts the diff. Pure key-diff extracted as `reconcileSlotKeys` for unit testing — preserve separation.

## Slot model (`app/lib/slots.ts`)

- `day_of_week` is `0=Mon..6=Sun` (ISO weekday — **NOT** JS `Date.getDay()`).
- `event_slots.start_time` is `HH:MM` (DB CHECK enforces length 5).
- `deriveDayRanges` reassembles per-day contiguous ranges; contiguity = consecutive starts exactly `slotMinutes` apart.
- `TIME_OPTIONS` uses 15-min grid because 15 is the GCD of every `MEETING_LENGTH_OPTIONS`. Adding a length not a multiple of 15 → revisit both.

## Routes

Flat RR7 framework-mode in `app/routes.ts`: `home`, `events` (signed-in My events), `events/new`, `e/:id` (view + join/respond), `e/:id/edit`, `e/:id/delete` (owner-only), `signin`, plus two auth passthroughs. Load env via `args.context.cloudflare.env` in loaders/actions.
