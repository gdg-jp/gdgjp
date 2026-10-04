import type { Slot } from "./model";
import { reconcileSlotKeys } from "./reconcile";
export type SlotRow = { id: number; event_id: string; day_of_week: number; start_time: string };
export const SLOT_COLS = "id, event_id, day_of_week, start_time";
export function toSlot(r: SlotRow): Slot {
  return { id: r.id, eventId: r.event_id, dayOfWeek: r.day_of_week, startTime: r.start_time };
}

export async function createSlots(
  db: D1Database,
  id: string,
  slots: { dayOfWeek: number; startTime: string }[],
): Promise<Slot[]> {
  const slotStmt = db.prepare(
    `INSERT INTO event_slots (event_id, day_of_week, start_time) VALUES (?, ?, ?) RETURNING ${SLOT_COLS}`,
  );
  const slotRows: SlotRow[] = [];
  for (const s of slots) {
    const row = await slotStmt.bind(id, s.dayOfWeek, s.startTime).first<SlotRow>();
    if (row) slotRows.push(row);
  }
  return slotRows.map(toSlot);
}

export async function replaceSlots(
  db: D1Database,
  id: string,
  slots: { dayOfWeek: number; startTime: string }[],
): Promise<Slot[]> {
  const existingSlots = (
    await db
      .prepare(`SELECT ${SLOT_COLS} FROM event_slots WHERE event_id = ?`)
      .bind(id)
      .all<SlotRow>()
  ).results.map(toSlot);

  const diff = reconcileSlotKeys(existingSlots, slots);
  const removed = new Set(diff.remove);
  const inserted = new Set(diff.insert);
  const toDelete = existingSlots
    .filter((s) => removed.has(`${s.dayOfWeek}-${s.startTime}`))
    .map((s) => s.id);
  const toInsert = slots.filter((s) => inserted.has(`${s.dayOfWeek}-${s.startTime}`));

  if (toDelete.length > 0) {
    const placeholders = toDelete.map(() => "?").join(", ");
    await db
      .prepare(`DELETE FROM event_slots WHERE id IN (${placeholders})`)
      .bind(...toDelete)
      .run();
  }
  if (toInsert.length > 0) {
    const insertStmt = db.prepare(
      "INSERT INTO event_slots (event_id, day_of_week, start_time) VALUES (?, ?, ?)",
    );
    await db.batch(toInsert.map((s) => insertStmt.bind(id, s.dayOfWeek, s.startTime)));
  }

  const refreshed = (
    await db
      .prepare(
        `SELECT ${SLOT_COLS} FROM event_slots WHERE event_id = ? ORDER BY day_of_week, start_time`,
      )
      .bind(id)
      .all<SlotRow>()
  ).results.map(toSlot);

  return refreshed;
}
