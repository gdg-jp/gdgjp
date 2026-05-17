# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is the `@gdgjp/scheduler` app (scheduler.gdgs.jp) inside the `gdgjp` monorepo. See the repo-root `CLAUDE.md` for monorepo-wide conventions (Biome, Conventional Commits, `verbatimModuleSyntax`, the per-app `schema.sql` dump policy, etc.). The notes below cover only what's specific to this app.

## Commands

Run from this directory (`scheduler/`) or with `--filter @gdgjp/scheduler` from the repo root.

- `pnpm dev` — React Router 7 dev server on `:5176`
- `pnpm test` — Vitest unit tests (`app/**/*.test.ts`, Node env, paths via `vite-tsconfig-paths`)
- `pnpm test:e2e` — Playwright; **boots both `../accounts` (`:5173`) and this app (`:5176`)** via `webServer`, so the IdP must be runnable
- Single Vitest file: `pnpm exec vitest run app/lib/reconcile.test.ts`
- Single Playwright spec: `pnpm exec playwright test e2e/home.spec.ts`
- `pnpm typecheck` — runs `wrangler types && react-router typegen && tsc --noEmit`; re-run after editing `wrangler.toml` bindings
- D1 migrations: `pnpm migrate:local` / `pnpm migrate:remote` (both also regenerate `schema.sql`)

`.dev.vars` provides `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`, and dev-only `APP_URL` / `ACCOUNTS_URL` / `IDP_URL` overrides — see `.dev.vars.example`.

## Architecture

### Auth: OAuth client of `accounts`, no local user table writes

This app does **not** run its own IdP. `app/lib/auth.server.ts` calls `initializeRpAuth` from `@gdgjp/gdg-lib` with `IDP_URL` / `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET` (configured in `wrangler.toml` + `.dev.vars`) — the returned `RpAuthInstance` is cached per-`env`. All auth HTTP lives on two passthrough routes: `app/routes/api.auth.$.ts` forwards loader+action to `handleAuthRequest`, and `auth.signout.ts` handles sign-out. There is a local `user` table (see `schema.sql`) populated by the SSO flow, but app code should treat the IdP as the source of truth and use `requireUser` / `getOptionalUser` from `app/lib/auth-redirect.server.ts` rather than reading the table directly. `requireUser` translates IdP 401s into a `redirect("/signin?return_to=…")` via `safeReturnTo` (which rejects protocol-relative and control-character `return_to` values — preserve that when adding new redirect entry points).

### Dual identity model: cookie-token participants vs signed-in owners

Anonymous users are first-class. The intended UX (per the repo-root CLAUDE.md):

- Anyone can create an event, join, and edit their own response without signing in.
- Signing in additionally unlocks a cross-device "My events" list (`/events`, owner-scoped) and edit/delete on owned events.

This shapes the participant model in `app/lib/db.ts` and `app/lib/participant-cookie.ts`:

- `event_participants.user_id` is **nullable**. Authenticated participants are matched by `user_id`; anonymous ones are matched by a per-event cookie `scheduler_p_<eventId>` containing `<participantId>.<token>`, where only the SHA-256 hash (`edit_token_hash`) is stored in the DB and compared with the constant-time `verify` helper.
- `resolveCurrentParticipant` in `app/routes/e.$id.tsx` is the canonical lookup — prefer signed-in user, fall back to validated cookie. Re-use it (or mirror its order) for any new response-editing endpoint; don't trust the cookie if a user is signed in, and don't trust a raw `participantId` from the form.
- The cookie's `Path` is scoped to `/e/<eventId>`, so each event has its own anon identity. `serializeCookie` / `clearCookie` enforce that scope — don't broaden it.
- Owner-only mutations (`updateEventForOwner`, `softDeleteEvent`) take `ownerUserId` and short-circuit if `owner_user_id` doesn't match. Soft-delete uses `deleted_at`; every read filters on `deleted_at IS NULL`.

### Data layer: hand-written D1 SQL with row→model mappers

No ORM. `app/lib/db.ts` defines `*Row` types matching the snake_case schema, `to*` mappers to camelCase domain types, and column-list constants (`EVENT_COLS`, `SLOT_COLS`, `PARTICIPANT_COLS`) re-used across queries. Keep new queries in this file and follow the same pattern (RETURNING the column-list constant, mapping through `toX`) rather than scattering SQL into routes.

Slot reconciliation on event edit is non-trivial: `updateEventForOwner` keeps slots whose `(dayOfWeek, startTime)` key matches the new set so their `event_availabilities` survive, and only deletes/inserts the diff. The pure key-diff is extracted as `reconcileSlotKeys` for unit testing — preserve that separation when changing the algorithm.

### Slot model & UI helpers

`app/lib/slots.ts` is the source of truth for slot math. `day_of_week` is `0=Mon..6=Sun` (ISO weekday — **not** JS `Date.getDay()`). `event_slots.start_time` is a `HH:MM` string (DB CHECK enforces length 5). `deriveDayRanges` re-assembles per-day contiguous ranges from individual slot rows for the editor UI; contiguity is defined as consecutive starts exactly `slotMinutes` apart. The 15-min `TIME_OPTIONS` grid is the universal step because 15 is the GCD of every option in `MEETING_LENGTH_OPTIONS`. If you add a meeting length that isn't a multiple of 15, you must revisit both.

### Routes (`app/routes.ts`)

Flat React Router 7 framework-mode routes: `home` (`/`), `events` (signed-in My events list), `events/new`, `e/:id` (event view + join/respond — anon or auth), `e/:id/edit` and `e/:id/delete` (owner-only), `signin`, plus the two auth passthroughs. The Worker entry (`workers/app.ts`) wires `createRequestHandler` to the virtual server build and exposes `env`/`ctx` on `context.cloudflare` — load env from `args.context.cloudflare.env` in loaders/actions.
