import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  DemandTargetFailure,
  DemandValidationFailure,
  bulkUpsertDemands,
  demandOrNull,
  getDemand,
  listDemandsForEvent,
  toDemand,
} from "./demand.server";
import type { Demand } from "./types";

const migrations = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
  "0009_time_slots_sheet_uniqueness.sql",
  "0010_revisions_sheet_sequence.sql",
].map((name) => fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)));

async function makeDb() {
  const db = asD1(createTestD1(migrations));
  await db
    .prepare(
      `INSERT INTO events
        (id, chapter_id, name, date, start_time, end_time, step_min, seed,
         apply_token, view_token, created_at, updated_at)
       VALUES ('evt', 1, 'Event', '2026-11-07', '09:00', '11:00', 60, 1,
         'apply', 'view', 'created', 'updated')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min,
         no_solo_newcomer, max_consecutive, seed, visibility, sort_order,
         created_at, updated_at)
       SELECT 'sheet:other', event_id, 'Other', date, start_time, end_time, step_min,
         no_solo_newcomer, max_consecutive, seed, visibility, 1, created_at, updated_at
       FROM roster_sheets WHERE id = 'default:evt'`,
    )
    .run();
  await db.prepare("INSERT INTO event_roles (event_id, role_id) VALUES ('evt', 'guide')").run();
  await db
    .prepare(
      "INSERT INTO roster_sheet_roles (roster_sheet_id, role_id) VALUES ('sheet:other', 'guide')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id) VALUES ('slot:default', 'evt', 0, '09:00', '10:00', 'default:evt'), ('slot:other', 'evt', 0, '09:00', '10:00', 'sheet:other')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id) VALUES ('track:default', 'evt', 'Default', '#fff', 0, 0, 'default:evt'), ('track:other', 'evt', 'Other', '#000', 0, 0, 'sheet:other')",
    )
    .run();
  return db;
}

function demand(timeSlotId: string, trackId: string, overrides: Partial<Demand> = {}): Demand {
  return {
    timeSlotId,
    trackId,
    roleId: "guide",
    min: 1,
    ideal: 2,
    leadMin: 0,
    newMax: 99,
    ...overrides,
  };
}

const ROW = {
  event_id: "evt_1",
  time_slot_id: "slot_1",
  track_id: "trk_1",
  role_id: "reception",
  min_count: 3,
  ideal_count: 4,
  lead_min: 1,
  new_max: 2,
};

describe("toDemand", () => {
  it("maps snake_case columns to the solver-spec field names", () => {
    expect(toDemand(ROW)).toEqual({
      timeSlotId: "slot_1",
      trackId: "trk_1",
      roleId: "reception",
      min: 3,
      ideal: 4,
      leadMin: 1,
      newMax: 2,
    });
  });
});

/**
 * docs/roster/03-demand-input.md "回帰として固定すべきテスト": `ideal = 0`
 * の行と行なしが同じ結果を返す — a missing row and a row that (somehow)
 * still has `ideal_count = 0` must be indistinguishable to every caller.
 */
describe("demandOrNull", () => {
  it("returns null for a missing row", () => {
    expect(demandOrNull(null)).toBeNull();
  });

  it("returns null for a row with ideal_count = 0, the same as a missing row", () => {
    const zeroRow = { ...ROW, min_count: 0, ideal_count: 0, lead_min: 0, new_max: 0 };
    expect(demandOrNull(zeroRow)).toBe(demandOrNull(null));
    expect(demandOrNull(zeroRow)).toBeNull();
  });

  it("returns the mapped Demand for a row with ideal_count > 0", () => {
    expect(demandOrNull(ROW)).toEqual(toDemand(ROW));
  });
});

describe("bulkUpsertDemands", () => {
  it("rejects the whole batch when any entry violates leadMin <= ideal, writing nothing", async () => {
    const batchCalls: unknown[][] = [];
    const fakeDb = {
      batch: async (statements: unknown[]) => {
        batchCalls.push(statements);
        return [];
      },
      prepare: () => {
        throw new Error("prepare should not be reached before validation");
      },
    } as unknown as D1Database;

    const valid = {
      timeSlotId: "s1",
      trackId: "t1",
      roleId: "reception",
      min: 0,
      ideal: 2,
      leadMin: 0,
      newMax: 5,
    };
    const invalid = {
      timeSlotId: "s2",
      trackId: "t1",
      roleId: "guide",
      min: 0,
      ideal: 2,
      leadMin: 3,
      newMax: 5,
    };

    await expect(bulkUpsertDemands(fakeDb, "evt_1", [valid, invalid])).rejects.toBeInstanceOf(
      DemandValidationFailure,
    );
    expect(batchCalls).toEqual([]);
  });

  it("reads and writes only the requested sheet, persisting its sheet id", async () => {
    const db = await makeDb();
    await bulkUpsertDemands(db, "evt", [demand("slot:default", "track:default")]);
    await bulkUpsertDemands(db, "evt", [demand("slot:other", "track:other")], "sheet:other");

    expect(await listDemandsForEvent(db, "evt")).toEqual([demand("slot:default", "track:default")]);
    expect(await listDemandsForEvent(db, "evt", "sheet:other")).toEqual([
      demand("slot:other", "track:other"),
    ]);
    expect(await getDemand(db, "slot:other", "track:other", "guide")).toBeNull();
    expect(await getDemand(db, "slot:other", "track:other", "guide", "sheet:other")).toEqual(
      demand("slot:other", "track:other"),
    );
    const saved = await db
      .prepare("SELECT roster_sheet_id FROM demands WHERE time_slot_id = 'slot:other'")
      .first<{ roster_sheet_id: string }>();
    expect(saved?.roster_sheet_id).toBe("sheet:other");

    await bulkUpsertDemands(
      db,
      "evt",
      [demand("slot:other", "track:other", { min: 0, ideal: 0, leadMin: 0, newMax: 0 })],
      "sheet:other",
    );
    expect(await listDemandsForEvent(db, "evt")).toEqual([demand("slot:default", "track:default")]);
    expect(await listDemandsForEvent(db, "evt", "sheet:other")).toEqual([]);
  });

  it("rejects targets whose slot, track, or selected role is outside the sheet", async () => {
    const db = await makeDb();
    await expect(
      bulkUpsertDemands(db, "evt", [demand("slot:default", "track:other")], "sheet:other"),
    ).rejects.toBeInstanceOf(DemandTargetFailure);
    await expect(
      bulkUpsertDemands(
        db,
        "evt",
        [demand("slot:other", "track:other", { roleId: "reception" })],
        "sheet:other",
      ),
    ).rejects.toBeInstanceOf(DemandTargetFailure);
    expect(await listDemandsForEvent(db, "evt", "sheet:other")).toEqual([]);
  });

  it("rejects a sheet from another event or a deleted sheet", async () => {
    const db = await makeDb();
    await expect(
      bulkUpsertDemands(db, "evt", [demand("slot:other", "track:other")], "not-this-event"),
    ).rejects.toThrow("Roster sheet does not belong to this event or is not live");
  });

  it("no-ops without touching the database for an empty input list", async () => {
    let batched = false;
    const fakeDb = {
      batch: async () => {
        batched = true;
        return [];
      },
    } as unknown as D1Database;
    await bulkUpsertDemands(fakeDb, "evt_1", []);
    expect(batched).toBe(false);
  });
});

/**
 * There's no real D1 wired into this workspace's vitest config (see
 * `events.server.test.ts`'s identical note), so `listDemandsForEvent`'s
 * bulk-read filter is pinned at the SQL-text level. `getDemand`'s
 * single-row SELECT is exempt here because it collapses `ideal_count <= 0`
 * to `null` via `demandOrNull` instead (covered above) — either mechanism
 * satisfies "ideal = 0 の行と行なしが同じ結果を返す".
 */
describe("ideal_count filtering", () => {
  it("listDemandsForEvent's SELECT includes `ideal_count > 0`", () => {
    const source = readFileSync(new URL("./demand.server.ts", import.meta.url), "utf8");
    expect(source).toMatch(
      /FROM demands\s+WHERE event_id = \? AND roster_sheet_id = \? AND ideal_count > 0/,
    );
  });
});
