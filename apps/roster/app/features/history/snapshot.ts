import {
  type AssignmentValue,
  type Assignments,
  assignmentKey,
  parseAssignmentKey,
} from "~/features/solver/types";
import type { SnapshotItem, SnapshotV1 } from "./types";

/**
 * `Assignments` <-> `revisions.snapshot` JSON, versioned (docs/roster/index.md
 * §4 "revisions", docs/roster/08-history.md "Design" §1, ADR-006). This is
 * the ONLY place that knows the snapshot's on-disk shape — `history.server.ts`
 * always goes through `serializeSnapshot`/`parseSnapshot`, never touches
 * `JSON.stringify`/`JSON.parse` on a snapshot directly.
 *
 * The `v` field is not decorative: `assignments`' columns are the thing this
 * JSON is a point-in-time copy OF (ADR-006 Consequences — "assignments の列を
 * 変えたら JSON の読み出し側の互換性を考える必要がある"), so a stored snapshot can
 * outlive the column shape it was written against. `parseSnapshot` throws on
 * an unrecognized `v` rather than guessing a mapping — a silently-misread
 * snapshot would restore a corrupted `assignments` table with no error
 * anywhere near the mistake (docs/roster/08-history.md "回帰として固定すべき
 * テスト": "v が未知の値のスナップショットで例外を投げる").
 */

export const SNAPSHOT_VERSION = 1;

/** Builds the `{ v: 1, items: [...] }` object from a live `Assignments` map.
 * Iteration order follows the Map's own (insertion) order — callers that
 * need a canonical byte-for-byte comparison should sort beforehand; nothing
 * in this stage requires that (a snapshot is read back into a `Map` keyed by
 * (applicationId, slotId), which is order-independent). */
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

/** The inverse of `toSnapshot` — narrows `unknown` explicitly rather than
 * trusting a type assertion, since the input always comes from a D1 TEXT
 * column (`JSON.parse`'s return type is `any`, which would otherwise let a
 * malformed row's `items` silently reach `parseAssignmentKey`/`assignmentKey`
 * with the wrong shape). */
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

/** `revisions.snapshot`'s exact TEXT contents — what `history.server.ts`
 * writes on every insert/merge-update. */
export function serializeSnapshot(assignments: Assignments): string {
  return JSON.stringify(toSnapshot(assignments));
}

/** The inverse of `serializeSnapshot`. Throws (via `fromSnapshot`) on an
 * unrecognized `v`, and lets a malformed-JSON `JSON.parse` error propagate
 * unchanged — both are "this snapshot cannot be trusted", not something to
 * paper over with a fallback empty map. */
export function parseSnapshot(json: string): Assignments {
  return fromSnapshot(JSON.parse(json));
}
