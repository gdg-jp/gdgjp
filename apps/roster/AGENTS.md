# roster (`roster.gdgs.jp`)

Staff shift-schedule generator: owners define time slots / tracks / roles / headcount, staff
self-register through a public link, a solver auto-generates a draft schedule, owners hand-edit
and publish. Full plan: `docs/roster/index.md`. Design decisions: `docs/roster/adr.md`. Read both
before touching this app — every stage file assumes their domain model and solver spec.
`ARCHITECTURE.md` holds the stage history, code map, route surface, and placement rules;
each feature's `README.md` holds its file-by-file breakdown.

An event owns several roster sheets (`roster_sheets`). Time slots, tracks, demand, assignments,
history, and public visibility are per sheet; staff applications stay event-wide. Each event
keeps a default sheet `default:<eventId>`; the legacy `/e/:id/design` and `/e/:id/roster` URLs
only redirect to it.

## Public surfaces

- `/apply/:token` uses `getOptionalUser`, never `requireUserWithChapter`: chapter membership must
  not be required to register as staff. The event resolves by `apply_token` alone
  (`getEventByApplyToken`); the event id never appears in the URL.
- `/r/:token` and `/r/:token/s/:sheetId` have zero authentication (not even `getOptionalUser`).
  The event resolves by `view_token` alone (`getEventByViewToken`, same `deleted_at IS NULL`
  contract). An unknown token 404s; a private sheet renders 200 with "まだ公開されていません".
- Sheet visibility gates data **assembly**, not just rendering: a private sheet's loader never
  touches `applications`/`assignments`. `buildPublicRosterData` returns `PublicStaff` as
  `{id, name, party}` only — never contact data, skills, availability, or experience level — and
  drops withdrawn applicants with their residual assignments (ADR-005).
  `public-roster.server.test.ts` and `tests/architecture/public-view-exposure.test.ts` check this.
- `/dev/login` and `/dev/seed` hard-404 when `ENVIRONMENT === "production"`.

## Data invariants

- No ORM. Feature `*.server.ts` modules hand-write D1: `*Row` type → `to*()` mapper →
  column-list constant → `RETURNING`.
- `roster.server.ts#writeAssignments` is the **only** writer of `assignments`: a full
  delete-then-reinsert in one `db.batch`, never a partial patch. `PRIMARY KEY (application_id,
  time_slot_id)` makes a double assignment structurally impossible.
- `solver-input.server.ts` is the only mapping from D1 rows to the solver's `SolverInput`
  (ADR-004). It drops withdrawn applicants and re-sorts applications and demand entries so
  generation does not depend on D1 row order. Cross-sheet overlaps on the same date are marked
  unavailable there; manual assignment returns a `cross-sheet` warning that needs confirmation.
- `time_slots.idx` is 0-based and contiguous per sheet; the solver and the public view's range
  grouping depend on it. Regenerating the grid keeps the `id` of any slot whose
  `(start_time, end_time)` is unchanged (`reconcileSlotKeys`), so `availabilities` survive.
- A proxy registration (`user_id NULL`) is claimed by filling in `user_id` when its email matches
  a signed-in visitor (`resolveOwnApplication`), never by inserting a second row (ADR-008's
  UNIQUE indexes).
- `demands` with `ideal_count = 0` read and write identically to no row.
- Unit tests for D1 access run against a real SQLite engine migrated from `migrations/*.sql`
  (`tests/helpers/sqlite-d1.ts`), not a hand-mocked `D1Database`.

## History

- `recordRevision` merges into the head only when it is a same-actor `edit` within
  `GROUP_WINDOW_MS`; `generate` never merges. It truncates redo rows past the cursor (no
  branches) and evicts beyond `RETENTION_LIMIT`, all in one `db.batch`.
- `restoreRevision` never creates a revision. It drops snapshot entries whose application is gone
  or withdrawn or whose time slot no longer exists, writes through `writeAssignments` without a
  `revision`, moves `revision_cursor`, and reports the dropped count. Undo/redo move the cursor
  one step and call it.
- `roster.server.ts` and `history.server.ts` import each other on purpose; see
  `app/features/history/README.md` before changing either side.
- The solver (`app/features/solver/`) stays pure TS — no D1, React, `fetch`, or `window` — and
  owns its types, so manual-edit drawers can call it in the browser.

## Checks

`tests/architecture/` enforces layering (including the exact `app/lib/` and `app/components/`
sets), the 400-line cap, test colocation, the public URL snapshot, public-view exposure, and
data-grid utilities. Every allowlist there is shrink-only: fix the placement instead of adding to
one (`docs/roster/index.md` §8). A `route-urls.test.ts` failure after adding a route is expected;
update the snapshot once the new URL is intentional.

## Auth and config

`app/features/auth/permissions.ts` is the single point of authorization judgment
(`canManageEvent`, `canEditApplication`). MVP is flat (any member of the owning chapter manages
the event; a signed-in visitor edits only their own application); route every new check through
it so a later move to per-role RBAC only touches that file.

Vite `resolve.dedupe` for react / react-dom / react-router is load-bearing: without it
`@gdgjp/gdg-lib` (consumed as source) leaves the client with two React copies ("invalid hook
call" at hydration). `optimizeDeps.include` lists `radix-ui` and `lucide-react` for the shared GDG
menus; add `motion` if a shared UI component starts pulling it in (see `ost/vite.config.ts`).

Run `accounts` for real sign-in, or use `/dev/login?as=owner&chapter=1:x&return_to=/`.
