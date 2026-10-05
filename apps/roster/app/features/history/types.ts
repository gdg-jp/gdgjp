import type { Metrics } from "~/features/solver/types";

/**
 * Domain types for the `revisions` table (docs/roster/index.md §4,
 * docs/roster/08-history.md "Design" §1, ADR-006). This feature does NOT
 * re-declare the solver's `Assignments`/`AssignmentValue` types — `snapshot.ts`
 * converts directly between those (imported from `~/features/solver/types`)
 * and the JSON shape below, per docs/roster/08-history.md "再利用する既存実装".
 */

/** `revisions.kind` — a CHECK-constrained enum in the migration.
 * `restore` is written by nothing in this stage (docs/roster/08-history.md
 * "Design" §5: restoring never creates a revision); it is reserved for a
 * future "branch recorded when editing from a rewound cursor" use, exactly
 * as the stage doc describes. */
export type RevisionKind = "generate" | "edit" | "restore";

/** Who performed a generate/edit/restore — `id` for `actor_id` (nullable in
 * the schema, but every caller in this app always has a signed-in user), and
 * `name` for the display-name `actor` column. */
export type Actor = { id: string; name: string };

/** `docs/roster/08-history.md` "Design" §1 — the short-keyed per-slot entry
 * inside a snapshot's `items` array. Keys are single letters because a
 * snapshot's size scales with (staff × slots) per revision × up to 50
 * retained revisions (docs/roster/08-history.md Context "前提として確認済みの事実"). */
export type SnapshotItem = {
  /** applicationId */
  a: string;
  /** slotId */
  s: string;
  /** trackId */
  t: string;
  /** roleId */
  r: string;
  /** locked, as 0 | 1 (mirrors `assignments.locked`'s own INTEGER encoding) */
  l: 0 | 1;
};

/** The only snapshot shape this stage writes or reads. `snapshot.ts` widens
 * incoming JSON to `unknown` first and narrows explicitly — see its
 * `parseSnapshot`'s doc comment for why an unrecognized `v` must throw
 * rather than silently misreading a future column layout. */
export type SnapshotV1 = { v: 1; items: SnapshotItem[] };

/** One `revisions` row, mapped shape (parallels `AssignmentRecord` in
 * `~/features/roster/types`) — `snapshot` is intentionally NOT included:
 * nothing in this stage needs a full snapshot's JSON outside of
 * `restoreRevision` itself, which reads it directly from D1 instead of
 * round-tripping it through this type (docs/roster/08-history.md Design §6:
 * the history panel only ever needs a revision's metrics/label/actor). */
export type RevisionSummary = {
  seq: number;
  label: string;
  actor: string;
  actorId: string | null;
  kind: RevisionKind;
  groupKey: string | null;
  metrics: Metrics;
  createdAt: string;
};

/** `/e/:id/roster`'s history panel + undo/redo controls read exactly this
 * shape (docs/roster/08-history.md "Design" §6). `revisions` is newest-seq
 * first, matching the panel's "新しい順に並べる" requirement. */
export type HistoryState = {
  cursor: number | null;
  revisions: RevisionSummary[];
};

/** `restoreRevision`'s result — the stage doc's own signature returns
 * `Promise<void>`, but "N 件の割当は対象が存在しないため復元されませんでした"
 * (Design §5) has to come from somewhere the caller can render, so this
 * stage returns the dropped count instead of void. See history.server.ts's
 * module doc comment for the full reasoning. */
export type RestoreResult = { droppedCount: number };
