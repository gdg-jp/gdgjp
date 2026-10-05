# history

Operation history for the shift table: the `revisions` table, undo/redo, and restoring to an
arbitrary earlier point. See `docs/roster/08-history.md` and ADR-006 (JSON snapshot + a single
current `assignments` table, not per-timepoint row duplication — this feature never adds a second
row per assignment per revision).

Entry points:

- `types.ts` — `RevisionKind` (`"generate" | "edit" | "restore"` — `restore` is reserved; nothing
  in this stage writes it, since restoring never creates a revision), `Actor`, the versioned
  `SnapshotV1`/`SnapshotItem` JSON shape, `RevisionSummary`/`HistoryState` (what the loader and
  the UI components consume), and `RestoreResult` (`{ droppedCount }`).
- `snapshot.ts` — `Assignments` <-> `revisions.snapshot`'s JSON, versioned via a `v` field.
  `parseSnapshot`/`fromSnapshot` throw on an unrecognized `v` rather than guessing a mapping — a
  silently-misread snapshot would corrupt `assignments` on restore with no error anywhere near the
  mistake.
- `grouping.ts` — `shouldMergeIntoHead`, the pure decision behind "consecutive manual edits within
  5 minutes by the same actor collapse into one revision entry." `GROUP_WINDOW_MS` is the single
  place that constant lives. A `generate` never merges, regardless of timing or actor.
- `retention.ts` — `selectEvictions`, the pure decision behind the 50-entry retention cap:
  oldest-`seq`-first, but never the `seq` the cursor currently points at (even in a contrived case
  where protecting it means staying one entry over the cap).
- `cursor.ts` — `canUndo`/`canRedo`, pure functions over a `HistoryState` that the route and
  `UndoRedoButtons` both read from, so the buttons' enabled/disabled state can never disagree with
  what the history panel below them shows.
- `history.server.ts` — the D1 access layer: `recordRevision` (insert-or-merge-into-head, with
  future-truncation and retention eviction all in one `db.batch` — the truncation runs on BOTH the
  merge and the insert path, since a rewound cursor can land on a mergeable `edit` head too),
  `restoreRevision` (snapshot -> `writeAssignments`, cursor move, stale-id filtering with a
  reported count — never creates a revision; returns `null`, not a throw, when `seq` itself
  doesn't exist), `tryRestoreRevision` (the route's `restore` intent wrapper: a client-submitted
  `seq` can go stale between page load and click, e.g. retention evicted it, so this checks
  `restoreRevision`'s `null` return for exactly that condition and returns `{ found: false }`
  instead of letting the route 500 — an unrelated error still propagates as a real error, rather
  than a broad `catch` mislabeling it "not found"), `undoRevision`/`redoRevision` (look up an
  adjacent `seq` themselves and call `restoreRevision` directly — never stale, so no wrapper
  needed), and `getHistoryState` (the panel's + buttons' entire data need, newest-`seq`-first).
- `components/HistoryPanel.tsx` — the newest-first revision list below the shift table: label,
  time, actor, kind, and each row's own `evaluate()` metrics (never re-derived), the current
  cursor marked, and a "戻す" button on every OTHER row.
- `components/UndoRedoButtons.tsx` — the "← 元に戻す" / "やり直す →" operation row, disabled at
  either boundary per `cursor.ts`.

## The two-way import with `~/features/roster/roster.server`

This is the one place in the codebase where two features import each other, and it is
intentional:

```
roster.server.ts#writeAssignments ──(when a `revision` argument is given)──▶ recordRevision
history.server.ts#restoreRevision ──(the ONE write path, per docs/roster/07 & 08)──▶ writeAssignments
```

- `writeAssignments` takes an optional `revision` argument. When present, it calls
  `recordRevision` after the D1 write — this is Stage 08's entire hook into Stage 07's single
  write path (docs/roster/08-history.md "Design" §3: "`writeAssignments` から呼ぶ").
- `restoreRevision` must reuse that SAME write path for its own D1 write (docs/roster/08-history.md
  "Design" §5: "via `writeAssignments`, not a new bespoke write path") — but it calls
  `writeAssignments` WITHOUT a `revision` argument, which is what keeps a restore from creating a
  new history entry.

Both directions only ever call the other's function from inside an `async` function body, at
request time — never from top-level module code — and both are `function` declarations (hoisted),
so this carries no ESM init-order hazard. See `history.server.ts`'s module doc comment for the
full reasoning.

## Restoring degrades gracefully, never throws

A snapshot can outlive the rows it references: a staff member can withdraw, or the event's time
slots can be regenerated, after a snapshot was taken. `restoreRevision` filters the snapshot down
to `application_id`s that still exist AND are not withdrawn, and `time_slot_id`s that still exist
for the event, before calling `writeAssignments` — never letting a stale reference reach a foreign
key or corrupt `assignments`. The number of filtered-out entries is returned as `droppedCount` and
surfaced by the route as "N件の割当は対象が存在しないため復元されませんでした。"
