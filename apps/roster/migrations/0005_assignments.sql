-- Stage 07: the current shift table (docs/roster/index.md §4 "assignments",
-- docs/roster/07-roster-manual-edit.md "Design" §1). Only the CURRENT
-- assignment set is kept here — history is Stage 08's `revisions` table
-- (ADR-006), not this one.
--
-- Primary key (application_id, time_slot_id) — NOT a surrogate `id` — is the
-- actual implementation of the hard constraint "never assign the same staff
-- member to the same time slot twice": with this key shape, a second INSERT
-- for the same (application, slot) pair is structurally impossible rather
-- than merely validated. Do not add a surrogate primary key instead of, or
-- alongside, this one.
--
-- `event_id` is derivable via `application_id`/`time_slot_id` but is stored
-- redundantly for cheap "wipe/reload one event's whole shift table" queries
-- (app/features/roster/roster.server.ts#writeAssignments does exactly a
-- DELETE WHERE event_id = ? then a bulk re-INSERT on every write — both auto
-- generation and manual edits funnel through that one function).
--
-- `locked` exists so the solver's `keepLocked` re-entry point
-- (app/features/solver/types.ts's `SolverInput.existingAssignments`) has a
-- column to read from Stage 08 onward. No UI sets it in this stage — the
-- lock feature is explicitly P1 (docs/roster/index.md §1).

CREATE TABLE assignments (
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  time_slot_id   TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  track_id       TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  role_id        TEXT NOT NULL REFERENCES roles(id),
  locked         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (application_id, time_slot_id)
);

CREATE INDEX assignments_event_idx ON assignments (event_id);
