# schedule

The time-slot grid (`time_slots`, split into `phases`) plus `tracks` and the seeded `roles`
master (`event_roles`). `time_slots` is the axis every later stage joins demand, availability,
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
- `tracks.server.ts` — tracks CRUD/reorder, the read-only roles master, and `event_roles`
  selection. Split from `schedule.server.ts` to stay under the file-size cap — tracks/roles have
  no `idx`-contiguity concern to share with the regenerate machinery.
- `components/` — `PhaseList`, `TrackEditor`, `RolePicker` (all on `/e/:id/design`).

Events themselves (the `events` table, status lifecycle) are a separate feature:
`~/features/events/`.
