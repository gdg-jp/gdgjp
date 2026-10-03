import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type Metrics, assignmentKey } from "~/features/solver/types";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  readAssignments,
  readAssignmentsMap,
  readAssignmentsState,
  toAssignment,
  writeAssignments,
} from "./roster.server";

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

async function seedBase(db: TestD1Database, eventId: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES (?, 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, ?, ?, ?, ?)`,
    )
    .bind(eventId, `apply_${eventId}`, `view_${eventId}`, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
       VALUES (?, ?, '全体', '#000', 1, 0, ?)`,
    )
    .bind(`trk_${eventId}`, eventId, `default:${eventId}`)
    .run();
  await db
    .prepare("INSERT INTO event_roles (event_id, role_id) VALUES (?, 'reception')")
    .bind(eventId)
    .run();
  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES (?, ?, 0, '09:00', '10:00', ?)`,
    )
    .bind(`slot_${eventId}`, eventId, `default:${eventId}`)
    .run();
  await db
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(`app_${eventId}`, eventId, `user_${eventId}`, `${eventId}@example.com`, eventId, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO demands
        (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max,
         roster_sheet_id)
       VALUES (?, ?, ?, 'reception', 0, 1, 0, 1, ?)`,
    )
    .bind(eventId, `slot_${eventId}`, `trk_${eventId}`, `default:${eventId}`)
    .run();
}

async function seedSiblingSheet(db: TestD1Database, eventId: string) {
  const sheetId = `sheet:${eventId}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min, seed, created_at, updated_at)
       VALUES (?, ?, 'After party', '2026-11-07', '19:00', '20:00', 60, 1, ?, ?)`,
    )
    .bind(sheetId, eventId, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
       VALUES (?, ?, 'After party', '#000', 0, 0, ?)`,
    )
    .bind(`trk_${sheetId}`, eventId, sheetId)
    .run();
  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES (?, ?, 0, '19:00', '20:00', ?)`,
    )
    .bind(`slot_${sheetId}`, eventId, sheetId)
    .run();
  await db
    .prepare("INSERT INTO roster_sheet_roles (roster_sheet_id, role_id) VALUES (?, 'guide')")
    .bind(sheetId)
    .run();
  await db
    .prepare(
      `INSERT INTO demands
        (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max,
         roster_sheet_id)
       VALUES (?, ?, ?, 'guide', 0, 1, 0, 1, ?)`,
    )
    .bind(eventId, `slot_${sheetId}`, `trk_${sheetId}`, sheetId)
    .run();
  return sheetId;
}

describe("toAssignment", () => {
  it("maps snake_case columns, including locked as a boolean", () => {
    expect(
      toAssignment({
        event_id: "evt_1",
        roster_sheet_id: "default:evt_1",
        application_id: "app_1",
        time_slot_id: "slot_1",
        track_id: "trk_1",
        role_id: "reception",
        locked: 1,
      }),
    ).toEqual({
      eventId: "evt_1",
      rosterSheetId: "default:evt_1",
      applicationId: "app_1",
      timeSlotId: "slot_1",
      trackId: "trk_1",
      roleId: "reception",
      locked: true,
    });
  });
});

describe("writeAssignments / readAssignments / readAssignmentsMap", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedBase(testDb, "evt_1");
    await seedBase(testDb, "evt_2");
  });

  it("round-trips a full assignments map through write then read", async () => {
    const next = new Map([
      [
        assignmentKey("app_evt_1", "slot_evt_1"),
        { trackId: "trk_evt_1", roleId: "reception", locked: false },
      ],
    ]);
    await writeAssignments(asD1(testDb), "evt_1", next);

    const rows = await readAssignments(asD1(testDb), "evt_1");
    expect(rows).toEqual([
      {
        eventId: "evt_1",
        rosterSheetId: "default:evt_1",
        applicationId: "app_evt_1",
        timeSlotId: "slot_evt_1",
        trackId: "trk_evt_1",
        roleId: "reception",
        locked: false,
      },
    ]);

    const map = await readAssignmentsMap(asD1(testDb), "evt_1");
    expect(map).toEqual(next);
  });

  it("a second write fully replaces the first — no stale rows survive", async () => {
    await writeAssignments(
      asD1(testDb),
      "evt_1",
      new Map([
        [
          assignmentKey("app_evt_1", "slot_evt_1"),
          { trackId: "trk_evt_1", roleId: "reception", locked: false },
        ],
      ]),
    );

    // A regenerate (or a manual edit) that no longer places this applicant
    // anywhere must leave zero rows behind for them, not a stray leftover
    // from the previous write.
    await writeAssignments(asD1(testDb), "evt_1", new Map());

    const rows = await readAssignments(asD1(testDb), "evt_1");
    expect(rows).toEqual([]);
  });

  it("never touches another event's assignments", async () => {
    await writeAssignments(
      asD1(testDb),
      "evt_1",
      new Map([
        [
          assignmentKey("app_evt_1", "slot_evt_1"),
          { trackId: "trk_evt_1", roleId: "reception", locked: false },
        ],
      ]),
    );
    await writeAssignments(
      asD1(testDb),
      "evt_2",
      new Map([
        [
          assignmentKey("app_evt_2", "slot_evt_2"),
          { trackId: "trk_evt_2", roleId: "reception", locked: true },
        ],
      ]),
    );

    // Re-writing evt_1 to empty must not disturb evt_2's row.
    await writeAssignments(asD1(testDb), "evt_1", new Map());

    const evt1Rows = await readAssignments(asD1(testDb), "evt_1");
    const evt2Rows = await readAssignments(asD1(testDb), "evt_2");
    expect(evt1Rows).toEqual([]);
    expect(evt2Rows).toHaveLength(1);
    expect(evt2Rows[0]).toMatchObject({ applicationId: "app_evt_2", locked: true });
  });

  it("persists locked as an integer and reads it back as a boolean", async () => {
    await writeAssignments(
      asD1(testDb),
      "evt_1",
      new Map([
        [
          assignmentKey("app_evt_1", "slot_evt_1"),
          { trackId: "trk_evt_1", roleId: "reception", locked: true },
        ],
      ]),
    );
    const map = await readAssignmentsMap(asD1(testDb), "evt_1");
    expect(map.get(assignmentKey("app_evt_1", "slot_evt_1"))).toEqual({
      trackId: "trk_evt_1",
      roleId: "reception",
      locked: true,
    });
  });

  it("readAssignments returns [] for an event with no assignments yet", async () => {
    const rows = await readAssignments(asD1(testDb), "evt_1");
    expect(rows).toEqual([]);
  });

  it("replaces only the selected sheet and uses the default for event-only reads", async () => {
    const sheetId = await seedSiblingSheet(testDb, "evt_1");
    const sibling = new Map([
      [
        assignmentKey("app_evt_1", `slot_${sheetId}`),
        { trackId: `trk_${sheetId}`, roleId: "guide", locked: false },
      ],
    ]);
    await writeAssignments(asD1(testDb), "evt_1", sibling, undefined, sheetId);

    await writeAssignments(asD1(testDb), "evt_1", new Map());

    expect(await readAssignments(asD1(testDb), "evt_1", sheetId)).toMatchObject([
      { rosterSheetId: sheetId, applicationId: "app_evt_1", roleId: "guide" },
    ]);
    expect(await readAssignments(asD1(testDb), "evt_1")).toEqual([]);
  });

  it("rejects assignment rows whose applicant belongs to another event", async () => {
    await expect(
      writeAssignments(
        asD1(testDb),
        "evt_1",
        new Map([
          [
            assignmentKey("app_evt_2", "slot_evt_1"),
            { trackId: "trk_evt_1", roleId: "reception", locked: false },
          ],
        ]),
      ),
    ).rejects.toThrow("Assignment must reference entities in the selected roster sheet");
  });

  it("rejects an explicitly empty sheet ID instead of falling back to the default", async () => {
    await expect(readAssignments(asD1(testDb), "evt_1", "")).rejects.toThrow(
      "Roster sheet not found for this event.",
    );
    await expect(writeAssignments(asD1(testDb), "evt_1", new Map(), undefined, "")).rejects.toThrow(
      "Roster sheet not found for this event.",
    );
  });

  it("rejects slots, tracks, and roles not selected for the target sheet", async () => {
    const sheetId = await seedSiblingSheet(testDb, "evt_1");
    await expect(
      writeAssignments(
        asD1(testDb),
        "evt_1",
        new Map([
          [
            assignmentKey("app_evt_1", "slot_evt_1"),
            { trackId: `trk_${sheetId}`, roleId: "guide", locked: false },
          ],
        ]),
        undefined,
        sheetId,
      ),
    ).rejects.toThrow("Assignment must reference entities in the selected roster sheet");

    await expect(
      writeAssignments(
        asD1(testDb),
        "evt_1",
        new Map([
          [
            assignmentKey("app_evt_1", `slot_${sheetId}`),
            { trackId: "trk_evt_1", roleId: "reception", locked: false },
          ],
        ]),
        undefined,
        sheetId,
      ),
    ).rejects.toThrow("Assignment must reference entities in the selected roster sheet");

    await expect(
      writeAssignments(
        asD1(testDb),
        "evt_1",
        new Map([
          [
            assignmentKey("app_evt_1", `slot_${sheetId}`),
            { trackId: `trk_${sheetId}`, roleId: "reception", locked: false },
          ],
        ]),
        undefined,
        sheetId,
      ),
    ).rejects.toThrow("Assignment must reference entities in the selected roster sheet");
  });

  it("rejects a demand row linked to a different sheet", async () => {
    const sheetId = await seedSiblingSheet(testDb, "evt_1");
    await testDb
      .prepare(
        `UPDATE demands SET roster_sheet_id = 'default:evt_1'
         WHERE event_id = ? AND time_slot_id = ? AND track_id = ? AND role_id = 'guide'`,
      )
      .bind("evt_1", `slot_${sheetId}`, `trk_${sheetId}`)
      .run();

    await expect(
      writeAssignments(
        asD1(testDb),
        "evt_1",
        new Map([
          [
            assignmentKey("app_evt_1", `slot_${sheetId}`),
            { trackId: `trk_${sheetId}`, roleId: "guide", locked: false },
          ],
        ]),
        undefined,
        sheetId,
      ),
    ).rejects.toThrow("Assignment must reference entities in the selected roster sheet");
  });

  it("rejects assignments when the matching selected-sheet demand is absent", async () => {
    await testDb
      .prepare("DELETE FROM demands WHERE event_id = 'evt_1' AND time_slot_id = 'slot_evt_1'")
      .run();

    await expect(
      writeAssignments(
        asD1(testDb),
        "evt_1",
        new Map([
          [
            assignmentKey("app_evt_1", "slot_evt_1"),
            { trackId: "trk_evt_1", roleId: "reception", locked: false },
          ],
        ]),
      ),
    ).rejects.toThrow("Assignment must reference entities in the selected roster sheet");
  });

  it("rejects assignments when the matching demand has ideal_count zero", async () => {
    await testDb
      .prepare(
        "UPDATE demands SET ideal_count = 0 WHERE event_id = 'evt_1' AND time_slot_id = 'slot_evt_1'",
      )
      .run();

    await expect(
      writeAssignments(
        asD1(testDb),
        "evt_1",
        new Map([
          [
            assignmentKey("app_evt_1", "slot_evt_1"),
            { trackId: "trk_evt_1", roleId: "reception", locked: false },
          ],
        ]),
      ),
    ).rejects.toThrow("Assignment must reference entities in the selected roster sheet");
  });

  it("accepts assignments backed by a positive demand on the selected sheet", async () => {
    const next = new Map([
      [
        assignmentKey("app_evt_1", "slot_evt_1"),
        { trackId: "trk_evt_1", roleId: "reception", locked: false },
      ],
    ]);
    await writeAssignments(asD1(testDb), "evt_1", next);

    expect(await readAssignmentsMap(asD1(testDb), "evt_1")).toEqual(next);
  });

  it("rejects the second edit when both edits used the same observed cursor", async () => {
    const db = asD1(testDb);
    const firstState = await readAssignmentsState(db, "evt_1");
    const secondState = await readAssignmentsState(db, "evt_1");
    expect(firstState.revisionCursor).toBeNull();
    expect(secondState.revisionCursor).toBeNull();

    const firstEdit = new Map([
      [
        assignmentKey("app_evt_1", "slot_evt_1"),
        { trackId: "trk_evt_1", roleId: "reception", locked: false },
      ],
    ]);
    const revision = {
      metrics: {
        demandMin: 0,
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
      },
      label: "手動編集",
      actor: { id: "owner", name: "Owner" },
      kind: "edit" as const,
      groupKey: "owner",
    };
    await writeAssignments(db, "evt_1", firstEdit, revision, undefined, firstState.revisionCursor);

    await expect(
      writeAssignments(db, "evt_1", new Map(), revision, undefined, secondState.revisionCursor),
    ).rejects.toThrow("History changed concurrently; retry the operation.");

    const finalState = await readAssignmentsState(db, "evt_1");
    expect(finalState.assignments).toEqual(firstEdit);
    expect(finalState.revisionCursor).toBe(1);
    expect(
      await testDb.prepare("SELECT seq FROM revisions WHERE event_id = 'evt_1'").all(),
    ).toMatchObject({ results: [{ seq: 1 }] });
  });

  it("does not write assignments or history after a cursor CAS loses a race", async () => {
    const db = asD1(testDb);
    const original = new Map([
      [
        assignmentKey("app_evt_1", "slot_evt_1"),
        { trackId: "trk_evt_1", roleId: "reception", locked: false },
      ],
    ]);
    await writeAssignments(db, "evt_1", original);

    const raceMetrics: Metrics = {
      demandMin: 0,
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
    let injectConcurrentRevision = true;
    const racingDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        if (injectConcurrentRevision) {
          injectConcurrentRevision = false;
          const now = new Date().toISOString();
          await testDb
            .prepare(
              `INSERT INTO revisions
                (id, event_id, seq, label, actor, actor_id, kind, group_key, snapshot, metrics,
                 created_at, roster_sheet_id)
               VALUES ('race-revision', 'evt_1', 1, 'Concurrent', 'Owner', 'owner',
                 'edit', 'owner', '{"v":1,"items":[]}', ?, ?, 'default:evt_1')`,
            )
            .bind(JSON.stringify(raceMetrics), now)
            .run();
          await testDb
            .prepare("UPDATE roster_sheets SET revision_cursor = 1 WHERE id = 'default:evt_1'")
            .run();
        }
        return db.batch(statements);
      },
    } as unknown as D1Database;

    await expect(
      writeAssignments(racingDb, "evt_1", new Map(), {
        metrics: raceMetrics,
        label: "手動編集",
        actor: { id: "owner", name: "Owner" },
        kind: "edit",
        groupKey: "owner",
      }),
    ).rejects.toThrow("History changed concurrently; retry the operation.");

    expect(await readAssignments(db, "evt_1")).toEqual([
      {
        eventId: "evt_1",
        rosterSheetId: "default:evt_1",
        applicationId: "app_evt_1",
        timeSlotId: "slot_evt_1",
        trackId: "trk_evt_1",
        roleId: "reception",
        locked: false,
      },
    ]);
    expect(
      await testDb.prepare("SELECT id, seq FROM revisions WHERE event_id = 'evt_1'").all(),
    ).toMatchObject({ results: [{ id: "race-revision", seq: 1 }] });
    expect(
      await testDb
        .prepare("SELECT revision_cursor FROM roster_sheets WHERE id = 'default:evt_1'")
        .first(),
    ).toEqual({ revision_cursor: 1 });
    expect(
      await testDb.prepare("SELECT revision_cursor FROM events WHERE id = 'evt_1'").first(),
    ).toEqual({ revision_cursor: null });
  });
});
