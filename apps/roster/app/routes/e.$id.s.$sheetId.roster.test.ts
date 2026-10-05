import { fileURLToPath } from "node:url";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { signPayload, verifyPayload } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  requireUserWithChapter: vi.fn(),
}));

import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { evaluate } from "~/features/solver/evaluate";
import type { SolverInput } from "~/features/solver/types";
import { type TestD1Database, asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import { action, loader } from "./e.$id.s.$sheetId.roster";

const MIGRATIONS = [
  fileURLToPath(new URL("../../migrations/0002_domain.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0003_demands.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0004_applications.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0005_assignments.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0006_revisions.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0007_roster_sheets_expand.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0008_default_sheet_compat.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0009_time_slots_sheet_uniqueness.sql", import.meta.url)),
  fileURLToPath(new URL("../../migrations/0010_revisions_sheet_sequence.sql", import.meta.url)),
];

const OWNER_CHAPTER: UserChapter = { chapterId: 1, chapterSlug: "tokyo", role: "member" };
const OTHER_CHAPTER: UserChapter = { chapterId: 99, chapterSlug: "osaka", role: "member" };

function mockContext(db: D1Database) {
  return {
    cloudflare: { env: { DB: db, RP_SESSION_SECRET: "test-roster-secret" } as unknown as Env },
  } as Parameters<typeof loader>[0]["context"];
}

function routeArgs(request: Request, id: string, db: D1Database, sheetId = `default:${id}`) {
  return {
    request,
    params: { id, sheetId },
    context: mockContext(db),
    unstable_pattern: "/e/:id/s/:sheetId/roster",
    unstable_url: new URL(request.url),
  };
}

function callLoader(request: Request, id: string, db: D1Database, sheetId?: string) {
  return loader(routeArgs(request, id, db, sheetId) as Parameters<typeof loader>[0]);
}

function callAction(request: Request, id: string, db: D1Database, sheetId?: string) {
  return action(routeArgs(request, id, db, sheetId) as Parameters<typeof action>[0]);
}

function asOwner() {
  vi.mocked(requireUserWithChapter).mockResolvedValue({
    user: { id: "owner_1", email: "owner@example.com", name: "Owner", image: null, isAdmin: false },
    chapter: OWNER_CHAPTER,
    chapters: [OWNER_CHAPTER],
  });
}

/**
 * A small but non-trivial fixture: 2 slots, 1 track, 1 demanded role
 * (min 1 / ideal 1), 2 applicants — one available `x` for slot_1 (used by
 * the warn-and-allow test below), one available `o` everywhere.
 */
async function seedFixture(db: TestD1Database) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, no_solo_newcomer, max_consecutive, created_at, updated_at)
       VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '11:00', 1, 'tok1', 'view1', 1, 4, ?, ?)`,
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO tracks (id, event_id, name, color, shared, sort_order) VALUES ('trk_1', 'evt_1', '全体', '#000', 1, 0)",
    )
    .run();
  await db
    .prepare("INSERT INTO event_roles (event_id, role_id) VALUES ('evt_1', 'reception')")
    .run();
  await db
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES ('slot_0', 'evt_1', 0, '09:00', '10:00'), ('slot_1', 'evt_1', 1, '10:00', '11:00')",
    )
    .run();
  await db
    .prepare(
      `INSERT INTO demands (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max)
       VALUES ('evt_1', 'slot_0', 'trk_1', 'reception', 1, 1, 0, 99), ('evt_1', 'slot_1', 'trk_1', 'reception', 1, 1, 0, 99)`,
    )
    .run();

  for (const [id, avail1] of [
    ["app_o", "o"],
    ["app_x", "x"],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
         VALUES (?, 'evt_1', ?, ?, ?, ?, ?)`,
      )
      .bind(id, `user_${id}`, `${id}@example.com`, id, now, now)
      .run();
    await db
      .prepare(
        "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES (?, 'reception', 'exp', 2)",
      )
      .bind(id)
      .run();
    await db
      .prepare(
        "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, 'slot_0', 'o')",
      )
      .bind(id)
      .run();
    await db
      .prepare(
        "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, 'slot_1', ?)",
      )
      .bind(id, avail1)
      .run();
  }
}

async function seedSiblingAssignment(db: TestD1Database, start = "09:30", end = "10:30") {
  await seedSiblingSheet(db, start, end);
  await db
    .prepare(
      `INSERT INTO assignments
        (event_id, roster_sheet_id, application_id, time_slot_id, track_id, role_id, locked)
       VALUES ('evt_1', 'sheet_other', 'app_o', 'slot_other', 'track_other', 'reception', 0)`,
    )
    .run();
}

async function seedSiblingSheet(db: TestD1Database, start = "09:30", end = "10:30") {
  await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min, seed, created_at, updated_at)
       VALUES ('sheet_other', 'evt_1', '懇親会', '2026-11-07', ?, ?, 60, 1, 'now', 'now')`,
    )
    .bind(start, end)
    .run();
  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES ('slot_other', 'evt_1', 0, ?, ?, 'sheet_other')`,
    )
    .bind(start, end)
    .run();
  await db
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
       VALUES ('track_other', 'evt_1', '懇親会', '#000', 0, 0, 'sheet_other')`,
    )
    .run();
}

function addSiblingAssignmentInNextBatch(db: TestD1Database, applicationId: string): D1Database {
  let inserted = false;
  return asD1({
    prepare: (sql) => db.prepare(sql),
    async batch(statements) {
      if (!inserted) {
        inserted = true;
        await db
          .prepare(
            `INSERT INTO assignments
              (event_id, roster_sheet_id, application_id, time_slot_id, track_id, role_id, locked)
             VALUES ('evt_1', 'sheet_other', ?, 'slot_other', 'track_other', 'reception', 0)`,
          )
          .bind(applicationId)
          .run();
      }
      return db.batch(statements);
    },
  });
}

async function seedAdditionalSiblingSlot(db: TestD1Database) {
  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES ('slot_other_2', 'evt_1', 1, '09:15', '10:15', 'sheet_other')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO assignments
        (event_id, roster_sheet_id, application_id, time_slot_id, track_id, role_id, locked)
       VALUES ('evt_1', 'sheet_other', 'app_o', 'slot_other_2', 'track_other', 'reception', 0)`,
    )
    .run();
}

function buildRequest(fields: Record<string, string | string[]>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) form.append(key, v);
    else form.set(key, value);
  }
  return new Request("http://localhost/e/evt_1/s/default:evt_1/roster", {
    method: "POST",
    body: form,
  });
}

async function readAssignmentRows(db: TestD1Database) {
  const { results } = await db
    .prepare(
      "SELECT application_id, time_slot_id, track_id, role_id, locked FROM assignments ORDER BY time_slot_id, application_id",
    )
    .all<Record<string, unknown>>();
  return results;
}

describe("e.$id.roster loader", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedFixture(testDb);
  });

  it("404s for an unknown event id", async () => {
    asOwner();
    await expect(
      callLoader(
        new Request("http://localhost/e/no-such-event/roster"),
        "no-such-event",
        asD1(testDb),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("403s a chapter that doesn't own the event", async () => {
    vi.mocked(requireUserWithChapter).mockResolvedValue({
      user: { id: "u2", email: "u2@example.com", name: "U2", image: null, isAdmin: false },
      chapter: OTHER_CHAPTER,
      chapters: [OTHER_CHAPTER],
    });
    await expect(
      callLoader(new Request("http://localhost/e/evt_1/roster"), "evt_1", asD1(testDb)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reports hasAssignments: false before any generation", async () => {
    asOwner();
    const result = await callLoader(
      new Request("http://localhost/e/evt_1/roster"),
      "evt_1",
      asD1(testDb),
    );
    expect(result.hasAssignments).toBe(false);
    expect(result.assignmentEntries).toEqual([]);
  });
});

describe("e.$id.roster action — generate", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedFixture(testDb);
    asOwner();
  });

  /**
   * docs/roster/07-roster-manual-edit.md "回帰として固定すべきテスト":
   * "同じシードで2回生成するとassignmentsテーブルの内容が完全一致する" —
   * exercised through the REAL route action (buildSolverInput -> solve ->
   * writeAssignments), not just buildSolverInput's own unit test, so this
   * pins the whole chain the reviewer is asked to check.
   */
  it("regenerating with the same seed writes byte-identical assignment rows", async () => {
    const first = await callAction(
      buildRequest({ intent: "generate", seed: "42" }),
      "evt_1",
      asD1(testDb),
    );
    expect(first).toMatchObject({ ok: true, intent: "generate", seed: 42 });
    const firstRows = await readAssignmentRows(testDb);

    const second = await callAction(
      buildRequest({ intent: "generate", seed: "42" }),
      "evt_1",
      asD1(testDb),
    );
    expect(second).toMatchObject({ ok: true, intent: "generate", seed: 42 });
    const secondRows = await readAssignmentRows(testDb);

    expect(secondRows).toEqual(firstRows);
    expect(firstRows.length).toBeGreaterThan(0);
  });

  it("a regenerate leaves no stale rows from the previous run", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "1" }), "evt_1", asD1(testDb));
    const firstCount = (await readAssignmentRows(testDb)).length;
    expect(firstCount).toBeGreaterThan(0);

    // A different seed can produce a different (possibly smaller) placement
    // set — the row count after must reflect ONLY the new run, never the
    // old run's leftovers unioned in.
    await callAction(buildRequest({ intent: "generate", seed: "999" }), "evt_1", asD1(testDb));
    const rows = await readAssignmentRows(testDb);
    const seen = new Set(rows.map((r) => `${r.application_id}|${r.time_slot_id}`));
    expect(seen.size).toBe(rows.length); // no duplicate (app, slot) pairs survived
  });

  it("persists a changed seed to the selected roster sheet", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "777" }), "evt_1", asD1(testDb));
    const row = await testDb
      .prepare("SELECT seed FROM roster_sheets WHERE id = 'default:evt_1'")
      .first<{ seed: number }>();
    expect(row?.seed).toBe(777);
  });

  it("rolls back generated assignments, history, and cursor when a sibling overlap races the write", async () => {
    const db = asD1(testDb);
    const generated = await callAction(
      buildRequest({ intent: "generate", seed: "42" }),
      "evt_1",
      db,
    );
    expect(generated).toMatchObject({ ok: true, intent: "generate", seed: 42 });

    const priorAssignments = await testDb
      .prepare(
        `SELECT application_id, time_slot_id, track_id, role_id, locked
         FROM assignments WHERE roster_sheet_id = 'default:evt_1'
         ORDER BY time_slot_id, application_id`,
      )
      .all();
    expect(priorAssignments.results.length).toBeGreaterThan(0);
    const targetAssignment = priorAssignments.results[0] as { application_id: string };
    const priorHistory = await testDb
      .prepare(
        `SELECT seq, snapshot, metrics FROM revisions
         WHERE event_id = 'evt_1' AND roster_sheet_id = 'default:evt_1' ORDER BY seq`,
      )
      .all();
    const priorCursor = await testDb
      .prepare("SELECT revision_cursor FROM roster_sheets WHERE id = 'default:evt_1'")
      .first();
    const priorEventCursor = await testDb
      .prepare("SELECT revision_cursor FROM events WHERE id = 'evt_1'")
      .first();

    await seedSiblingSheet(testDb);
    const result = await callAction(
      buildRequest({ intent: "generate", seed: "42" }),
      "evt_1",
      addSiblingAssignmentInNextBatch(testDb, targetAssignment.application_id),
    );

    expect(result).toMatchObject({
      ok: false,
      intent: "generate",
      error: expect.stringContaining("再読み込みして、もう一度自動生成"),
    });
    expect(
      await testDb
        .prepare(
          `SELECT application_id, time_slot_id, track_id, role_id, locked
           FROM assignments WHERE roster_sheet_id = 'default:evt_1'
           ORDER BY time_slot_id, application_id`,
        )
        .all(),
    ).toEqual(priorAssignments);
    expect(
      await testDb
        .prepare(
          `SELECT seq, snapshot, metrics FROM revisions
           WHERE event_id = 'evt_1' AND roster_sheet_id = 'default:evt_1' ORDER BY seq`,
        )
        .all(),
    ).toEqual(priorHistory);
    expect(
      await testDb
        .prepare("SELECT revision_cursor FROM roster_sheets WHERE id = 'default:evt_1'")
        .first(),
    ).toEqual(priorCursor);
    expect(
      await testDb.prepare("SELECT revision_cursor FROM events WHERE id = 'evt_1'").first(),
    ).toEqual(priorEventCursor);
    expect(
      await testDb
        .prepare("SELECT application_id FROM assignments WHERE roster_sheet_id = 'sheet_other'")
        .first(),
    ).toEqual({ application_id: targetAssignment.application_id });
  });
});

describe("e.$id.roster action — manual edit (warn-and-allow)", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedFixture(testDb);
    asOwner();
  });

  /**
   * docs/roster/07-roster-manual-edit.md "回帰として固定すべきテスト":
   * "手動編集で稼働×の枠に配置でき、警告が出る" — the asymmetry with
   * auto-generation is deliberate; this must NOT be rejected.
   */
  it("allows assigning a staff member to a slot they marked unavailable ('x')", async () => {
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_x",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_1"],
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "assign" });

    const rows = await readAssignmentRows(testDb);
    expect(rows).toEqual([
      {
        application_id: "app_x",
        time_slot_id: "slot_1",
        track_id: "trk_1",
        role_id: "reception",
        locked: 0,
      },
    ]);
  });

  it("assign then unassign leaves no row for that (application, slot)", async () => {
    await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_0"],
      }),
      "evt_1",
      asD1(testDb),
    );
    const result = await callAction(
      buildRequest({ intent: "unassign", applicationId: "app_o", slotId: ["slot_0"] }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "unassign" });
    expect(await readAssignmentRows(testDb)).toEqual([]);
  });

  it("moving a person within the same slot removes their old cell (never two placements in one slot)", async () => {
    await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_0"],
      }),
      "evt_1",
      asD1(testDb),
    );
    // Re-assign the same (app, slot) — simulates picking a different
    // candidate cell for the same staff member's same time slot.
    await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_0"],
      }),
      "evt_1",
      asD1(testDb),
    );
    const rows = await readAssignmentRows(testDb);
    expect(
      rows.filter((r) => r.application_id === "app_o" && r.time_slot_id === "slot_0"),
    ).toHaveLength(1);
  });

  it("assigning a range writes one row per slot in the range in a single request", async () => {
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_0", "slot_1"],
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "assign" });
    const rows = await readAssignmentRows(testDb);
    expect(rows.map((r) => r.time_slot_id)).toEqual(["slot_0", "slot_1"]);
  });

  it("rejects a malformed assign request without touching assignments", async () => {
    const result = await callAction(
      buildRequest({ intent: "assign", applicationId: "app_o" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ error: "入力が不正です。", intent: "assign" });
    expect(await readAssignmentRows(testDb)).toEqual([]);
  });

  it("returns a signed warning for an overlapping sibling assignment without writing", async () => {
    await seedSiblingAssignment(testDb);
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );

    expect(result).toMatchObject({
      warning: "cross-sheet",
      conflicts: [
        {
          sheetName: "懇親会",
          date: "2026-11-07",
          startTime: "09:30",
          endTime: "10:30",
        },
      ],
      assignment: {
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotIds: ["slot_0"],
      },
      intent: "assign",
    });
    expect((result as { confirmation?: string }).confirmation).toBeTruthy();
    expect(await readAssignmentRows(testDb)).toHaveLength(1);
    expect(await testDb.prepare("SELECT id FROM revisions").all()).toMatchObject({ results: [] });
  });

  it("writes the exact confirmed assignment and records its history", async () => {
    await seedSiblingAssignment(testDb);
    const warning = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(warning).toHaveProperty("warning", "cross-sheet");
    const confirmation = (warning as { confirmation: string }).confirmation;
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
        conflictConfirmation: confirmation,
      }),
      "evt_1",
      asD1(testDb),
    );

    expect(result).toEqual({ ok: true, intent: "assign" });
    expect(await readAssignmentRows(testDb)).toHaveLength(2);
    expect(await testDb.prepare("SELECT label, actor_id FROM revisions").all()).toMatchObject({
      results: [{ label: "手動編集", actor_id: "owner_1" }],
    });
  });

  it("does not warn for an adjacent sibling slot", async () => {
    await seedSiblingAssignment(testDb, "10:00", "11:00");
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );

    expect(result).toEqual({ ok: true, intent: "assign" });
    expect(await readAssignmentRows(testDb)).toHaveLength(2);
  });

  it("rejects a changed confirmation payload without writing the proposed target row", async () => {
    await seedSiblingAssignment(testDb);
    const warning = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );
    const confirmation = (warning as { confirmation: string }).confirmation;
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_x",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
        conflictConfirmation: confirmation,
      }),
      "evt_1",
      asD1(testDb),
    );

    expect(result).toMatchObject({ warning: "cross-sheet", conflicts: [], intent: "assign" });
    expect(await readAssignmentRows(testDb)).toHaveLength(1);

    await testDb
      .prepare(
        `INSERT INTO events
          (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token,
           created_at, updated_at)
         VALUES ('evt_2', 1, '別イベント', '2026-11-07', '09:00', '11:00', 1,
           'apply2', 'view2', 'now', 'now')`,
      )
      .run();
    const crossEvent = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
        conflictConfirmation: confirmation,
      }),
      "evt_2",
      asD1(testDb),
    );
    expect(crossEvent).toMatchObject({ warning: "cross-sheet", conflicts: [], intent: "assign" });
    expect(
      await testDb.prepare("SELECT application_id FROM assignments WHERE event_id = 'evt_2'").all(),
    ).toMatchObject({ results: [] });
  });

  it("allows the confirmed conflict but rolls back if a new one appears inside the batch", async () => {
    await seedSiblingAssignment(testDb);
    const warning = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );
    const confirmation = (warning as { confirmation: string }).confirmation;
    const db = asD1(testDb);
    let injectConflict = true;
    const racingDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        if (injectConflict) {
          injectConflict = false;
          await seedAdditionalSiblingSlot(testDb);
        }
        return db.batch(statements);
      },
    } as unknown as D1Database;
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
        conflictConfirmation: confirmation,
      }),
      "evt_1",
      racingDb,
    );

    expect(result).toMatchObject({ warning: "cross-sheet", conflicts: [{}, {}], intent: "assign" });
    expect(await readAssignmentRows(testDb)).toHaveLength(2);
    expect(await testDb.prepare("SELECT id FROM revisions").all()).toMatchObject({ results: [] });
  });

  it("returns a fresh warning when the confirmed conflict set gains a new pair", async () => {
    await seedSiblingAssignment(testDb);
    const initial = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );
    const initialConfirmation = (initial as { confirmation: string }).confirmation;
    await seedAdditionalSiblingSlot(testDb);
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
        conflictConfirmation: initialConfirmation,
      }),
      "evt_1",
      asD1(testDb),
    );

    expect(result).toMatchObject({ warning: "cross-sheet", conflicts: [{}, {}] });
    expect((result as { confirmation: string }).confirmation).not.toBe(initialConfirmation);
    expect(await readAssignmentRows(testDb)).toHaveLength(2);
    expect(await testDb.prepare("SELECT id FROM revisions").all()).toMatchObject({ results: [] });
  });

  it("refreshes an expired confirmation instead of applying it", async () => {
    await seedSiblingAssignment(testDb);
    const initial = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );
    const initialConfirmation = (initial as { confirmation: string }).confirmation;
    const payload = await verifyPayload<Record<string, unknown>>(
      initialConfirmation,
      "test-roster-secret",
    );
    if (!payload) throw new Error("Expected a signed assignment confirmation");
    const expiredConfirmation = await signPayload(
      { ...payload, issuedAt: Date.now() - 10 * 60 * 1000 },
      "test-roster-secret",
    );
    const result = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
        conflictConfirmation: expiredConfirmation,
      }),
      "evt_1",
      asD1(testDb),
    );

    expect(result).toMatchObject({ warning: "cross-sheet", conflicts: [{ sheetName: "懇親会" }] });
    expect((result as { confirmation: string }).confirmation).not.toBe(expiredConfirmation);
    expect(await readAssignmentRows(testDb)).toHaveLength(1);
    expect(await testDb.prepare("SELECT id FROM revisions").all()).toMatchObject({ results: [] });
  });

  it("rejects replay by refreshing the warning after the first confirmed write", async () => {
    await seedSiblingAssignment(testDb);
    const initial = await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: "slot_0",
      }),
      "evt_1",
      asD1(testDb),
    );
    const confirmation = (initial as { confirmation: string }).confirmation;
    const confirmFields = {
      intent: "assign",
      applicationId: "app_o",
      trackId: "trk_1",
      roleId: "reception",
      slotId: "slot_0",
      conflictConfirmation: confirmation,
    };
    expect(await callAction(buildRequest(confirmFields), "evt_1", asD1(testDb))).toEqual({
      ok: true,
      intent: "assign",
    });

    const replay = await callAction(buildRequest(confirmFields), "evt_1", asD1(testDb));
    expect(replay).toMatchObject({ warning: "cross-sheet", intent: "assign" });
    expect((replay as { confirmation: string }).confirmation).not.toBe(confirmation);
    expect(await readAssignmentRows(testDb)).toHaveLength(2);
  });

  it("rejects replay after a confirmed edit merges into the same history head", async () => {
    const assignmentFields = {
      intent: "assign",
      applicationId: "app_o",
      trackId: "trk_1",
      roleId: "reception",
      slotId: "slot_0",
    };
    await callAction(buildRequest(assignmentFields), "evt_1", asD1(testDb));
    const oldCreatedAt = new Date(Date.now() - 60_000).toISOString();
    await testDb
      .prepare("UPDATE revisions SET created_at = ? WHERE event_id = 'evt_1'")
      .bind(oldCreatedAt)
      .run();
    await seedSiblingAssignment(testDb);
    const warning = await callAction(buildRequest(assignmentFields), "evt_1", asD1(testDb));
    const confirmation = (warning as { confirmation: string }).confirmation;
    const confirmedFields = { ...assignmentFields, conflictConfirmation: confirmation };
    expect(await callAction(buildRequest(confirmedFields), "evt_1", asD1(testDb))).toEqual({
      ok: true,
      intent: "assign",
    });
    const mergedHead = await testDb
      .prepare("SELECT seq, created_at FROM revisions WHERE event_id = 'evt_1'")
      .all<{ seq: number; created_at: string }>();
    expect(mergedHead.results).toHaveLength(1);
    expect(mergedHead.results?.[0]).toMatchObject({ seq: 1 });
    expect(mergedHead.results?.[0]?.created_at).not.toBe(oldCreatedAt);

    const replay = await callAction(buildRequest(confirmedFields), "evt_1", asD1(testDb));
    expect(replay).toMatchObject({ warning: "cross-sheet", intent: "assign" });
    expect((replay as { confirmation: string }).confirmation).not.toBe(confirmation);
    expect(
      await testDb.prepare("SELECT seq FROM revisions WHERE event_id = 'evt_1'").all(),
    ).toMatchObject({ results: [{ seq: 1 }] });
  });
});

describe("e.$id.roster loader — report consistency", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedFixture(testDb);
    asOwner();
  });

  /**
   * docs/roster/07-roster-manual-edit.md "制約": "evaluate を再実装しない" —
   * the loader's `report` must be exactly what evaluate() computes from the
   * SAME input/assignments it ships to the client, never a separate tally.
   */
  it("after a manual edit, the loader's report equals evaluate() run independently on the reconstructed input/assignments", async () => {
    await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_o",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_0"],
      }),
      "evt_1",
      asD1(testDb),
    );

    const result = await callLoader(
      new Request("http://localhost/e/evt_1/roster"),
      "evt_1",
      asD1(testDb),
    );

    const reconstructedInput: SolverInput = {
      slots: result.inputWire.slots,
      tracks: result.inputWire.tracks,
      roles: result.inputWire.roles,
      applications: result.inputWire.applications,
      options: result.inputWire.options,
      demands: new Map(result.inputWire.demandEntries),
    };
    const reconstructedAssignments = new Map(result.assignmentEntries);
    expect(result.report).toEqual(evaluate(reconstructedInput, reconstructedAssignments));
  });

  /**
   * docs/roster/08-history.md "Design" §6 — the loader must expose the same
   * `HistoryState` the history panel/undo-redo buttons render from.
   */
  it("exposes history state (cursor + revisions) after a generation", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "1" }), "evt_1", asD1(testDb));

    const result = await callLoader(
      new Request("http://localhost/e/evt_1/roster"),
      "evt_1",
      asD1(testDb),
    );

    expect(result.history.cursor).toBe(1);
    expect(result.history.revisions).toHaveLength(1);
    expect(result.history.revisions[0]).toMatchObject({ seq: 1, kind: "generate", actor: "Owner" });
  });
});

describe("e.$id.roster action — undo / redo / restore (Stage 08)", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedFixture(testDb);
    asOwner();
  });

  /**
   * docs/roster/08-history.md "Design" §2/§5: undo/redo just move the cursor
   * and re-expand a snapshot into `assignments` — this exercises that
   * through the REAL route action (generate -> edit -> undo -> redo), the
   * same "don't just unit-test history.server.ts in isolation" spirit as
   * the Stage 07 generate/manual-edit tests above.
   */
  it("undo restores the pre-edit assignments; redo brings the edit back", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "1" }), "evt_1", asD1(testDb));
    const afterGenerate = await readAssignmentRows(testDb);
    expect(afterGenerate.length).toBeGreaterThan(0);

    await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_x",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_1"],
      }),
      "evt_1",
      asD1(testDb),
    );
    const afterEdit = await readAssignmentRows(testDb);
    expect(afterEdit).not.toEqual(afterGenerate);

    const undoResult = await callAction(buildRequest({ intent: "undo" }), "evt_1", asD1(testDb));
    expect(undoResult).toEqual({ ok: true, intent: "undo", droppedCount: 0 });
    expect(await readAssignmentRows(testDb)).toEqual(afterGenerate);

    const redoResult = await callAction(buildRequest({ intent: "redo" }), "evt_1", asD1(testDb));
    expect(redoResult).toEqual({ ok: true, intent: "redo", droppedCount: 0 });
    expect(await readAssignmentRows(testDb)).toEqual(afterEdit);
  });

  it("restore moves directly to an arbitrary earlier seq", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "1" }), "evt_1", asD1(testDb));
    const afterGenerate = await readAssignmentRows(testDb);

    await callAction(
      buildRequest({
        intent: "assign",
        applicationId: "app_x",
        trackId: "trk_1",
        roleId: "reception",
        slotId: ["slot_1"],
      }),
      "evt_1",
      asD1(testDb),
    );

    const result = await callAction(
      buildRequest({ intent: "restore", seq: "1" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "restore", droppedCount: 0 });
    expect(await readAssignmentRows(testDb)).toEqual(afterGenerate);
  });

  it("rejects a malformed restore seq without touching assignments", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "1" }), "evt_1", asD1(testDb));
    const before = await readAssignmentRows(testDb);

    const result = await callAction(
      buildRequest({ intent: "restore", seq: "not-a-number" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ error: "復元先が不正です。", intent: "restore" });
    expect(await readAssignmentRows(testDb)).toEqual(before);
  });

  /**
   * A `seq` that was valid when the page loaded can go stale by the time the
   * request lands (e.g. retention evicted it) — this must return a friendly
   * error, not throw/500, and must not touch `assignments`.
   */
  it("rejects a restore for a seq that no longer exists, without touching assignments", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "1" }), "evt_1", asD1(testDb));
    const before = await readAssignmentRows(testDb);

    const result = await callAction(
      buildRequest({ intent: "restore", seq: "999" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ error: "復元先の履歴が見つかりませんでした。", intent: "restore" });
    expect(await readAssignmentRows(testDb)).toEqual(before);
  });

  it("undo/redo are harmless no-ops (droppedCount 0, unchanged) at the history boundary", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "1" }), "evt_1", asD1(testDb));
    const only = await readAssignmentRows(testDb);

    const undoAtStart = await callAction(buildRequest({ intent: "undo" }), "evt_1", asD1(testDb));
    expect(undoAtStart).toEqual({ ok: true, intent: "undo", droppedCount: 0 });
    expect(await readAssignmentRows(testDb)).toEqual(only);

    const redoAtEnd = await callAction(buildRequest({ intent: "redo" }), "evt_1", asD1(testDb));
    expect(redoAtEnd).toEqual({ ok: true, intent: "redo", droppedCount: 0 });
    expect(await readAssignmentRows(testDb)).toEqual(only);
  });
});

describe("e.$id.s.$sheetId.roster sheet isolation", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedFixture(testDb);
    await seedSiblingAssignment(testDb);
    await testDb
      .prepare(
        "INSERT INTO roster_sheet_roles (roster_sheet_id, role_id) VALUES ('sheet_other', 'reception')",
      )
      .run();
    asOwner();
  });

  it("loads only the selected sibling sheet's schedule and assignments", async () => {
    const result = await callLoader(
      new Request("http://localhost/e/evt_1/s/sheet_other/roster"),
      "evt_1",
      asD1(testDb),
      "sheet_other",
    );

    expect(result.sheet).toMatchObject({ id: "sheet_other", name: "懇親会" });
    expect(result.timeSlots.map((slot) => slot.id)).toEqual(["slot_other"]);
    expect(result.tracks.map((track) => track.id)).toEqual(["track_other"]);
    expect(result.assignmentEntries.map(([key]) => key)).toEqual(["app_o|slot_other"]);
  });

  it("404s when a sheet belongs to another event or is archived", async () => {
    await testDb
      .prepare(
        `INSERT INTO events
          (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token,
           created_at, updated_at)
         VALUES ('evt_2', 1, 'Other event', '2026-11-07', '09:00', '10:00', 1, 'tok2', 'view2', 'now', 'now')`,
      )
      .run();
    await testDb
      .prepare(
        `INSERT INTO roster_sheets
          (id, event_id, name, date, start_time, end_time, seed, created_at, updated_at)
         VALUES ('sheet_foreign', 'evt_2', 'Foreign', '2026-11-07', '09:00', '10:00', 1, 'now', 'now')`,
      )
      .run();
    await testDb
      .prepare("UPDATE roster_sheets SET deleted_at = 'archived' WHERE id = 'sheet_other'")
      .run();

    for (const sheetId of ["sheet_foreign", "sheet_other"]) {
      await expect(
        callLoader(
          new Request(`http://localhost/e/evt_1/s/${sheetId}/roster`),
          "evt_1",
          asD1(testDb),
          sheetId,
        ),
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  it("unassigning a sibling sheet leaves default-sheet assignments untouched", async () => {
    await testDb
      .prepare(
        `INSERT INTO assignments
          (event_id, roster_sheet_id, application_id, time_slot_id, track_id, role_id, locked)
         VALUES ('evt_1', 'default:evt_1', 'app_o', 'slot_0', 'trk_1', 'reception', 0)`,
      )
      .run();

    const result = await callAction(
      buildRequest({ intent: "unassign", applicationId: "app_o", slotId: "slot_other" }),
      "evt_1",
      asD1(testDb),
      "sheet_other",
    );

    expect(result).toEqual({ ok: true, intent: "unassign" });
    const { results } = await testDb
      .prepare(
        "SELECT roster_sheet_id, application_id, time_slot_id FROM assignments ORDER BY roster_sheet_id",
      )
      .all<{ roster_sheet_id: string; application_id: string; time_slot_id: string }>();
    expect(results).toEqual([
      { roster_sheet_id: "default:evt_1", application_id: "app_o", time_slot_id: "slot_0" },
    ]);
  });

  it("uses sibling-sheet seed and manual conflict confirmation without mutating its sibling", async () => {
    const generated = await callAction(
      buildRequest({ intent: "generate", seed: "77" }),
      "evt_1",
      asD1(testDb),
      "sheet_other",
    );
    expect(generated).toMatchObject({ ok: true, intent: "generate", seed: 77 });
    const sheetSeed = await testDb
      .prepare("SELECT seed FROM roster_sheets WHERE id = 'sheet_other'")
      .first<{ seed: number }>();
    const eventSeed = await testDb
      .prepare("SELECT seed FROM events WHERE id = 'evt_1'")
      .first<{ seed: number }>();
    expect(sheetSeed?.seed).toBe(77);
    expect(eventSeed?.seed).toBe(1);

    await testDb.prepare("DELETE FROM assignments WHERE roster_sheet_id = 'sheet_other'").run();
    await testDb
      .prepare(
        `INSERT INTO assignments
          (event_id, roster_sheet_id, application_id, time_slot_id, track_id, role_id, locked)
         VALUES ('evt_1', 'default:evt_1', 'app_x', 'slot_0', 'trk_1', 'reception', 0)`,
      )
      .run();
    await testDb
      .prepare(
        `INSERT INTO demands
          (event_id, roster_sheet_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max)
         VALUES ('evt_1', 'sheet_other', 'slot_other', 'track_other', 'reception', 1, 1, 0, 99)`,
      )
      .run();

    const assignment = {
      intent: "assign",
      applicationId: "app_x",
      trackId: "track_other",
      roleId: "reception",
      slotId: "slot_other",
    };
    const warning = await callAction(
      buildRequest(assignment),
      "evt_1",
      asD1(testDb),
      "sheet_other",
    );
    expect(warning).toMatchObject({ warning: "cross-sheet", intent: "assign" });

    const result = await callAction(
      buildRequest({
        ...assignment,
        conflictConfirmation: (warning as { confirmation: string }).confirmation,
      }),
      "evt_1",
      asD1(testDb),
      "sheet_other",
    );
    expect(result).toEqual({ ok: true, intent: "assign" });
    const { results } = await testDb
      .prepare(
        "SELECT roster_sheet_id, application_id, time_slot_id FROM assignments ORDER BY roster_sheet_id",
      )
      .all<{ roster_sheet_id: string; application_id: string; time_slot_id: string }>();
    expect(results).toEqual([
      { roster_sheet_id: "default:evt_1", application_id: "app_x", time_slot_id: "slot_0" },
      { roster_sheet_id: "sheet_other", application_id: "app_x", time_slot_id: "slot_other" },
    ]);
    const revisions = await testDb
      .prepare("SELECT roster_sheet_id FROM revisions WHERE event_id = 'evt_1'")
      .all<{ roster_sheet_id: string }>();
    expect(revisions.results).toEqual([
      { roster_sheet_id: "sheet_other" },
      { roster_sheet_id: "sheet_other" },
    ]);
  });
});
