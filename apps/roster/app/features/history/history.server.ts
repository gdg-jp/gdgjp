import { listApplicationsForEvent } from "~/features/applications/applications.server";
import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import { listTimeSlots } from "~/features/schedule/schedule.server";
import { type Assignments, type Metrics, parseAssignmentKey } from "~/features/solver/types";
import { parseSnapshot } from "./snapshot";
import type { Actor, HistoryState, RestoreResult, RevisionKind, RevisionSummary } from "./types";
export { recordRevision } from "./record.server";
export type { RecordRevisionInput } from "./record.server";

/**
 * D1 access for sheet-scoped `revisions` and `roster_sheets.revision_cursor`
 * (docs/roster/index.md §4, docs/roster/08-history.md "Design" §3-5, ADR-006).
 * `roster.server.ts#writeAssignments` calls `recordRevision` for writes. The
 * restore path replaces only one sheet's assignment rows and cursor atomically.
 */

type RevisionRow = {
  id: string;
  event_id: string;
  seq: number;
  label: string;
  actor: string;
  actor_id: string | null;
  kind: string;
  group_key: string | null;
  snapshot: string;
  metrics: string;
  created_at: string;
};

async function resolveSheetId(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<string> {
  const sheet =
    rosterSheetId === undefined
      ? await getDefaultRosterSheet(db, eventId)
      : await getRosterSheet(db, eventId, rosterSheetId);
  if (!sheet) throw new Error("Roster sheet does not belong to this event or is not live");
  return sheet.id;
}

async function getSheetCursor(
  db: D1Database,
  eventId: string,
  sheetId: string,
): Promise<number | null> {
  const row = await db
    .prepare("SELECT revision_cursor FROM roster_sheets WHERE id = ? AND event_id = ?")
    .bind(sheetId, eventId)
    .first<{ revision_cursor: number | null }>();
  return row?.revision_cursor ?? null;
}

/** Restores one sheet's assignment set without disturbing sibling sheets. */
async function replaceSheetAssignments(
  db: D1Database,
  eventId: string,
  sheetId: string,
  observedCursor: number | null,
  revision: RevisionRow,
  assignments: Assignments,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE roster_sheets SET revision_cursor = -1
         WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor IS ?
           AND EXISTS (
             SELECT 1 FROM revisions
             WHERE event_id = ? AND roster_sheet_id = ? AND seq = ? AND id = ?
               AND snapshot = ? AND created_at = ?
           )`,
      )
      .bind(
        sheetId,
        eventId,
        observedCursor,
        eventId,
        sheetId,
        revision.seq,
        revision.id,
        revision.snapshot,
        revision.created_at,
      ),
    db
      .prepare(
        `DELETE FROM assignments WHERE event_id = ? AND roster_sheet_id = ?
         AND EXISTS (
           SELECT 1 FROM roster_sheets
           WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor = -1
         )`,
      )
      .bind(eventId, sheetId, sheetId, eventId),
  ];
  for (const [key, value] of assignments) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    statements.push(
      db
        .prepare(
          `INSERT INTO assignments
             (event_id, application_id, time_slot_id, track_id, role_id, locked, roster_sheet_id)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
           SELECT 1 FROM roster_sheets WHERE id = ? AND event_id = ? AND deleted_at IS NULL
             AND revision_cursor = -1
           )`,
        )
        .bind(
          eventId,
          applicationId,
          slotId,
          value.trackId,
          value.roleId,
          value.locked ? 1 : 0,
          sheetId,
          sheetId,
          eventId,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE roster_sheets SET revision_cursor = ?
         WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor = -1`,
      )
      .bind(revision.seq, sheetId, eventId),
  );
  if (sheetId === `default:${eventId}`) {
    statements.push(
      db
        .prepare(
          `UPDATE events SET revision_cursor = ? WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM roster_sheets WHERE id = ? AND event_id = ?
               AND revision_cursor = ? AND deleted_at IS NULL
           )`,
        )
        .bind(revision.seq, eventId, sheetId, eventId, revision.seq),
    );
  }
  const results = await db.batch(statements);
  if (results[0]?.meta.changes !== 1) {
    throw new Error("Revision changed concurrently; retry the operation.");
  }
}

async function getRevisionBySeq(
  db: D1Database,
  eventId: string,
  sheetId: string,
  seq: number,
): Promise<RevisionRow | null> {
  return db
    .prepare(
      `SELECT id, event_id, seq, label, actor, actor_id, kind, group_key, snapshot, metrics, created_at
       FROM revisions WHERE event_id = ? AND roster_sheet_id = ? AND seq = ?`,
    )
    .bind(eventId, sheetId, seq)
    .first<RevisionRow>();
}

/**
 * Restores `assignments` to revision `seq`'s snapshot and moves the cursor
 * there — never inserts a revision (docs/roster/08-history.md "Design" §5).
 * Filters out any snapshot entry whose application is gone or withdrawn, or
 * whose slot, track, or role no longer belongs to this sheet (a withdrawal or
 * schedule/configuration change since the snapshot — docs/roster/08-history.md
 * "Design" §5), reporting the dropped count instead of
 * throwing or letting a foreign-key violation reach the caller.
 *
 * Returns `null` — rather than throwing — when `seq` itself doesn't name a
 * revision for this event, so `tryRestoreRevision` (below) can distinguish
 * "this specific, expected condition" from any other unrelated failure
 * (a D1 error, a corrupt snapshot, ...) without a broad `catch` that would
 * risk mislabeling those as "not found" too.
 */
export async function restoreRevision(
  db: D1Database,
  eventId: string,
  seq: number,
  // Accepted per the stage doc's signature; unused today because a restore
  // writes no row anywhere that would record who performed it — kept for the
  // `kind: 'restore'` branch-recording use the stage doc reserves (Design §5).
  _actor: Actor,
  rosterSheetId?: string,
): Promise<RestoreResult | null> {
  const sheetId = await resolveSheetId(db, eventId, rosterSheetId);
  const row = await getRevisionBySeq(db, eventId, sheetId, seq);
  if (!row) return null;
  const observedCursor = await getSheetCursor(db, eventId, sheetId);

  const snapshotAssignments = parseSnapshot(row.snapshot);

  const [applications, timeSlots] = await Promise.all([
    listApplicationsForEvent(db, eventId),
    listTimeSlots(db, eventId, sheetId),
  ]);
  const validApplicationIds = new Set(applications.filter((a) => !a.withdrawn).map((a) => a.id));
  const validSlotIds = new Set(timeSlots.map((s) => s.id));
  const [trackRows, roleRows] = await Promise.all([
    db
      .prepare("SELECT id FROM tracks WHERE event_id = ? AND roster_sheet_id = ?")
      .bind(eventId, sheetId)
      .all<{ id: string }>(),
    db
      .prepare("SELECT role_id AS id FROM roster_sheet_roles WHERE roster_sheet_id = ?")
      .bind(sheetId)
      .all<{ id: string }>(),
  ]);
  const validTrackIds = new Set((trackRows.results ?? []).map((r) => r.id));
  const validRoleIds = new Set((roleRows.results ?? []).map((r) => r.id));

  let droppedCount = 0;
  const filtered: Assignments = new Map();
  for (const [key, value] of snapshotAssignments) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    if (
      !validApplicationIds.has(applicationId) ||
      !validSlotIds.has(slotId) ||
      !validTrackIds.has(value.trackId) ||
      !validRoleIds.has(value.roleId)
    ) {
      droppedCount++;
      continue;
    }
    filtered.set(key, value);
  }

  // Restore does not create history and must preserve every sibling sheet.
  await replaceSheetAssignments(db, eventId, sheetId, observedCursor, row, filtered);

  return { droppedCount };
}

export type RestoreOutcome = { found: true; droppedCount: number } | { found: false };

/** Request-facing wrapper that maps a missing or evicted revision to `found: false`. */
export async function tryRestoreRevision(
  db: D1Database,
  eventId: string,
  seq: number,
  actor: Actor,
  rosterSheetId?: string,
): Promise<RestoreOutcome> {
  const result = await restoreRevision(db, eventId, seq, actor, rosterSheetId);
  if (!result) return { found: false };
  return { found: true, droppedCount: result.droppedCount };
}

/** Moves the cursor one step toward `seq 1` and restores that snapshot, or
 * returns `null` (no-op) when already at the oldest revision or there is no
 * history yet — the route's "← 元に戻す" action. */
export async function undoRevision(
  db: D1Database,
  eventId: string,
  actor: Actor,
  rosterSheetId?: string,
): Promise<RestoreResult | null> {
  const sheetId = await resolveSheetId(db, eventId, rosterSheetId);
  const cursor = await getSheetCursor(db, eventId, sheetId);
  if (cursor === null) return null;
  const prev = await db
    .prepare(
      "SELECT seq FROM revisions WHERE event_id = ? AND roster_sheet_id = ? AND seq < ? ORDER BY seq DESC LIMIT 1",
    )
    .bind(eventId, sheetId, cursor)
    .first<{ seq: number }>();
  if (!prev) return null;
  return restoreRevision(db, eventId, prev.seq, actor, sheetId);
}

/** The redo counterpart of `undoRevision` — the route's "やり直す →" action. */
export async function redoRevision(
  db: D1Database,
  eventId: string,
  actor: Actor,
  rosterSheetId?: string,
): Promise<RestoreResult | null> {
  const sheetId = await resolveSheetId(db, eventId, rosterSheetId);
  const cursor = await getSheetCursor(db, eventId, sheetId);
  if (cursor === null) return null;
  const next = await db
    .prepare(
      "SELECT seq FROM revisions WHERE event_id = ? AND roster_sheet_id = ? AND seq > ? ORDER BY seq ASC LIMIT 1",
    )
    .bind(eventId, sheetId, cursor)
    .first<{ seq: number }>();
  if (!next) return null;
  return restoreRevision(db, eventId, next.seq, actor, sheetId);
}

/** The history panel's + undo/redo buttons' entire data need (docs/roster/
 * 08-history.md "Design" §6): newest-seq-first, each row carrying its own
 * `evaluate()` metrics so revisions can be compared without re-running
 * anything. Deliberately excludes `snapshot` (never needed by the UI). */
export async function getHistoryState(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<HistoryState> {
  const sheetId = await resolveSheetId(db, eventId, rosterSheetId);
  const cursor = await getSheetCursor(db, eventId, sheetId);
  const { results } = await db
    .prepare(
      `SELECT seq, label, actor, actor_id, kind, group_key, metrics, created_at
       FROM revisions WHERE event_id = ? AND roster_sheet_id = ? ORDER BY seq DESC`,
    )
    .bind(eventId, sheetId)
    .all<Omit<RevisionRow, "id" | "event_id" | "snapshot">>();

  const revisions: RevisionSummary[] = (results ?? []).map((r) => ({
    seq: r.seq,
    label: r.label,
    actor: r.actor,
    actorId: r.actor_id,
    kind: r.kind as RevisionKind,
    groupKey: r.group_key,
    metrics: JSON.parse(r.metrics) as Metrics,
    createdAt: r.created_at,
  }));

  return { cursor, revisions };
}
