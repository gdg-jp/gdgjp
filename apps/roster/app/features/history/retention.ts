export const RETENTION_LIMIT = 50;

export function selectEvictions(
  existingSeqs: readonly number[],
  cursorSeq: number | null,
  limit: number = RETENTION_LIMIT,
): number[] {
  const overflow = existingSeqs.length - limit;
  if (overflow <= 0) return [];

  const evictable = [...existingSeqs].filter((seq) => seq !== cursorSeq).sort((a, b) => a - b);
  return evictable.slice(0, overflow);
}
