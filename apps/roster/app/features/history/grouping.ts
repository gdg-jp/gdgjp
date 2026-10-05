import type { RevisionKind } from "./types";

/**
 * Whether a new write should collapse into the current head revision instead
 * of inserting a new row (docs/roster/index.md §5.7 context, docs/roster/
 * 08-history.md "Design" §3, ADR-006 "連続した手動編集は一定時間まとめて1件の
 * 履歴にする"). Pure — `history.server.ts#recordRevision` is the only caller,
 * and supplies the current time and the head row's fields so this stays
 * testable without D1.
 *
 * This is the single most consequence-heavy rule in this stage
 * (docs/roster/08-history.md "回帰として固定すべきテスト": ungrouped edits burn
 * through the 50-entry retention cap in minutes and push out the generation
 * that produced the current state) — every branch here needs a test, not
 * just the "happy path" 5-minute window.
 */

/** The merge window (docs/roster/08-history.md Design §3: "時間窓は5分とし、
 * 定数として1箇所に置く"). Exported so grouping.test.ts can assert the exact
 * boundary rather than hard-coding "300000" a second time. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type RevisionHead = {
  kind: RevisionKind;
  /** `revisions.group_key` — NULL means "this head can never be merged into"
   * (e.g. a `restore`, which never writes a group_key). */
  groupKey: string | null;
  /** `revisions.created_at`, ISO 8601 — compared against `now` below. */
  createdAt: string;
};

export type GroupingCandidate = {
  kind: RevisionKind;
  groupKey: string | null;
};

/**
 * Decides "update the head row in place" (true) vs. "insert a new row"
 * (false). All of these must hold, per the stage doc's condition list:
 *
 * - the candidate is a manual `edit` (a `generate` NEVER merges, regardless
 *   of timing or actor — docs/roster/08-history.md "回帰として固定すべき
 *   テスト": "generate は常に新規履歴になる")
 * - the current head is also an `edit` (never merge into a `generate` or a
 *   `restore` row — a restore doesn't even reach here since it never writes
 *   a revision, but a defensive check costs nothing)
 * - both `groupKey`s are non-null and identical — this is what makes a
 *   different actor's edit start its own entry instead of silently
 *   absorbing into someone else's in-progress one
 * - `now` is within `GROUP_WINDOW_MS` of the head's `createdAt` — exactly at
 *   the boundary still merges (`<=`, not `<`); a hair past it does not
 */
export function shouldMergeIntoHead(
  head: RevisionHead | null,
  candidate: GroupingCandidate,
  now: Date,
): boolean {
  if (!head) return false;
  if (candidate.kind !== "edit" || head.kind !== "edit") return false;
  if (candidate.groupKey === null || head.groupKey === null) return false;
  if (candidate.groupKey !== head.groupKey) return false;

  const elapsedMs = now.getTime() - new Date(head.createdAt).getTime();
  return elapsedMs <= GROUP_WINDOW_MS;
}
