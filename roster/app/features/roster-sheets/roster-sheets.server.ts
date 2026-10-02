import type { RosterSheet, SheetVisibility } from "./types";

type SheetRow = {
  id: string;
  event_id: string;
  name: string;
  date: string;
  start_time: string;
  end_time: string;
  step_min: number;
  no_solo_newcomer: number;
  max_consecutive: number;
  seed: number;
  visibility: SheetVisibility;
  sort_order: number;
  revision_cursor: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function toSheet(row: SheetRow): RosterSheet {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    stepMin: row.step_min,
    noSoloNewcomer: row.no_solo_newcomer === 1,
    maxConsecutive: row.max_consecutive,
    seed: row.seed,
    visibility: row.visibility,
    sortOrder: row.sort_order,
    revisionCursor: row.revision_cursor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const LIVE_SHEETS = `SELECT s.* FROM roster_sheets s
  JOIN events e ON e.id = s.event_id
  WHERE s.event_id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`;

/** Callers must authorize event access before using these internal accessors. */
export async function listRosterSheets(db: D1Database, eventId: string): Promise<RosterSheet[]> {
  const { results } = await db
    .prepare(`${LIVE_SHEETS} ORDER BY s.sort_order, s.id`)
    .bind(eventId)
    .all<SheetRow>();
  return (results ?? []).map(toSheet);
}

/** Event scoping prevents a sheet ID from resolving under an unrelated event. */
export async function getRosterSheet(
  db: D1Database,
  eventId: string,
  sheetId: string,
): Promise<RosterSheet | null> {
  const row = await db
    .prepare(`${LIVE_SHEETS} AND s.id = ?`)
    .bind(eventId, sheetId)
    .first<SheetRow>();
  return row ? toSheet(row) : null;
}

/** The first live sheet is the destination of legacy event-only routes. */
export async function getDefaultRosterSheet(
  db: D1Database,
  eventId: string,
): Promise<RosterSheet | null> {
  const row = await db
    .prepare(`${LIVE_SHEETS} ORDER BY s.sort_order, s.id LIMIT 1`)
    .bind(eventId)
    .first<SheetRow>();
  return row ? toSheet(row) : null;
}
