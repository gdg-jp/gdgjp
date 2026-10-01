import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type Assignments, type Metrics, assignmentKey } from "~/features/solver/types";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  getHistoryState,
  recordRevision,
  redoRevision,
  restoreRevision,
  tryRestoreRevision,
  undoRevision,
} from "./history.server";
import type { Actor } from "./types";

const MIGRATIONS = [
  fileURLToPath(new URL("../../../migrations/0002_domain.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0003_demands.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0004_applications.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0005_assignments.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0006_revisions.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0007_roster_sheets_expand.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0008_default_sheet_compat.sql", import.meta.url)),
  fileURLToPath(
    new URL("../../../migrations/0009_time_slots_sheet_uniqueness.sql", import.meta.url),
  ),
  fileURLToPath(new URL("../../../migrations/0010_revisions_sheet_sequence.sql", import.meta.url)),
];

const EVENT_ID = "evt_1";
const OWNER: Actor = { id: "u1", name: "Owner" };

function metrics(distinguisher = 0): Metrics {
  return {
    demandMin: distinguisher,
    demandIdeal: 0,
    filled: 0,
    idealRate: 0,
    minShortage: 0,
    leadShortage: 0,
    assigned: 0,
    firstChoiceRate: 0,
    loadStdev: 0,
    loadMax: 0,
    loadMin: 0,
    softUsed: 0,
    overwork: 0,
    violationCount: 0,
  };
}

async function seedEvent(db: TestD1Database, id = EVENT_ID) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES (?, 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, ?, ?, ?, ?)`,
    )
    .bind(id, `apply_${id}`, `view_${id}`, now, now)
    .run();
}

async function seedApplication(db: TestD1Database, id: string, eventId = EVENT_ID) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, eventId, `user_${id}`, `${id}@example.com`, id, now, now)
    .run();
}

async function seedTrack(db: TestD1Database, id: string, eventId = EVENT_ID) {
  await db
    .prepare(
      "INSERT INTO tracks (id, event_id, name, color, shared, sort_order) VALUES (?, ?, '全体', '#000', 1, 0)",
    )
    .bind(id, eventId)
    .run();
}

async function seedSlot(db: TestD1Database, id: string, idx: number, eventId = EVENT_ID) {
  await db
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES (?, ?, ?, '09:00', '10:00')",
    )
    .bind(id, eventId, idx)
    .run();
}

async function getCursor(db: TestD1Database, eventId = EVENT_ID): Promise<number | null> {
  const row = await db
    .prepare("SELECT revision_cursor FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ revision_cursor: number | null }>();
  return row?.revision_cursor ?? null;
}

async function listRevisionRows(db: TestD1Database, eventId = EVENT_ID) {
  const { results } = await db
    .prepare(
      "SELECT id, seq, label, actor, actor_id, kind, group_key, created_at FROM revisions WHERE event_id = ? ORDER BY seq",
    )
    .bind(eventId)
    .all<{
      id: string;
      seq: number;
      label: string;
      actor: string;
      actor_id: string | null;
      kind: string;
      group_key: string | null;
      created_at: string;
    }>();
  return results ?? [];
}

async function readAssignmentRows(db: TestD1Database) {
  const { results } = await db
    .prepare(
      "SELECT application_id, time_slot_id, track_id, role_id FROM assignments ORDER BY application_id",
    )
    .all<{ application_id: string; time_slot_id: string; track_id: string; role_id: string }>();
  return results ?? [];
}

function record(
  db: TestD1Database,
  overrides: Partial<{
    assignments: Assignments;
    metricsValue: number;
    label: string;
    actor: Actor;
    kind: "generate" | "edit";
    groupKey: string | null;
  }> = {},
) {
  return recordRevision(asD1(db), {
    eventId: EVENT_ID,
    assignments: overrides.assignments ?? new Map(),
    metrics: metrics(overrides.metricsValue ?? 0),
    label: overrides.label ?? "自動生成",
    actor: overrides.actor ?? OWNER,
    kind: overrides.kind ?? "generate",
    groupKey: overrides.groupKey,
  });
}

describe("recordRevision", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
  });

  it("inserts the first revision and sets the cursor to it", async () => {
    await record(testDb, { label: "自動生成（シード 1）" });
    const rows = await listRevisionRows(testDb);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, label: "自動生成（シード 1）", kind: "generate" });
    expect(await getCursor(testDb)).toBe(1);
  });

  it("merges consecutive same-actor edits within the window into the same row", async () => {
    await record(testDb, { kind: "edit", groupKey: "u1", label: "手動編集" });
    const afterFirst = await listRevisionRows(testDb);

    await record(testDb, { kind: "edit", groupKey: "u1", label: "手動編集（続き）" });
    const afterSecond = await listRevisionRows(testDb);

    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id); // same row updated in place, not a new one
    expect(afterSecond[0].seq).toBe(1);
    expect(afterSecond[0].label).toBe("手動編集（続き）");
    expect(await getCursor(testDb)).toBe(1);
  });

  it("a generate right after an edit by the same actor still starts a new revision", async () => {
    await record(testDb, { kind: "edit", groupKey: "u1" });
    await record(testDb, { kind: "generate" });
    const rows = await listRevisionRows(testDb);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows.map((r) => r.kind)).toEqual(["edit", "generate"]);
  });

  it("does not merge an edit from a different actor, even immediately after", async () => {
    await record(testDb, { kind: "edit", groupKey: "u1", actor: { id: "u1", name: "A" } });
    await record(testDb, { kind: "edit", groupKey: "u2", actor: { id: "u2", name: "B" } });
    const rows = await listRevisionRows(testDb);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.actor_id)).toEqual(["u1", "u2"]);
  });

  it("does not merge an edit once the head is older than the 5-minute window", async () => {
    await record(testDb, { kind: "edit", groupKey: "u1", label: "first" });
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await testDb
      .prepare("UPDATE revisions SET created_at = ? WHERE event_id = ? AND seq = 1")
      .bind(sixMinutesAgo, EVENT_ID)
      .run();

    await record(testDb, { kind: "edit", groupKey: "u1", label: "second" });
    const rows = await listRevisionRows(testDb);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.label)).toEqual(["first", "second"]);
  });

  it("evicts the oldest revision once more than 50 accumulate, never the cursor's row", async () => {
    for (let i = 1; i <= 51; i++) {
      await record(testDb, { label: `gen ${i}` });
    }
    const rows = await listRevisionRows(testDb);
    expect(rows).toHaveLength(50);
    expect(rows[0].seq).toBe(2); // seq 1 was the oldest — evicted
    expect(rows[rows.length - 1].seq).toBe(51);
    expect(await getCursor(testDb)).toBe(51); // the cursor's row (51) always survives
  });

  it("truncates future revisions when a new edit is made after the cursor was rewound", async () => {
    await record(testDb, { label: "gen1" }); // seq 1
    await record(testDb, { label: "gen2" }); // seq 2
    await record(testDb, { label: "gen3" }); // seq 3

    // Simulate "undo twice" by rewinding the cursor directly.
    await testDb.prepare("UPDATE events SET revision_cursor = 1 WHERE id = ?").bind(EVENT_ID).run();

    await record(testDb, { kind: "edit", groupKey: "u1", label: "edit after rewind" });

    const rows = await listRevisionRows(testDb);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows.map((r) => r.label)).toEqual(["gen1", "edit after rewind"]);
    expect(await getCursor(testDb)).toBe(2);
  });

  /**
   * Regression: the merge-into-head branch used to `return` immediately
   * after its `UPDATE`, skipping the "discard the redo branch" truncation
   * that only ran on the insert path. So rewinding to a revision that
   * happens to be a mergeable `edit` head, then making a matching edit,
   * merged the new content into that head's row but left any revisions
   * PAST the (now-stale) redo branch alive and reachable via redo — exactly
   * the multi-branch history docs/roster/08-history.md "制約" forbids.
   */
  it("truncates future revisions even when the new edit merges into the rewound-to head", async () => {
    await record(testDb, { label: "gen1" }); // seq 1
    await record(testDb, { kind: "edit", groupKey: "u1", label: "edit2" }); // seq 2 (edit head)
    await record(testDb, { label: "gen3" }); // seq 3 (generate — always a new row)

    // Rewind the cursor to seq 2, an "edit" head that a same-actor,
    // same-window edit is eligible to merge into.
    await testDb.prepare("UPDATE events SET revision_cursor = 2 WHERE id = ?").bind(EVENT_ID).run();

    await record(testDb, { kind: "edit", groupKey: "u1", label: "edit2 (merged)" });

    const rows = await listRevisionRows(testDb);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]); // seq 3 must be gone, not just unreachable
    expect(rows.map((r) => r.label)).toEqual(["gen1", "edit2 (merged)"]); // merged in place, not a new row
    expect(await getCursor(testDb)).toBe(2);
  });
});

describe("restoreRevision", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
    await seedTrack(testDb, "trk_1");
    await seedSlot(testDb, "slot_1", 0);
  });

  it("restores the snapshot into assignments and moves the cursor, without creating a new revision", async () => {
    await seedApplication(testDb, "app_1");
    const snapshot: Assignments = new Map([
      [assignmentKey("app_1", "slot_1"), { trackId: "trk_1", roleId: "reception", locked: false }],
    ]);
    await record(testDb, { assignments: snapshot, label: "自動生成" });
    const rowsBefore = await listRevisionRows(testDb);

    const result = await restoreRevision(asD1(testDb), EVENT_ID, 1, OWNER);

    expect(result).toEqual({ droppedCount: 0 });
    expect(await getCursor(testDb)).toBe(1);
    expect(await listRevisionRows(testDb)).toHaveLength(rowsBefore.length); // no new row
    expect(await readAssignmentRows(testDb)).toEqual([
      { application_id: "app_1", time_slot_id: "slot_1", track_id: "trk_1", role_id: "reception" },
    ]);
  });

  it("replaces whatever is currently in assignments with the restored snapshot", async () => {
    await seedApplication(testDb, "app_1");
    await seedApplication(testDb, "app_2");
    const snapshot: Assignments = new Map([
      [assignmentKey("app_1", "slot_1"), { trackId: "trk_1", roleId: "reception", locked: false }],
    ]);
    await record(testDb, { assignments: snapshot, label: "自動生成" }); // seq 1
    // A later edit changes the live table to something else, WITHOUT going
    // through recordRevision (simulating drift is unnecessary — using the
    // real hook via a second record() call is simpler and equally valid).
    await record(testDb, {
      assignments: new Map([
        [assignmentKey("app_2", "slot_1"), { trackId: "trk_1", roleId: "guide", locked: false }],
      ]),
      kind: "edit",
      groupKey: "u1",
      label: "手動編集",
    }); // seq 2 (different groupKey window state, but kind differs from head so no merge)

    await restoreRevision(asD1(testDb), EVENT_ID, 1, OWNER);
    expect(await readAssignmentRows(testDb)).toEqual([
      { application_id: "app_1", time_slot_id: "slot_1", track_id: "trk_1", role_id: "reception" },
    ]);
  });

  it("filters a withdrawn applicant's assignment on restore and reports the dropped count", async () => {
    await seedApplication(testDb, "app_1");
    await seedApplication(testDb, "app_2");
    const snapshot: Assignments = new Map([
      [assignmentKey("app_1", "slot_1"), { trackId: "trk_1", roleId: "reception", locked: false }],
      [assignmentKey("app_2", "slot_1"), { trackId: "trk_1", roleId: "guide", locked: false }],
    ]);
    await record(testDb, { assignments: snapshot });
    await testDb.prepare("UPDATE applications SET withdrawn = 1 WHERE id = ?").bind("app_2").run();

    const result = await restoreRevision(asD1(testDb), EVENT_ID, 1, OWNER);

    expect(result).toEqual({ droppedCount: 1 });
    const rows = await readAssignmentRows(testDb);
    expect(rows.map((r) => r.application_id)).toEqual(["app_1"]);
  });

  it("filters an assignment whose time slot no longer exists (schedule regenerated) and reports the count", async () => {
    await seedApplication(testDb, "app_1");
    const snapshot: Assignments = new Map([
      [assignmentKey("app_1", "slot_1"), { trackId: "trk_1", roleId: "reception", locked: false }],
    ]);
    await record(testDb, { assignments: snapshot });
    await testDb.prepare("DELETE FROM time_slots WHERE id = ?").bind("slot_1").run();

    const result = await restoreRevision(asD1(testDb), EVENT_ID, 1, OWNER);

    expect(result).toEqual({ droppedCount: 1 });
    expect(await readAssignmentRows(testDb)).toEqual([]);
  });

  it("does not throw when both a withdrawn applicant and a missing slot appear in the same snapshot", async () => {
    await seedApplication(testDb, "app_1");
    await seedApplication(testDb, "app_2");
    await seedSlot(testDb, "slot_2", 1);
    const snapshot: Assignments = new Map([
      [assignmentKey("app_1", "slot_1"), { trackId: "trk_1", roleId: "reception", locked: false }],
      [assignmentKey("app_2", "slot_2"), { trackId: "trk_1", roleId: "guide", locked: false }],
    ]);
    await record(testDb, { assignments: snapshot });
    await testDb.prepare("UPDATE applications SET withdrawn = 1 WHERE id = ?").bind("app_1").run();
    await testDb.prepare("DELETE FROM time_slots WHERE id = ?").bind("slot_2").run();

    const result = await restoreRevision(asD1(testDb), EVENT_ID, 1, OWNER);

    expect(result).toEqual({ droppedCount: 2 });
    expect(await readAssignmentRows(testDb)).toEqual([]);
  });

  it("returns null (rather than throwing) for a seq that has no revision", async () => {
    expect(await restoreRevision(asD1(testDb), EVENT_ID, 999, OWNER)).toBeNull();
  });
});

describe("tryRestoreRevision", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
    await seedTrack(testDb, "trk_1");
    await seedSlot(testDb, "slot_1", 0);
    await seedApplication(testDb, "app_1");
  });

  it("returns found:true with the dropped count on a valid seq", async () => {
    const snapshot: Assignments = new Map([
      [assignmentKey("app_1", "slot_1"), { trackId: "trk_1", roleId: "reception", locked: false }],
    ]);
    await record(testDb, { assignments: snapshot });

    const outcome = await tryRestoreRevision(asD1(testDb), EVENT_ID, 1, OWNER);
    expect(outcome).toEqual({ found: true, droppedCount: 0 });
  });

  it("returns found:false instead of throwing for a seq that no longer exists", async () => {
    const outcome = await tryRestoreRevision(asD1(testDb), EVENT_ID, 999, OWNER);
    expect(outcome).toEqual({ found: false });
  });
});

describe("undoRevision / redoRevision", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
  });

  it("returns null when there is no history yet", async () => {
    expect(await undoRevision(asD1(testDb), EVENT_ID, OWNER)).toBeNull();
    expect(await redoRevision(asD1(testDb), EVENT_ID, OWNER)).toBeNull();
  });

  it("undo moves the cursor to the previous seq, and is disabled (null) at the oldest", async () => {
    await record(testDb, { label: "gen1" });
    await record(testDb, { label: "gen2" });

    const result = await undoRevision(asD1(testDb), EVENT_ID, OWNER);
    expect(result).not.toBeNull();
    expect(await getCursor(testDb)).toBe(1);

    const atStart = await undoRevision(asD1(testDb), EVENT_ID, OWNER);
    expect(atStart).toBeNull();
    expect(await getCursor(testDb)).toBe(1); // unchanged — no-op, not an error
  });

  it("redo moves the cursor forward, and is disabled (null) at the newest", async () => {
    await record(testDb, { label: "gen1" });
    await record(testDb, { label: "gen2" });
    await undoRevision(asD1(testDb), EVENT_ID, OWNER);

    const result = await redoRevision(asD1(testDb), EVENT_ID, OWNER);
    expect(result).not.toBeNull();
    expect(await getCursor(testDb)).toBe(2);

    const atEnd = await redoRevision(asD1(testDb), EVENT_ID, OWNER);
    expect(atEnd).toBeNull();
    expect(await getCursor(testDb)).toBe(2);
  });

  it("undo/redo never insert a revision row themselves", async () => {
    await record(testDb, { label: "gen1" });
    await record(testDb, { label: "gen2" });
    const before = (await listRevisionRows(testDb)).length;

    await undoRevision(asD1(testDb), EVENT_ID, OWNER);
    await redoRevision(asD1(testDb), EVENT_ID, OWNER);

    expect(await listRevisionRows(testDb)).toHaveLength(before);
  });
});

describe("getHistoryState", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
  });

  it("returns no history and a null cursor before anything is recorded", async () => {
    const state = await getHistoryState(asD1(testDb), EVENT_ID);
    expect(state).toEqual({ cursor: null, revisions: [] });
  });

  it("lists revisions newest-seq-first, with each row's own metrics parsed back out", async () => {
    await record(testDb, { label: "gen1", metricsValue: 1 });
    await record(testDb, { label: "gen2", metricsValue: 2 });

    const state = await getHistoryState(asD1(testDb), EVENT_ID);
    expect(state.cursor).toBe(2);
    expect(state.revisions.map((r) => r.seq)).toEqual([2, 1]);
    expect(state.revisions.map((r) => r.metrics.demandMin)).toEqual([2, 1]);
    expect(state.revisions[0]).toMatchObject({ label: "gen2", kind: "generate", actor: "Owner" });
  });
});
