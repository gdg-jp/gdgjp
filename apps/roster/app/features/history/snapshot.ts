import {
  type AssignmentValue,
  type Assignments,
  assignmentKey,
  parseAssignmentKey,
} from "~/features/solver/types";
import type { SnapshotItem, SnapshotV1 } from "./types";

export const SNAPSHOT_VERSION = 1;

export function toSnapshot(assignments: Assignments): SnapshotV1 {
  const items: SnapshotItem[] = [];
  for (const [key, value] of assignments) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    items.push({
      a: applicationId,
      s: slotId,
      t: value.trackId,
      r: value.roleId,
      l: value.locked ? 1 : 0,
    });
  }
  return { v: SNAPSHOT_VERSION, items };
}

export function fromSnapshot(value: unknown): Assignments {
  if (!isSnapshotV1(value)) {
    const v = isRecord(value) ? value.v : undefined;
    throw new Error(`Unsupported snapshot version: ${JSON.stringify(v)}`);
  }
  const map: Assignments = new Map();
  for (const item of value.items) {
    const assignmentValue: AssignmentValue = {
      trackId: item.t,
      roleId: item.r,
      locked: item.l === 1,
    };
    map.set(assignmentKey(item.a, item.s), assignmentValue);
  }
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSnapshotItem(value: unknown): value is SnapshotItem {
  return (
    isRecord(value) &&
    typeof value.a === "string" &&
    typeof value.s === "string" &&
    typeof value.t === "string" &&
    typeof value.r === "string" &&
    (value.l === 0 || value.l === 1)
  );
}

function isSnapshotV1(value: unknown): value is SnapshotV1 {
  return (
    isRecord(value) &&
    value.v === SNAPSHOT_VERSION &&
    Array.isArray(value.items) &&
    value.items.every(isSnapshotItem)
  );
}

export function serializeSnapshot(assignments: Assignments): string {
  return JSON.stringify(toSnapshot(assignments));
}

export function parseSnapshot(json: string): Assignments {
  return fromSnapshot(JSON.parse(json));
}
