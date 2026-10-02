import { fileURLToPath } from "node:url";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  requireUserWithChapter: vi.fn(),
}));

import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { evaluate } from "~/features/solver/evaluate";
import type { SolverInput } from "~/features/solver/types";
import { type TestD1Database, asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import { action, loader } from "./e.$id.roster";

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
    cloudflare: { env: { DB: db } as unknown as Env },
  } as Parameters<typeof loader>[0]["context"];
}

function routeArgs(request: Request, id: string, db: D1Database) {
  return {
    request,
    params: { id },
    context: mockContext(db),
    unstable_pattern: "/e/:id/roster",
    unstable_url: new URL(request.url),
  };
}

function callLoader(request: Request, id: string, db: D1Database) {
  return loader(routeArgs(request, id, db) as Parameters<typeof loader>[0]);
}

function callAction(request: Request, id: string, db: D1Database) {
  return action(routeArgs(request, id, db) as Parameters<typeof action>[0]);
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

function buildRequest(fields: Record<string, string | string[]>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) form.append(key, v);
    else form.set(key, value);
  }
  return new Request("http://localhost/e/evt_1/roster", { method: "POST", body: form });
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

  it("persists a changed seed back to events.seed", async () => {
    await callAction(buildRequest({ intent: "generate", seed: "777" }), "evt_1", asD1(testDb));
    const row = await testDb
      .prepare("SELECT seed FROM events WHERE id = 'evt_1'")
      .first<{ seed: number }>();
    expect(row?.seed).toBe(777);
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
