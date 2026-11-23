import type { RevisionKind } from "./types";

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type RevisionHead = {
  kind: RevisionKind;
  groupKey: string | null;
  createdAt: string;
};

export type GroupingCandidate = {
  kind: RevisionKind;
  groupKey: string | null;
};

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
