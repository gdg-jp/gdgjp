import type { HistoryState } from "./types";

export function canUndo(state: HistoryState): boolean {
  const { cursor } = state;
  return cursor !== null && state.revisions.some((r) => r.seq < cursor);
}

export function canRedo(state: HistoryState): boolean {
  const { cursor } = state;
  return cursor !== null && state.revisions.some((r) => r.seq > cursor);
}
