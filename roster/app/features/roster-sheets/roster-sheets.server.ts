import { isValidTime, toMin } from "../schedule/slots";
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

const SHEET_COLS = `id, event_id, name, date, start_time, end_time, step_min,
  no_solo_newcomer, max_consecutive, seed, visibility, sort_order,
  revision_cursor, created_at, updated_at, deleted_at`;

export class RosterSheetMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterSheetMutationError";
  }
}

export type CreateRosterSheetInput = {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  stepMin: number;
  noSoloNewcomer?: boolean;
  maxConsecutive?: number;
  seed: number;
};

export type UpdateRosterSheetInput = Partial<
  Pick<
    RosterSheet,
    | "name"
    | "date"
    | "startTime"
    | "endTime"
    | "stepMin"
    | "noSoloNewcomer"
    | "maxConsecutive"
    | "seed"
  >
>;

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) {
    throw new RosterSheetMutationError("Sheet title must be between 1 and 100 characters.");
  }
  return trimmed;
}

function validateDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RosterSheetMutationError("Sheet date must be a valid YYYY-MM-DD date.");
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw new RosterSheetMutationError("Sheet date must be a valid YYYY-MM-DD date.");
  }
}

function validateSchedule(input: {
  date: string;
  startTime: string;
  endTime: string;
  stepMin: number;
}): void {
  validateDate(input.date);
  if (
    !isValidTime(input.startTime) ||
    !isValidTime(input.endTime) ||
    input.startTime >= input.endTime
  ) {
    throw new RosterSheetMutationError("Start time must be before end time in HH:MM format.");
  }
  if (![15, 30, 60].includes(input.stepMin)) {
    throw new RosterSheetMutationError("Step must be 15, 30, or 60 minutes.");
  }
  if (toMin(input.endTime) - toMin(input.startTime) < input.stepMin) {
    throw new RosterSheetMutationError("Schedule duration must be at least one step.");
  }
}

function validateSettings(input: { maxConsecutive: number; seed: number }): void {
  if (!Number.isInteger(input.maxConsecutive) || input.maxConsecutive < 1) {
    throw new RosterSheetMutationError("Maximum consecutive shifts must be a positive integer.");
  }
  if (!Number.isInteger(input.seed)) {
    throw new RosterSheetMutationError("Seed must be an integer.");
  }
}

async function requireLiveSheet(
  db: D1Database,
  eventId: string,
  sheetId: string,
): Promise<RosterSheet> {
  const sheet = await getRosterSheet(db, eventId, sheetId);
  if (!sheet) throw new RosterSheetMutationError("Roster sheet not found for this event.");
  return sheet;
}

/** Creates an event-scoped, non-default sheet appended after the live sheets. */
export async function createRosterSheet(
  db: D1Database,
  eventId: string,
  input: CreateRosterSheetInput,
): Promise<RosterSheet> {
  const name = validateName(input.name);
  validateSchedule(input);
  const maxConsecutive = input.maxConsecutive ?? 4;
  validateSettings({ maxConsecutive, seed: input.seed });

  const event = await db
    .prepare(
      `SELECT e.id FROM events e
       JOIN roster_sheets s ON s.event_id = e.id AND s.id = 'default:' || e.id
       WHERE e.id = ? AND e.deleted_at IS NULL AND s.deleted_at IS NULL`,
    )
    .bind(eventId)
    .first<{ id: string }>();
  if (!event) throw new RosterSheetMutationError("Event not found.");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min, no_solo_newcomer,
         max_consecutive, seed, visibility, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private',
         (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM roster_sheets
          WHERE event_id = ? AND deleted_at IS NULL), ?, ?)
       RETURNING ${SHEET_COLS}`,
    )
    .bind(
      id,
      eventId,
      name,
      input.date,
      input.startTime,
      input.endTime,
      input.stepMin,
      input.noSoloNewcomer ? 1 : 0,
      maxConsecutive,
      input.seed,
      eventId,
      now,
      now,
    )
    .first<SheetRow>();
  if (!row) throw new Error("Roster sheet insert returned no row");
  return toSheet(row);
}

/** Updates only editable sheet metadata/settings; visibility and order have dedicated APIs. */
export async function updateRosterSheet(
  db: D1Database,
  eventId: string,
  sheetId: string,
  input: UpdateRosterSheetInput,
): Promise<RosterSheet> {
  const current = await requireLiveSheet(db, eventId, sheetId);
  const next = {
    name: input.name === undefined ? current.name : validateName(input.name),
    date: input.date ?? current.date,
    startTime: input.startTime ?? current.startTime,
    endTime: input.endTime ?? current.endTime,
    stepMin: input.stepMin ?? current.stepMin,
    noSoloNewcomer: input.noSoloNewcomer ?? current.noSoloNewcomer,
    maxConsecutive: input.maxConsecutive ?? current.maxConsecutive,
    seed: input.seed ?? current.seed,
  };
  validateSchedule(next);
  validateSettings(next);

  const row = await db
    .prepare(
      `UPDATE roster_sheets SET name = ?, date = ?, start_time = ?, end_time = ?, step_min = ?,
        no_solo_newcomer = ?, max_consecutive = ?, seed = ?, updated_at = ?
       WHERE id = ? AND event_id = ? AND deleted_at IS NULL
       RETURNING ${SHEET_COLS}`,
    )
    .bind(
      next.name,
      next.date,
      next.startTime,
      next.endTime,
      next.stepMin,
      next.noSoloNewcomer ? 1 : 0,
      next.maxConsecutive,
      next.seed,
      new Date().toISOString(),
      sheetId,
      eventId,
    )
    .first<SheetRow>();
  if (!row) throw new RosterSheetMutationError("Roster sheet not found for this event.");
  return toSheet(row);
}

/** Switches a live sheet between private draft and published visibility. */
export async function setRosterSheetVisibility(
  db: D1Database,
  eventId: string,
  sheetId: string,
  visibility: SheetVisibility,
): Promise<RosterSheet> {
  if (visibility !== "private" && visibility !== "published") {
    throw new RosterSheetMutationError("Visibility must be private or published.");
  }
  await requireLiveSheet(db, eventId, sheetId);
  const now = new Date().toISOString();
  if (sheetId === `default:${eventId}`) {
    const event = await db
      .prepare(
        `UPDATE events
         SET status = CASE
               WHEN ? = 'published' THEN 'published'
               WHEN status = 'published' THEN 'draft'
               ELSE status
             END,
             updated_at = ?
         WHERE id = ? AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM roster_sheets
             WHERE id = ? AND event_id = events.id AND deleted_at IS NULL
           )
         RETURNING id`,
      )
      .bind(visibility, now, eventId, sheetId)
      .first<{ id: string }>();
    if (!event) throw new RosterSheetMutationError("Roster sheet not found for this event.");
    return requireLiveSheet(db, eventId, sheetId);
  }

  const row = await db
    .prepare(
      `UPDATE roster_sheets SET visibility = ?, updated_at = ?
       WHERE id = ? AND event_id = ? AND deleted_at IS NULL
       RETURNING ${SHEET_COLS}`,
    )
    .bind(visibility, now, sheetId, eventId)
    .first<SheetRow>();
  if (!row) throw new RosterSheetMutationError("Roster sheet not found for this event.");
  return toSheet(row);
}

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
