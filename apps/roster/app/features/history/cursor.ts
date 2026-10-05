import type { HistoryState } from "./types";

/**
 * Whether the undo/redo buttons should be enabled (docs/roster/08-history.md
 * "Design" §6: "カーソルが端にあるときは disabled"). Pure — reads only the
 * `HistoryState` the loader's `getHistoryState` already produced, so
 * `e.$id.roster.tsx` never re-derives the boundary itself.
 */
export function canUndo(state: HistoryState): boolean {
  const { cursor } = state;
  return cursor !== null && state.revisions.some((r) => r.seq < cursor);
}

/** The redo counterpart of `canUndo`. */
export function canRedo(state: HistoryState): boolean {
  const { cursor } = state;
  return cursor !== null && state.revisions.some((r) => r.seq > cursor);
}
