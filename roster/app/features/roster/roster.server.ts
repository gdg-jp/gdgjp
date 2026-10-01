import type { EventRecord } from "~/features/events/events.server";
import { recordRevision } from "~/features/history/history.server";
import type { Actor } from "~/features/history/types";
import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import type { RosterSheet } from "~/features/roster-sheets/types";
import { evaluate } from "~/features/solver/evaluate";
import {
  type AssignmentValue,
  type Assignments,
  type Metrics,
  assignmentKey,
  parseAssignmentKey,
} from "~/features/solver/types";
import { readAssignmentsMap } from "./assignment-reads.server";
import { buildSolverInput } from "./solver-input.server";

export { readAssignments, readAssignmentsMap, toAssignment } from "./assignment-reads.server";

/** Sheet-scoped D1 access for the current assignments table. */

const ASSIGNMENT_COLS =
  "event_id, roster_sheet_id, application_id, time_slot_id, track_id, role_id, locked";

export type AssignmentState = {
  assignments: Assignments;
  revisionCursor: number | null;
};

/** Reads the cursor before the corresponding assignment map to support CAS writes. */
export async function readAssignmentsState(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<AssignmentState> {
  const sheet = await requireRosterSheet(db, eventId, rosterSheetId);
  const assignments = await readAssignmentsMap(db, eventId, sheet.id);
  return { assignments, revisionCursor: sheet.revisionCursor };
}

function assignmentStatement(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  applicationId: string,
  timeSlotId: string,
  value: AssignmentValue,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO assignments (${ASSIGNMENT_COLS})
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM roster_sheets s JOIN events e ON e.id = s.event_id
         WHERE s.id = ? AND s.event_id = ? AND s.deleted_at IS NULL
           AND s.revision_cursor = -1 AND e.deleted_at IS NULL
       )
         AND EXISTS (SELECT 1 FROM applications a WHERE a.id = ? AND a.event_id = ?)
         AND EXISTS (SELECT 1 FROM time_slots t
           WHERE t.id = ? AND t.event_id = ? AND t.roster_sheet_id = ?)
         AND EXISTS (SELECT 1 FROM tracks t
           WHERE t.id = ? AND t.event_id = ? AND t.roster_sheet_id = ?)
         AND EXISTS (SELECT 1 FROM roster_sheet_roles r
           WHERE r.roster_sheet_id = ? AND r.role_id = ?)
         AND EXISTS (SELECT 1 FROM demands d
           WHERE d.event_id = ? AND d.roster_sheet_id = ? AND d.time_slot_id = ?
             AND d.track_id = ? AND d.role_id = ? AND d.ideal_count > 0)
         AND NOT EXISTS (
           SELECT 1 FROM demands d
           WHERE d.event_id = ? AND d.time_slot_id = ? AND d.track_id = ? AND d.role_id = ?
             AND (d.roster_sheet_id IS NULL OR d.roster_sheet_id <> ?)
         )`,
    )
    .bind(
      eventId,
      rosterSheetId,
      applicationId,
      timeSlotId,
      value.trackId,
      value.roleId,
      value.locked ? 1 : 0,
      rosterSheetId,
      eventId,
      applicationId,
      eventId,
      timeSlotId,
      eventId,
      rosterSheetId,
      value.trackId,
      eventId,
      rosterSheetId,
      rosterSheetId,
      value.roleId,
      eventId,
      rosterSheetId,
      timeSlotId,
      value.trackId,
      value.roleId,
      eventId,
      timeSlotId,
      value.trackId,
      value.roleId,
      rosterSheetId,
    );
}

async function requireRosterSheet(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<RosterSheet> {
  const sheet =
    rosterSheetId !== undefined
      ? await getRosterSheet(db, eventId, rosterSheetId)
      : await getDefaultRosterSheet(db, eventId);
  if (!sheet) throw new Error("Roster sheet not found for this event.");
  return sheet;
}

function assignmentReplacementStatements(
  db: D1Database,
  eventId: string,
  sheetId: string,
  next: Assignments,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM assignments WHERE event_id = ? AND roster_sheet_id = ?
         AND EXISTS (
           SELECT 1 FROM roster_sheets s JOIN events e ON e.id = s.event_id
           WHERE s.id = ? AND s.event_id = ? AND s.deleted_at IS NULL
             AND s.revision_cursor = -1 AND e.deleted_at IS NULL
         )`,
      )
      .bind(eventId, sheetId, sheetId, eventId),
  ];
  for (const [key, value] of next) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    statements.push(assignmentStatement(db, eventId, sheetId, applicationId, slotId, value));
  }
  return statements;
}

async function validateAssignmentsForSheet(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  next: Assignments,
): Promise<void> {
  for (const [key, value] of next) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    const row = await db
      .prepare(
        `SELECT 1 AS valid
         FROM applications a
         JOIN time_slots s ON s.event_id = a.event_id AND s.id = ? AND s.roster_sheet_id = ?
         JOIN tracks t ON t.event_id = a.event_id AND t.id = ? AND t.roster_sheet_id = ?
         JOIN roster_sheet_roles r ON r.roster_sheet_id = ? AND r.role_id = ?
         WHERE a.id = ? AND a.event_id = ?
           AND EXISTS (
             SELECT 1 FROM demands d
             WHERE d.event_id = a.event_id AND d.roster_sheet_id = ?
               AND d.time_slot_id = s.id AND d.track_id = t.id
               AND d.role_id = r.role_id AND d.ideal_count > 0
           )
           AND NOT EXISTS (
             SELECT 1 FROM demands d
             WHERE d.event_id = a.event_id AND d.time_slot_id = s.id
               AND d.track_id = t.id AND d.role_id = r.role_id
               AND (d.roster_sheet_id IS NULL OR d.roster_sheet_id <> ?)
           )`,
      )
      .bind(
        slotId,
        rosterSheetId,
        value.trackId,
        rosterSheetId,
        rosterSheetId,
        value.roleId,
        applicationId,
        eventId,
        rosterSheetId,
        rosterSheetId,
      )
      .first<{ valid: number }>();
    if (!row) throw new Error("Assignment must reference entities in the selected roster sheet.");
  }
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
 * Replaces one sheet's ENTIRE `assignments` set with `next` — the single
 * write path every caller uses (module doc). Always a sheet-scoped delete-then-
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
  rosterSheetId?: string,
  expectedRevisionCursor?: number | null,
): Promise<void> {
  const sheet = await requireRosterSheet(db, eventId, rosterSheetId);
  const sheetId = sheet.id;
  await validateAssignmentsForSheet(db, eventId, sheetId, next);
  const mutationStatements = assignmentReplacementStatements(db, eventId, sheetId, next);
  if (revision) {
    await recordRevision(db, {
      eventId,
      assignments: next,
      metrics: revision.metrics,
      label: revision.label,
      actor: revision.actor,
      kind: revision.kind,
      groupKey: revision.groupKey,
      rosterSheetId: sheetId,
      ...(expectedRevisionCursor === undefined ? {} : { expectedRevisionCursor }),
      mutationStatements,
    });
    return;
  }

  const claim = db
    .prepare(
      `UPDATE roster_sheets SET revision_cursor = -1
       WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor IS ?
         AND EXISTS (SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL)`,
    )
    .bind(
      sheetId,
      eventId,
      expectedRevisionCursor === undefined ? sheet.revisionCursor : expectedRevisionCursor,
      eventId,
    );
  const release = db
    .prepare(
      `UPDATE roster_sheets SET revision_cursor = ?
       WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor = -1`,
    )
    .bind(
      expectedRevisionCursor === undefined ? sheet.revisionCursor : expectedRevisionCursor,
      sheetId,
      eventId,
    );
  const results = await db.batch([claim, ...mutationStatements, release]);
  if (results[0]?.meta.changes !== 1) {
    throw new Error("Roster sheet changed concurrently; retry the operation.");
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
  rosterSheetId?: string,
  expectedRevisionCursor?: number | null,
): Promise<void> {
  const sheet = await requireRosterSheet(db, event.id, rosterSheetId);
  const input = await buildSolverInput(
    db,
    {
      id: event.id,
      noSoloNewcomer: sheet.noSoloNewcomer,
      maxConsecutive: sheet.maxConsecutive,
    },
    sheet.seed,
    sheet.id,
  );
  const { metrics } = evaluate(input, next);
  await writeAssignments(
    db,
    event.id,
    next,
    {
      metrics,
      label: "手動編集",
      actor,
      kind: "edit",
      groupKey: actor.id,
    },
    sheet.id,
    expectedRevisionCursor,
  );
}
