import { getDefaultRosterSheet, getRosterSheet } from "../roster-sheets/roster-sheets.server";

/**
 * D1 access for `tracks` (docs/roster/index.md §3 "トラック", §4). Split out
 * of `schedule.server.ts` to keep each file under the 400-line cap
 * (docs/roster/02-domain-schema.md "Design" §4: split by domain, not by
 * read/write) — tracks have no idx-contiguity concern, so they don't share
 * schedule.server.ts's regenerate machinery. Roles live in `roles.server.ts`.
 */

export type Track = {
  id: string;
  eventId: string;
  name: string;
  color: string;
  shared: boolean;
  sortOrder: number;
};

type TrackRow = {
  id: string;
  event_id: string;
  name: string;
  color: string;
  shared: number;
  sort_order: number;
};

const TRACK_COLS = "id, event_id, name, color, shared, sort_order";

/** Resolves the sheet a sheet-scoped track/role call targets; shared with `roles.server.ts`. */
export async function resolveRosterSheetId(
  db: D1Database,
  eventId: string,
  rosterSheetId: string | undefined,
  required: boolean,
): Promise<string | null> {
  const sheet =
    rosterSheetId !== undefined
      ? await getRosterSheet(db, eventId, rosterSheetId)
      : await getDefaultRosterSheet(db, eventId);
  if (sheet) return sheet.id;
  if (rosterSheetId !== undefined) {
    throw new Error("Roster sheet does not belong to this event or is not live");
  }
  if (required) throw new Error("Event has no live roster sheet");
  return null;
}

export function toTrack(r: TrackRow): Track {
  return {
    id: r.id,
    eventId: r.event_id,
    name: r.name,
    color: r.color,
    shared: r.shared === 1,
    sortOrder: r.sort_order,
  };
}

export async function listTracks(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<Track[]> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, false);
  if (!sheetId) return [];
  const { results } = await db
    .prepare(
      `SELECT ${TRACK_COLS} FROM tracks
       WHERE event_id = ? AND roster_sheet_id = ? ORDER BY sort_order`,
    )
    .bind(eventId, sheetId)
    .all<TrackRow>();
  return (results ?? []).map(toTrack);
}

export type CreateTrackInput = { name: string; color: string; shared: boolean };

export async function createTrack(
  db: D1Database,
  eventId: string,
  input: CreateTrackInput,
  rosterSheetId?: string,
): Promise<Track> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");

  const row = await db
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
       SELECT ?, ?, ?, ?, ?,
         COALESCE(MAX(sort_order), -1) + 1, ?
       FROM tracks
       WHERE event_id = ? AND roster_sheet_id = ?
       RETURNING ${TRACK_COLS}`,
    )
    .bind(
      crypto.randomUUID(),
      eventId,
      input.name,
      input.color,
      input.shared ? 1 : 0,
      sheetId,
      eventId,
      sheetId,
    )
    .first<TrackRow>();
  if (!row) throw new Error("Track insert returned no row");
  return toTrack(row);
}

export async function deleteTrack(
  db: D1Database,
  id: string,
  eventId: string,
  rosterSheetId?: string,
): Promise<void> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  await db
    .prepare("DELETE FROM tracks WHERE id = ? AND event_id = ? AND roster_sheet_id = ?")
    .bind(id, eventId, sheetId)
    .run();
}

/**
 * No UNIQUE(event_id, sort_order) constraint on tracks (unlike
 * time_slots.idx), so a plain per-row UPDATE batch is safe — there's no
 * transient-collision risk to guard against.
 */
export async function reorderTracks(
  db: D1Database,
  eventId: string,
  orderedIds: readonly string[],
  rosterSheetId?: string,
): Promise<void> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("Track order contains duplicate IDs");
  }
  const { results } = await db
    .prepare("SELECT id FROM tracks WHERE event_id = ? AND roster_sheet_id = ?")
    .bind(eventId, sheetId)
    .all<{ id: string }>();
  const selectedIds = new Set((results ?? []).map((row) => row.id));
  if (orderedIds.length !== selectedIds.size || orderedIds.some((id) => !selectedIds.has(id))) {
    throw new Error("Track order must contain every track from the selected roster sheet");
  }
  if (orderedIds.length === 0) return;
  const statements = orderedIds.map((id, i) =>
    db
      .prepare(
        "UPDATE tracks SET sort_order = ? WHERE id = ? AND event_id = ? AND roster_sheet_id = ?",
      )
      .bind(i, id, eventId, sheetId),
  );
  await db.batch(statements);
}
