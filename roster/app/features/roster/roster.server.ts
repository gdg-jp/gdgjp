import type { EventRecord } from "~/features/events/events.server";
import { recordRevision } from "~/features/history/history.server";
import type { Actor } from "~/features/history/types";
import { evaluate } from "~/features/solver/evaluate";
import {
  type AssignmentValue,
  type Assignments,
  type Metrics,
  assignmentKey,
  parseAssignmentKey,
} from "~/features/solver/types";
import { buildSolverInput } from "./solver-input.server";
import type { AssignmentRecord } from "./types";

/**
 * D1 access for `assignments` (docs/roster/index.md §4,
 * docs/roster/07-roster-manual-edit.md "Design" §1, §6). Follows the repo's
 * `*Row` -> `to*()` -> column-list -> convention, but the write side is
 * intentionally NOT the usual single-row `INSERT ... RETURNING`: both
 * auto-generation and manual editing produce a full replacement
 * `Assignments` map (solve()'s output, or the current map with one cell
 * changed — see `e.$id.roster.tsx`'s action), so `writeAssignments` always
 * deletes the event's whole current set and re-inserts it via `db.batch`
 * (docs/roster/07-roster-manual-edit.md Design §2 step 4: "assignments を
 * 全削除して入れ直す（db.batch で原子的に）").
 *
 * **`writeAssignments` is the ONLY function anywhere in this app that
 * writes to `assignments`.** The generate action and every manual-edit
 * intent in `e.$id.roster.tsx` all funnel through it — this is deliberate
 * so Stage 08 can instrument exactly one call site to add history
 * (docs/roster/07-roster-manual-edit.md "Design" §6). Do not add a second
 * write path (e.g. a route calling `db.prepare("INSERT INTO assignments...")`
 * directly) no matter how small the change looks.
 *
 * **Stage 08's hook**: `writeAssignments` takes an optional `revision`
 * argument. When present, it calls `~/features/history/history.server`'s
 * `recordRevision` after the write (docs/roster/08-history.md "Design" §3:
 * "`writeAssignments` から呼ぶ"). When omitted — exactly one caller does this:
 * `history.server.ts#restoreRevision`, restoring a snapshot — no revision is
 * recorded (docs/roster/08-history.md "Design" §5: "復元そのものは新しい履歴を
 * 作らない"). See `history.server.ts`'s module doc comment for why this
 * creates (and why it's safe to create) a two-way import with that file.
 */

type AssignmentRow = {
  event_id: string;
  application_id: string;
  time_slot_id: string;
  track_id: string;
  role_id: string;
  locked: number;
};

const ASSIGNMENT_COLS = "event_id, application_id, time_slot_id, track_id, role_id, locked";

export function toAssignment(r: AssignmentRow): AssignmentRecord {
  return {
    eventId: r.event_id,
    applicationId: r.application_id,
    timeSlotId: r.time_slot_id,
    trackId: r.track_id,
    roleId: r.role_id,
    locked: r.locked === 1,
  };
}

/**
 * An event's current shift table, one row per (application, slot)
 * (docs/roster/index.md §4). Ordered by time slot then application so a
 * caller building a display grid never has to re-sort — not a determinism
 * requirement itself (generation's determinism lives entirely in
 * `solver-input.server.ts`'s assembly and `solve()`'s own guarantee), just a
 * convenience for the grid components that read this.
 */
export async function readAssignments(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<AssignmentRecord[]> {
  const sheetFilter = rosterSheetId === undefined ? "" : " AND roster_sheet_id = ?";
  const { results } = await db
    .prepare(
      `SELECT ${ASSIGNMENT_COLS} FROM assignments
       WHERE event_id = ?${sheetFilter}
       ORDER BY time_slot_id, application_id`,
    )
    .bind(...(rosterSheetId === undefined ? [eventId] : [eventId, rosterSheetId]))
    .all<AssignmentRow>();
  return (results ?? []).map(toAssignment);
}

/** `readAssignments`, reshaped into the solver's own `Assignments` Map —
 * what `evaluate()` / `hardViolations()` / `suggestFor()` all take. */
export async function readAssignmentsMap(db: D1Database, eventId: string): Promise<Assignments> {
  const rows = await readAssignments(db, eventId);
  const map: Assignments = new Map();
  for (const row of rows) {
    map.set(assignmentKey(row.applicationId, row.timeSlotId), {
      trackId: row.trackId,
      roleId: row.roleId,
      locked: row.locked,
    });
  }
  return map;
}

function assignmentStatement(
  db: D1Database,
  eventId: string,
  applicationId: string,
  timeSlotId: string,
  value: AssignmentValue,
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO assignments (${ASSIGNMENT_COLS}) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(eventId, applicationId, timeSlotId, value.trackId, value.roleId, value.locked ? 1 : 0);
}

/** Stage 08's hook payload (module doc above) — `kind` excludes `"restore"`
 * at the type level since restoring never passes this argument at all. */
export type WriteAssignmentsRevision = {
  metrics: Metrics;
  label: string;
  actor: Actor;
  kind: "generate" | "edit";
  /** The merge key `history.server.ts`'s `recordRevision` groups consecutive
   * edits by — pass the acting user's id for `kind: "edit"` (docs/roster/
   * 08-history.md "Design" §3: "同一ユーザー × 同一イベント"). Ignored for
   * `kind: "generate"`, which never merges regardless of this value. */
  groupKey?: string | null;
};

/**
 * Replaces an event's ENTIRE `assignments` set with `next` — the single
 * write path every caller uses (module doc). Always a full delete-then-
 * insert, never a partial patch: this is what guarantees a stale row from a
 * previous generation can never survive alongside a new one
 * (docs/roster/07-roster-manual-edit.md "回帰として固定すべきテスト": "生成後に
 * assignments の古い行が残っていない").
 */
export async function writeAssignments(
  db: D1Database,
  eventId: string,
  next: Assignments,
  revision?: WriteAssignmentsRevision,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM assignments WHERE event_id = ?").bind(eventId),
  ];
  for (const [key, value] of next) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    statements.push(assignmentStatement(db, eventId, applicationId, slotId, value));
  }
  await db.batch(statements);

  if (revision) {
    await recordRevision(db, {
      eventId,
      assignments: next,
      metrics: revision.metrics,
      label: revision.label,
      actor: revision.actor,
      kind: revision.kind,
      groupKey: revision.groupKey,
    });
  }
}

/**
 * The `assign`/`unassign` intents' shared tail (docs/roster/08-history.md
 * "Design" §3): both produce a full replacement `Assignments` map and need
 * the identical revision recorded afterward — re-evaluate against the
 * event's current `SolverInput` and write through with `kind: "edit"`,
 * using the acting user's id as the merge `groupKey` so consecutive edits by
 * the SAME person collapse per `grouping.ts`'s 5-minute window. Lives here
 * (not in the route) per this app's placement rule: logic beyond "read the
 * request, call a feature, shape the response" belongs in a feature's
 * `*.server.ts`, not `app/routes/`.
 */
export async function writeManualEdit(
  db: D1Database,
  event: EventRecord,
  actor: Actor,
  next: Assignments,
): Promise<void> {
  const input = await buildSolverInput(db, event, event.seed);
  const { metrics } = evaluate(input, next);
  await writeAssignments(db, event.id, next, {
    metrics,
    label: "手動編集",
    actor,
    kind: "edit",
    groupKey: actor.id,
  });
}
