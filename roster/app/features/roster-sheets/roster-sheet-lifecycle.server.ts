import { RosterSheetMutationError, getRosterSheet, listRosterSheets } from "./roster-sheets.server";
import type { RosterSheet } from "./types";

function compactLiveRosterSheetOrder(db: D1Database, eventId: string, now: string) {
  return db
    .prepare(
      `WITH ranked AS MATERIALIZED (
         SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, id) - 1 AS new_order
         FROM roster_sheets
         WHERE event_id = ? AND deleted_at IS NULL
       )
       UPDATE roster_sheets
       SET sort_order = (SELECT new_order FROM ranked WHERE ranked.id = roster_sheets.id),
           updated_at = ?
       WHERE event_id = ? AND deleted_at IS NULL`,
    )
    .bind(eventId, now, eventId);
}

/** Reorders every live sheet for an event, keeping its legacy/default sheet first. */
export async function reorderRosterSheets(
  db: D1Database,
  eventId: string,
  sheetIds: string[],
): Promise<RosterSheet[]> {
  if (new Set(sheetIds).size !== sheetIds.length) {
    throw new RosterSheetMutationError("Roster sheet order contains duplicate IDs.");
  }

  const current = await listRosterSheets(db, eventId);
  const currentIds = current.map((sheet) => sheet.id);
  if (sheetIds.length !== currentIds.length || currentIds.some((id) => !sheetIds.includes(id))) {
    throw new RosterSheetMutationError(
      "Roster sheet order must include every live sheet for this event exactly once.",
    );
  }
  if (sheetIds[0] !== `default:${eventId}`) {
    throw new RosterSheetMutationError("The default roster sheet must remain first.");
  }

  const now = new Date().toISOString();
  await db.batch([
    ...sheetIds.map((sheetId, sortOrder) =>
      db
        .prepare(
          `UPDATE roster_sheets SET sort_order = ?, updated_at = ?
           WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
        )
        .bind(sortOrder, now, sheetId, eventId),
    ),
    compactLiveRosterSheetOrder(db, eventId, now),
  ]);
  return listRosterSheets(db, eventId);
}

/** Soft-deletes a non-default sheet without changing its child or history rows. */
export async function archiveRosterSheet(
  db: D1Database,
  eventId: string,
  sheetId: string,
): Promise<void> {
  if (!(await getRosterSheet(db, eventId, sheetId))) {
    throw new RosterSheetMutationError("Roster sheet not found for this event.");
  }
  if (sheetId === `default:${eventId}`) {
    throw new RosterSheetMutationError("The default roster sheet cannot be archived.");
  }

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE roster_sheets SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
      )
      .bind(now, now, sheetId, eventId),
    compactLiveRosterSheetOrder(db, eventId, now),
  ]);
}
