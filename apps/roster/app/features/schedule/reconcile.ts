/**
 * Pure key-diff for regenerating an event's time slots without losing rows
 * that Stage 03 (`demands`) and Stage 04 (`availabilities`) will hang off
 * `time_slot_id` (docs/roster/02-domain-schema.md "Design" §3). Mirrors
 * `scheduler/app/lib/db.ts`'s `reconcileSlotKeys`, keyed on `(start, end)`
 * instead of `(dayOfWeek, startTime)` since roster events are single-day.
 *
 * Kept purely as a diff: it does not decide *how* to write the result back
 * (see `schedule.server.ts`'s two-phase idx update for why a naive
 * row-by-row UPDATE isn't safe under the `UNIQUE(event_id, idx)` constraint).
 */

export type ExistingSlotKey = { id: string; start: string; end: string };
export type NextSlotKey = { start: string; end: string };

export type ReconcileResult = {
  /** Existing rows whose (start, end) key still exists in `next` — keep their `id`. */
  keep: ExistingSlotKey[];
  /** Existing row ids whose key no longer exists in `next` — safe to delete. */
  remove: string[];
  /** Keys in `next` with no matching existing row — need a freshly generated id. */
  insert: NextSlotKey[];
};

const key = (s: { start: string; end: string }): string => `${s.start}-${s.end}`;

export function reconcileSlotKeys(
  existing: readonly ExistingSlotKey[],
  next: readonly NextSlotKey[],
): ReconcileResult {
  const nextKeys = new Set(next.map(key));
  const existingKeys = new Set(existing.map(key));

  return {
    keep: existing.filter((s) => nextKeys.has(key(s))),
    remove: existing.filter((s) => !nextKeys.has(key(s))).map((s) => s.id),
    insert: next.filter((s) => !existingKeys.has(key(s))),
  };
}
