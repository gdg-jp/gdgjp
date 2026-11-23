import type { Metrics } from "~/features/solver/types";

export type RevisionKind = "generate" | "edit" | "restore";

export type Actor = { id: string; name: string };

export type SnapshotItem = {
  a: string;
  s: string;
  t: string;
  r: string;
  l: 0 | 1;
};

export type SnapshotV1 = { v: 1; items: SnapshotItem[] };

export type RevisionSummary = {
  seq: number;
  label: string;
  actor: string;
  actorId: string | null;
  kind: RevisionKind;
  groupKey: string | null;
  metrics: Metrics;
  createdAt: string;
};

export type HistoryState = {
  cursor: number | null;
  revisions: RevisionSummary[];
};

export type RestoreResult = { droppedCount: number };
