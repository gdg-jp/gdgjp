/**
 * The 50-entry retention cap (docs/roster/index.md §4 context, docs/roster/
 * 08-history.md "Design" §4, ADR-006 "保持件数に上限を設け、古いものから削除する").
 * Pure — `history.server.ts#recordRevision` calls this after computing the
 * new revision's `seq` and BEFORE running its `db.batch`, so eviction lands
 * in the same atomic batch as the insert (docs/roster/08-history.md "削除は
 * 追加と同じ db.batch に入れて原子的に行う").
 */

/** docs/roster/08-history.md Design §4: "上限は50件。定数として1箇所に置く". */
export const RETENTION_LIMIT = 50;

/**
 * Given every `seq` currently present for an event (any order, including the
 * one about to be/just inserted) and where the cursor now points, returns
 * the `seq`s to delete so the count settles back to `limit` — oldest
 * (smallest `seq`) first, **never** including `cursorSeq`.
 *
 * The cursor exclusion is the hard constraint (docs/roster/08-history.md
 * "回帰として固定すべきテスト": "カーソルが指す行は消えない"): in the normal flow
 * the cursor always equals the newly-inserted revision's `seq`, i.e. the
 * maximum, so it would never be picked as "oldest" anyway — but the
 * exclusion is applied unconditionally rather than relying on that
 * invariant, so a future caller that (mis)uses this with a cursor NOT at the
 * max still can't evict the row the app currently displays as "current".
 * If protecting the cursor's row means fewer than `overflow` entries can be
 * evicted, this returns fewer than `overflow` — staying one over cap is the
 * lesser failure vs. corrupting "what the shift table currently shows".
 */
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
