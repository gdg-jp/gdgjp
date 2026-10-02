# roster architecture

`CLAUDE.md` is operational context (dev commands, port, auth, ORM policy). This file is only
"where is the code" — table and bullets, no prose.

- This map is a **contract: move a file, update this map in the same change.** An unmaintained
  map is an immediately false one.
- Full plan and stage breakdown: `docs/roster/index.md`; design decisions: `docs/roster/adr.md`.
- Stage 01 was auth + chapter gate only. Stage 02 added the domain schema: events, the time-slot
  grid (phases/time_slots), tracks, and the seeded role master (event_roles).
- **Stage 03** added demand input: the `demands` table (min/ideal/leadMin/newMax per
  time_slot x track x role) and the `/e/:id/design` demand matrix.
- **Stage 04** added staff registration: `applications`/`application_skills`/`availabilities`,
  the public `/apply/:applyToken` form, and `/e/:id/staff`'s proxy-add entry point (ADR-008).
- **Stage 06** (built in parallel, merged separately) added the solver — a pure TS module, not yet
  wired into any route.
- **Stage 05** cross-checks Stage 03's demand against Stage 04's applications
  (`app/features/supply/`), distinguishing a headcount shortage from an experience (`lead`)
  shortage, and adds the rest of `/e/:id/staff`: the staff list (`StaffTable`), an
  owner-correction drawer (`StaffDrawer`), and the apply-link/status card (`ApplyLinkCard`). No
  new table, no new route.
- **Stage 07** added the `assignments` table and `app/features/roster/`: assembling a
  real `SolverInput` from D1 (`solver-input.server.ts`), the single `writeAssignments` write path
  (`roster.server.ts`), pure grid-assembly logic (`grid.ts`), and the new `/e/:id/roster` route —
  the 3-view shift table (staff/role/coverage) plus the 2 manual-edit drawers.
- **Stage 08 (this PR)** adds the `revisions` table + `events.revision_cursor` and
  `app/features/history/`: `recordRevision`/`restoreRevision` (D1 access), the pure
  `grouping.ts`/`retention.ts`/`cursor.ts` decisions, a versioned `snapshot.ts` codec, and
  `/e/:id/roster`'s new history panel + undo/redo buttons. `roster.server.ts#writeAssignments`
  gains an optional `revision` argument that calls `recordRevision` — see
  `app/features/history/README.md` for the two-way import this creates with `roster.server.ts`
  and why it's safe. No new route (`route-urls.test.ts`'s snapshot is unchanged for this stage).
- **Stage 09** (built in parallel, merged separately) added `app/features/public-roster/` and the
  app's one fully public, unauthenticated screen: `/r/:viewToken` (4 sub-views:
  staff/role/individual/party) and `/e/:id/share` (the owner-side URL-copy + default-sheet publication card). No new
  table — reads `events`/`schedule`/`applications`/`roster`'s existing accessors and
  reshapes the result into a deliberately smaller `PublicRosterData` (ADR-005: no PII, no
  experience level, ever). Reuses `~/features/roster/components/RoleGrid` (new `readOnly` prop)
  rather than forking it.

## Code map

| What you're looking for | Where |
|---|---|
| Auth (RP session, chapter ACL, sign-in redirect, permission judgment) | `app/features/auth/` |
| Cross-cutting primitives with no domain (`safeReturnTo`, D1 handle accessor) | `app/lib/` — 2 files only, see "Placement rules" |
| App shell UI | `app/components/AppShell.tsx` (authenticated admin chrome), `PublicShell.tsx` (public chrome), and `RosterBrand.tsx` (shared product lockup); no local `ui/` (ADR-001: UI primitives come from `@gdgjp/gdg-lib`) |
| Solver (greedy fill + local search + OJT swap, Stage 06) | `app/features/solver/` — pure TS, no D1/React/fetch/window (ADR-004) |
| Events (`events` table CRUD, status lifecycle) | `app/features/events/` |
| Schedule (phases, the time-slot grid + its regenerate/reconcile logic, tracks, roles, event_roles) | `app/features/schedule/` |
| Demand (`demands` table: min/ideal/leadMin/newMax per time_slot x track x role; matrix row/column assembly; the `/e/:id/design` demand card) | `app/features/demand/` |
| Staff registration (applications, application_skills, availabilities; proxy-registration claim; apply-form validation; owner-correction writes; the staff list `/` correction drawer) | `app/features/applications/` (README) |
| Supply-demand cross-check (headcount vs. experience shortage per time slot/role; event-wide shortage summary) | `app/features/supply/` (README) |
| Roster/shift table (`assignments` table; `SolverInput` assembly from D1; the single `writeAssignments` write path; grid/drawer view logic; `/e/:id/roster`) | `app/features/roster/` (README) |
| History (`revisions` table + `events.revision_cursor`; record/restore/undo/redo; consecutive-edit grouping; 50-entry retention; the history panel + undo/redo buttons) | `app/features/history/` (README) |
| Public view (`/r/:viewToken`'s data assembly and 4 sub-views; the individual-view merge logic; `/e/:id/share`'s URL/publication card) | `app/features/public-roster/` (README) |

## Route surface

`app/routes.ts` (config mode). Every route today:

```
app/routes/
  admin.tsx         pathless authenticated layout — chapter gate + shared admin shell
  home.tsx          "/" — event list (auth + chapter required)
  events.new.tsx      "/events/new" — create an event
  e.$id.design.tsx    "/e/:id/design" — event settings, phases/time slots, tracks, roles, demand
  e.$id.staff.tsx     "/e/:id/staff" — staff list + owner-correction drawer, supply-demand view,
                      apply URL/status card, proxy-add entry point (auth + chapter)
  e.$id.roster.tsx    "/e/:id/roster" — shift table: generate, 3 views, 2 manual-edit drawers,
                      history panel + undo/redo/restore (auth + chapter)
  e.$id.share.tsx     "/e/:id/share" — view-URL copy + publication card (auth + chapter)
  apply.$token.tsx    "/apply/:token" — public staff registration (sign-in only, no Chapter)
  r.$token.tsx        "/r/:token" — public read-only shift view, NO auth at all (default-sheet visibility gates data)
  signin.tsx         "/signin" — redirects into the gdg-lib auth flow
  no-chapter.tsx      "/no-chapter"
  api.auth.$.ts       "/api/auth/*" — gdg-lib RP plumbing
  auth.signout.ts     "/auth/signout"
  dev.login.tsx       "/dev/login" — local/e2e only, hard 404 in production
  dev.seed.tsx        "/dev/seed" — local/e2e only, hard 404 in production
```

`tests/architecture/route-urls.test.ts` snapshots this full URL set; a snapshot diff is the
signal that a route was added, moved, or removed — expected to fail when you add one.

## Placement rules (ADR-003)

1. **Domain code goes in `app/features/<domain>/`.** Server + client + UI + colocated tests
   together. UI subfolder (once one exists) is `app/features/<domain>/components/`.
2. **`app/lib/` holds only domain-free cross-cutting primitives.** Today: `return-to.ts` and
   `db.server.ts` (a D1 handle accessor — no queries). Adding a new file here is presumed wrong —
   it almost always belongs under `app/features/<domain>/`. `layering.test.ts` whitelists the
   exact top-level set.
3. **`app/components/` holds only app chrome.** `AppShell.tsx` is the authenticated admin chrome;
   `PublicShell.tsx` is the public chrome; `RosterBrand.tsx` is their shared product lockup. Per
   ADR-001, roster has no local UI primitive layer; shared UI primitives come from
   `@gdgjp/gdg-lib`.
4. **`app/routes/` holds only route modules.** Loader/action logic beyond "read the request, call
   a feature, shape the response" belongs in a feature's `*.server.ts`.
5. **Tests sit next to the file they exercise**, named `<subject>.test.ts` (or
   `<subject>.<aspect>.test.ts` for multiple angles per subject).
6. **1 file ≤ 400 lines** (tests and generated files excluded).
7. **`workers/` is the runtime boundary only** (Worker entry point). No Durable Object, no
   per-feature Worker-side implementation exists yet.

## Runtime boundary

| Boundary | File |
|---|---|
| Worker entry (`fetch`) | `workers/app.ts` |

## Generated — don't read, don't hand-edit

| File | Source of truth |
|---|---|
| `worker-configuration.d.ts` | `wrangler.toml` bindings (run `pnpm cf-typegen` after changing them) |
| `schema.sql` | `migrations/` (run `pnpm migrate:local` after adding a migration) |

## Where tests live

| Kind | Location | Naming |
|---|---|---|
| Unit | Next to the source | `<subject>.test.ts(x)` / `<subject>.<aspect>.test.ts(x)` |
| Architecture convention | `tests/architecture/` | name of the convention it checks |
| E2E | `e2e/` | `<flow>.spec.ts` |
