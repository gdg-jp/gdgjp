// Pure reconciliation helper exported for unit tests.
export function reconcileSlotKeys(
  existing: { dayOfWeek: number; startTime: string }[],
  next: { dayOfWeek: number; startTime: string }[],
): { keep: string[]; insert: string[]; remove: string[] } {
  const key = (s: { dayOfWeek: number; startTime: string }) => `${s.dayOfWeek}-${s.startTime}`;
  const existingKeys = new Set(existing.map(key));
  const nextKeys = new Set(next.map(key));
  return {
    keep: [...existingKeys].filter((k) => nextKeys.has(k)),
    insert: [...nextKeys].filter((k) => !existingKeys.has(k)),
    remove: [...existingKeys].filter((k) => !nextKeys.has(k)),
  };
}
