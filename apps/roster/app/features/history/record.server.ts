import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import type { Assignments, Metrics } from "~/features/solver/types";
import { shouldMergeIntoHead } from "./grouping";
import { RETENTION_LIMIT, selectEvictions } from "./retention";
import { serializeSnapshot } from "./snapshot";
import type { Actor, RevisionKind } from "./types";

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

/** Payload for writes that should be recorded. Restore never records a row. */
export type RecordRevisionInput = {
  eventId: string;
  assignments: Assignments;
  metrics: Metrics;
  label: string;
  actor: Actor;
  kind: "generate" | "edit";
  groupKey?: string | null;
  rosterSheetId?: string;
  /** Cursor observed with the caller's assignment map; null is a valid expected state. */
  expectedRevisionCursor?: number | null;
  /** Guarded domain mutations to run after claiming the sheet cursor and before history changes. */
  mutationStatements?: readonly D1PreparedStatement[];
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

function recordGuardStatement(
  db: D1Database,
  eventId: string,
  sheetId: string,
  cursor: number | null,
  head: RevisionRow | null,
): D1PreparedStatement {
  const headGuard = head
    ? `AND EXISTS (
         SELECT 1 FROM revisions
         WHERE event_id = ? AND roster_sheet_id = ? AND seq = ? AND id = ?
           AND label = ? AND actor = ? AND actor_id IS ? AND kind = ?
           AND group_key IS ? AND snapshot = ? AND metrics = ? AND created_at = ?
       )`
    : cursor === null
      ? `AND NOT EXISTS (
           SELECT 1 FROM revisions WHERE event_id = ? AND roster_sheet_id = ?
         )`
      : `AND NOT EXISTS (
           SELECT 1 FROM revisions WHERE event_id = ? AND roster_sheet_id = ? AND seq = ?
         )`;
  const statement = db.prepare(
    `UPDATE roster_sheets SET revision_cursor = -1
     WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor IS ? ${headGuard}`,
  );
  if (head) {
    return statement.bind(
      sheetId,
      eventId,
      cursor,
      eventId,
      sheetId,
      cursor,
      head.id,
      head.label,
      head.actor,
      head.actor_id,
      head.kind,
      head.group_key,
      head.snapshot,
      head.metrics,
      head.created_at,
    );
  }
  return cursor === null
    ? statement.bind(sheetId, eventId, cursor, eventId, sheetId)
    : statement.bind(sheetId, eventId, cursor, eventId, sheetId, cursor);
}

/** Inserts or merges a revision, truncates its redo branch, and applies retention. */
export async function recordRevision(db: D1Database, input: RecordRevisionInput): Promise<void> {
  const sheetId = await resolveSheetId(db, input.eventId, input.rosterSheetId);
  const cursor = Object.hasOwn(input, "expectedRevisionCursor")
    ? (input.expectedRevisionCursor ?? null)
    : await getSheetCursor(db, input.eventId, sheetId);
  const head = cursor === null ? null : await getRevisionBySeq(db, input.eventId, sheetId, cursor);
  const now = new Date();
  const groupKey = input.groupKey ?? null;
  const snapshot = serializeSnapshot(input.assignments);
  const metricsJson = JSON.stringify(input.metrics);

  const statements: D1PreparedStatement[] = [
    recordGuardStatement(db, input.eventId, sheetId, cursor, head),
    ...(input.mutationStatements ?? []),
  ];
  const claimedSheet = `EXISTS (
    SELECT 1 FROM roster_sheets
    WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor = -1
  )`;
  if (cursor !== null) {
    statements.push(
      db
        .prepare(
          `DELETE FROM revisions WHERE event_id = ? AND roster_sheet_id = ? AND seq > ?
           AND ${claimedSheet}`,
        )
        .bind(input.eventId, sheetId, cursor, sheetId, input.eventId),
    );
  }

  const merge = Boolean(
    head &&
      shouldMergeIntoHead(
        { kind: head.kind as RevisionKind, groupKey: head.group_key, createdAt: head.created_at },
        { kind: input.kind, groupKey },
        now,
      ),
  );
  if (merge && head) {
    statements.push(
      db
        .prepare(
          `UPDATE revisions SET label = ?, snapshot = ?, metrics = ?, created_at = ?
           WHERE event_id = ? AND roster_sheet_id = ? AND seq = ? AND ${claimedSheet}`,
        )
        .bind(
          input.label,
          snapshot,
          metricsJson,
          now.toISOString(),
          input.eventId,
          sheetId,
          head.seq,
          sheetId,
          input.eventId,
        ),
    );
  } else {
    const newSeq = (cursor ?? 0) + 1;
    statements.push(
      db
        .prepare(
          `INSERT INTO revisions
             (id, event_id, seq, label, actor, actor_id, kind, group_key, snapshot, metrics, created_at, roster_sheet_id)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE ${claimedSheet}`,
        )
        .bind(
          crypto.randomUUID(),
          input.eventId,
          newSeq,
          input.label,
          input.actor.name,
          input.actor.id,
          input.kind,
          groupKey,
          snapshot,
          metricsJson,
          now.toISOString(),
          sheetId,
          sheetId,
          input.eventId,
        ),
    );
    const remaining = await db
      .prepare("SELECT seq FROM revisions WHERE event_id = ? AND roster_sheet_id = ? AND seq <= ?")
      .bind(input.eventId, sheetId, cursor ?? 0)
      .all<{ seq: number }>();
    const remainingSeqs = [...(remaining.results ?? []).map((r) => r.seq), newSeq];
    for (const seq of selectEvictions(remainingSeqs, newSeq, RETENTION_LIMIT)) {
      statements.push(
        db
          .prepare(
            `DELETE FROM revisions WHERE event_id = ? AND roster_sheet_id = ? AND seq = ?
             AND ${claimedSheet}`,
          )
          .bind(input.eventId, sheetId, seq, sheetId, input.eventId),
      );
    }
  }

  const nextCursor = merge ? cursor : (cursor ?? 0) + 1;
  if (sheetId === `default:${input.eventId}`) {
    statements.push(
      db
        .prepare(
          `UPDATE events SET revision_cursor = ? WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM roster_sheets WHERE id = ? AND event_id = ?
               AND revision_cursor = -1 AND deleted_at IS NULL
           )`,
        )
        .bind(nextCursor, input.eventId, sheetId, input.eventId),
    );
  } else {
    statements.push(
      db
        .prepare(
          "UPDATE roster_sheets SET revision_cursor = ? WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND revision_cursor = -1",
        )
        .bind(nextCursor, sheetId, input.eventId),
    );
  }
  const results = await db.batch(statements);
  if (results[0]?.meta.changes !== 1) {
    throw new Error("History changed concurrently; retry the operation.");
  }
}
