import { newEventId } from "~/lib/id";
import type { EventRow, PayEvent } from "./types";

export function parseOwnerChapterIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => Number.isSafeInteger(value));
  } catch {
    return [];
  }
}

export function mapEvent(row: EventRow): PayEvent {
  return {
    id: row.id,
    title: row.title,
    ownerUserId: row.owner_user_id,
    ownerChapterIds: parseOwnerChapterIds(row.owner_chapter_ids),
    status: row.status,
    createdAt: row.created_at,
    googleAdminUserId: row.google_admin_user_id,
    googleDriveFolderId: row.google_drive_folder_id,
    googleDriveFolderName: row.google_drive_folder_name,
  };
}

export async function listEvents(db: D1Database): Promise<PayEvent[]> {
  const { results } = await db
    .prepare("SELECT * FROM events ORDER BY created_at DESC")
    .all<EventRow>();
  return (results ?? []).map(mapEvent);
}

export async function getEvent(db: D1Database, eventId: string): Promise<PayEvent | null> {
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  return row ? mapEvent(row) : null;
}

export async function createEvent(
  db: D1Database,
  input: { title: string; ownerUserId: string; ownerChapterIds: number[] },
): Promise<PayEvent> {
  const id = newEventId();
  await db
    .prepare(
      `INSERT INTO events (id, title, owner_user_id, owner_chapter_ids, status, created_at)
       VALUES (?, ?, ?, ?, 'open', unixepoch())`,
    )
    .bind(id, input.title, input.ownerUserId, JSON.stringify(input.ownerChapterIds))
    .run();
  const event = await getEvent(db, id);
  if (!event) throw new Error("failed to create event");
  return event;
}

export async function setEventGoogleAdmin(
  db: D1Database,
  eventId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare("UPDATE events SET google_admin_user_id = ? WHERE id = ?")
    .bind(userId, eventId)
    .run();
}

export async function setEventGoogleFolder(
  db: D1Database,
  eventId: string,
  folder: { id: string; name: string },
): Promise<void> {
  await db
    .prepare(
      "UPDATE events SET google_drive_folder_id = ?, google_drive_folder_name = ? WHERE id = ?",
    )
    .bind(folder.id, folder.name, eventId)
    .run();
}
