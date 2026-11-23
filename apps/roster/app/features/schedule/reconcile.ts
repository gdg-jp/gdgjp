export type ExistingSlotKey = { id: string; start: string; end: string };
export type NextSlotKey = { start: string; end: string };

export type ReconcileResult = {
  keep: ExistingSlotKey[];
  remove: string[];
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
