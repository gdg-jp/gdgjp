-- Stage 03 demand input: (time_slot x track x role) headcount + skill-mix
-- targets. See docs/roster/index.md §4 ("ドメインモデル") and
-- docs/roster/03-demand-input.md "Design" §1 for the design this follows.
--
-- `event_id` is denormalized (reachable via time_slot_id -> time_slots ->
-- event_id) so the matrix UI and, later, the solver (Stage 06) can load an
-- event's entire demand set in one indexed query instead of a join through
-- time_slots for every read.
--
-- `min`/`ideal` are SQL-adjacent reserved-ish words, so the columns are
-- `min_count`/`ideal_count`; the domain type (`app/features/demand/types.ts`)
-- uses the short `min`/`ideal` names from docs/roster/index.md §5.
--
-- `ideal_count = 0` means "this role isn't needed in this slot" — the same
-- meaning as the row not existing at all (docs/roster/03-demand-input.md
-- "Design" §2). Every read path must treat both forms identically.
CREATE TABLE demands (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  time_slot_id TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  track_id     TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  role_id      TEXT NOT NULL REFERENCES roles(id),
  min_count    INTEGER NOT NULL DEFAULT 0,
  ideal_count  INTEGER NOT NULL DEFAULT 0,
  lead_min     INTEGER NOT NULL DEFAULT 0,
  new_max      INTEGER NOT NULL DEFAULT 99,
  PRIMARY KEY (time_slot_id, track_id, role_id)
);

CREATE INDEX demands_event_idx ON demands (event_id);
