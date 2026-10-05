-- Stage 08: operation history for the shift table (docs/roster/index.md §4
-- "revisions", docs/roster/08-history.md "Design" §1, ADR-006).
--
-- `assignments` (Stage 07) stays the ONLY current shift table — this table
-- does NOT duplicate assignment rows per timepoint. Each row here is a full
-- JSON snapshot of `assignments` at one point in time, plus the `evaluate()`
-- metrics computed for that snapshot. Restoring means reading `snapshot`
-- back into `assignments` (via `roster.server.ts#writeAssignments`) and
-- moving `events.revision_cursor` — never inserting/duplicating rows into
-- `assignments` itself.
--
-- `seq` is a per-event 1-based sequence (NOT a global autoincrement): undo/
-- redo/restore all address a revision by (event_id, seq), and truncating
-- "future" history after an edit made from a rewound cursor deletes by
-- `seq > cursor` — a plain integer counter keeps that a simple range
-- comparison instead of needing a separate ordering column.
--
-- `group_key` backs the "collapse consecutive manual edits" rule
-- (docs/roster/08-history.md "Design" §3): it identifies "same actor" so an
-- edit only merges into the current head when both the actor and the kind
-- ('edit') match, in addition to the 5-minute window checked against
-- `created_at` (app/features/history/grouping.ts). `generate`/`restore`
-- never merge regardless of `group_key`.
--
-- `snapshot`/`metrics` are TEXT (JSON), not decomposed columns: they are a
-- point-in-time copy, not the schema's source of truth (ADR-006
-- Consequences). `snapshot` embeds its own `v` (schema version) field inside
-- the JSON so `app/features/history/snapshot.ts` can branch by version if
-- `assignments`' columns ever change shape.

CREATE TABLE revisions (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,          -- per-event sequence, 1-based
  label       TEXT NOT NULL,             -- "自動生成（シード 20261114）", "手動編集"
  actor       TEXT NOT NULL,             -- display name, captured at write time
  actor_id    TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('generate','edit','restore')),
  group_key   TEXT,                      -- merge key for consecutive edits; NULL = never merges
  snapshot    TEXT NOT NULL,             -- JSON: { v: 1, items: [{ a, s, t, r, l }, ...] }
  metrics     TEXT NOT NULL,             -- JSON: evaluate()'s Metrics, verbatim
  created_at  TEXT NOT NULL,
  UNIQUE (event_id, seq)
);
CREATE INDEX revisions_event_seq ON revisions (event_id, seq);

-- The cursor: which revision's snapshot is currently reflected in
-- `assignments`. NULL means "no history yet" (no generate/edit has run).
-- Undo/redo/restore move this column and re-expand that revision's snapshot
-- into `assignments` — they never insert into `revisions` themselves
-- (docs/roster/08-history.md "Design" §5: "復元そのものは新しい履歴を作らない").
ALTER TABLE events ADD COLUMN revision_cursor INTEGER;
