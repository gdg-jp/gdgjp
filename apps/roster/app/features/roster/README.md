# roster

The current shift table (`assignments`) and everything `/e/:id/roster` needs: wiring Stage 06's
solver up to real D1 data for the first time, and the manual-edit UI on top of it. See
`docs/roster/07-roster-manual-edit.md`.

Entry points:

- `types.ts` — `AssignmentRecord` (the `assignments` D1 row, mapped shape) and the `RosterView`
  vocabulary (`"staff" | "role" | "coverage"`). Deliberately does not re-declare the solver's own
  `Assignments`/`SolverInput`/`Report` types — every function in this feature imports those
  directly from `~/features/solver/types`.
- `roster.server.ts` — `readAssignments`/`readAssignmentsMap` and `writeAssignments`, the **only**
  function anywhere in this app that writes to `assignments`. Always a full
  delete-then-reinsert (via `db.batch`) of the event's whole current set — both the generate
  action and every manual-edit intent in `e.$id.roster.tsx` funnel through it, so Stage 08 has
  exactly one call site to instrument with history.
- `solver-input.server.ts` — `buildSolverInput`, the only place D1 rows are mapped onto the
  solver's plain `SolverInput` type. Reuses `~/features/demand`/`~/features/applications`/
  `~/features/schedule`'s existing reads verbatim. **Determinism-critical**: filters out withdrawn
  applicants entirely, then explicitly re-sorts `applications` by `id` and inserts `demands`
  entries in `demandKey`-sorted order, so the generate action's "same seed -> same result"
  guarantee doesn't quietly depend on D1's row return order (which Stage 06's own solver tests
  can't catch, since they never touch D1).
- `grid.ts` — pure view-assembly logic shared by the 3 grid components and the 2 drawers. No D1,
  no React.
  - `buildGridColumns` — the (track, role) columns `RoleGrid`/`DemandCoverageGrid` share.
  - `groupAssignmentsByCell` / `groupAssignmentsByApplication` — the two groupings every grid
    needs ("who's in this demand cell" / "what does this person's whole day look like").
  - `buildRoleGridColumn` — the role-view's vertical-merge algorithm: a run of consecutive slots
    merges into one spanning cell only while BOTH the assigned lineup and the demand values stay
    identical; either changing breaks the merge.
  - `buildStaffColumns` — `StaffGrid`'s column view-model (reuses `SolverInput.applications`'
    already-fetched skills instead of a second D1 read); includes a withdrawn applicant only if
    they still have a residual assignment, so a stale row stays visible as a violation instead of
    silently vanishing from the grid.
  - `indexReportByCell` — reshapes `evaluate()`'s `Report.shortages`/`violations` arrays into a
    per-cell lookup for `DemandCoverageGrid`. Never re-judges a shortage/violation itself.
  - `buildStaffCellCandidates` / `suggestForRange` — call `hardViolations`/`suggestFor` verbatim to
    power `CellDrawer`/`DemandCellDrawer`. The former checks candidates against a copy of
    `assignments` with the applicant's own current entry at that slot removed first (they're
    choosing a new cell in the same slot, not double-booking themselves); the latter unions
    warnings across every slot in a merged range so a mid-range conflict is never hidden.
- `use-roster-drawers.ts` — `e.$id.roster.tsx`'s drawer state (which cell/range is selected) and
  the derived candidate/suggestion lists, split out purely to keep the route file under the
  400-line cap. Closes both drawers on a successful assign/unassign, the same "close on success,
  leave open on error" contract `StaffDrawer` (Stage 05) uses.
- `components/` —
  - `StaffGrid` — the default view: vertical = time, horizontal = staff. Experience level is shown
    ONLY in the column header, never inside a cell.
  - `RoleGrid` — vertical = time, horizontal = (track × role); consecutive-slot cells merge per
    `grid.ts#buildRoleGridColumn`. Selecting a merged cell hands the caller the WHOLE range's slot
    ids for a one-shot bulk placement.
  - `DemandCoverageGrid` — same axis as `RoleGrid` but never merged; colors each cell from
    `evaluate()`'s `Report` via `grid.ts#indexReportByCell`.
  - `MetricsRow` / `ShortageReport` — render exclusively from `evaluate()`'s `Metrics`/`Report`.
    `ShortageReport` always splits into 3 columns (headcount / lead / skill-mix) instead of ever
    showing "解なし" (index.md §5.8).
  - `GeneratePanel` — the seed input + 自動生成/再生成 button.
  - `CellDrawer` / `DemandCellDrawer` — the 2 manual-edit dialogs (staff × slot, and demand cell).
    Both are warn-and-allow: a candidate with `hardViolations` warnings still gets a normal,
    always-enabled submit button — the deliberate asymmetry with auto-generation
    (index.md §5.1).

## The single write path (Stage 08's future instrumentation point)

```
generate action ──┐
                   ├──▶ writeAssignments(db, eventId, next) ──▶ DELETE + batch INSERT
assign/unassign ───┘
```

No route or component ever issues its own `INSERT`/`DELETE` against `assignments`.

## Client-side solver calls

`e.$id.roster.tsx`'s loader ships the fully-assembled `SolverInput` and current `Assignments` down
as loader data — as plain `[key, value][]` entry arrays, not raw `Map`s, so the wire format doesn't
depend on the framework's data-serialization internals. The route component reconstructs the real
`Map`s and `CellDrawer`/`DemandCellDrawer` (via `use-roster-drawers.ts`) call `hardViolations`/
`suggestFor` directly in the browser — they're plain functions with no D1/`window` dependency
(ADR-004), so this keeps every warning/suggestion the drawers show byte-identical to what
`evaluate()` already rendered the page's metrics from, with no extra server round trip per click.

## Warn-and-allow vs. never-violates (the one asymmetry not to "fix")

`solve()` (auto-generation) never produces a hard-constraint violation. `assign`/`unassign` (manual
editing) never block one — `hardViolations`' warning strings surface in the drawer, but the submit
button stays enabled. This is intentional (index.md §5.1: day-of exceptions are real), and is
pinned by a route-level test (`e.$id.roster.test.ts`: "allows assigning a staff member to a slot
they marked unavailable").
