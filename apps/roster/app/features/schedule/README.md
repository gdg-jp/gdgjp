# schedule

The time-slot grid (`time_slots`, split into `phases`) plus `tracks` and the `roles` master:
six seeded roles shared by every event plus each event's own roles (ADR-011), selected per sheet
in `roster_sheet_roles`. `time_slots` is the axis every later stage joins demand, availability,
and assignment against (`docs/roster/index.md` §4) — its `idx` must stay a contiguous 0-based
sequence per event.

Entry points:

- `slots.ts` — pure grid math: `buildSlots` splits `[start, end)` into `stepMin`-wide slots and
  assigns each to a phase. No D1.
- `reconcile.ts` — pure `reconcileSlotKeys`: diffs an existing slot set against a freshly built
  one by `(start, end)` key so a slot whose key is unchanged keeps its `id` across a schedule
  edit (later stages' `demands`/`availabilities` rows reference `time_slot_id`).
- `schedule.server.ts` — phases CRUD + `regenerateTimeSlots`, which runs `buildSlots` +
  `reconcileSlotKeys` and writes the result back with a two-phase `idx` update (see the file's
  doc comment for why a direct old-idx -> new-idx `UPDATE` isn't safe under
  `UNIQUE(event_id, idx)`).
- `tracks.server.ts` — tracks CRUD/reorder. Split from `schedule.server.ts` to stay under the
  file-size cap — tracks have no `idx`-contiguity concern to share with the regenerate machinery.
- `roles.server.ts` — the roles master and per-sheet selection. `listRoles(db, eventId)` is
  always event-scoped (seeded + that event's own); `createEventRole` / `renameEventRole` /
  `deleteEventRole` manage the event's own roles. Deletion is refused while a live sheet has an
  `ideal > 0` demand or an assignment for the role, and otherwise removes every referencing row.
- `role-name.ts` — pure name validation (length, NFKC/case-insensitive duplicates, per-event
  limit). `role-intents.server.ts` — the design route's `setRoles` / `createRole` /
  `renameRole` / `deleteRole` action intents.
- `components/` — `PhaseList`, `TrackEditor`, `RolePicker` (all on `/e/:id/s/:sheetId/design`).

Events themselves (the `events` table, status lifecycle) are a separate feature:
`~/features/events/`.
