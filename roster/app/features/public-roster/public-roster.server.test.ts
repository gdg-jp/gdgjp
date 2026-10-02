import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { EventRecord } from "~/features/events/events.server";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { buildPublicRosterData } from "./public-roster.server";

/**
 * docs/roster/09-share-public-views.md "回帰として固定すべきテスト": this is
 * the single most important server-side test in the whole stage. Every
 * assertion here is either "the returned key set is exactly this" or "no
 * query for this table ever ran" — never "the UI doesn't render it", which
 * ADR-005's own Context explicitly warns is not sufficient (data can leak
 * through the hydration payload without ever being painted on screen).
 */

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

function baseEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "evt_1",
    chapterId: 1,
    name: "DevFest 2026",
    date: "2026-11-07",
    startTime: "09:00",
    endTime: "19:00",
    stepMin: 60,
    tz: "Asia/Tokyo",
    status: "published",
    hasParty: true,
    noSoloNewcomer: true,
    maxConsecutive: 4,
    seed: 1,
    applyToken: "apply-1",
    viewToken: "view-1",
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** Wraps a TestD1Database so tests can assert which SQL text was actually issued. */
function spyOn(db: TestD1Database): { db: D1Database; calls: string[] } {
  const calls: string[] = [];
  const wrapped: TestD1Database = {
    prepare(sql: string) {
      calls.push(sql);
      return db.prepare(sql);
    },
    batch: (statements) => db.batch(statements),
  };
  return { calls, db: asD1(wrapped) };
}

async function seedFullFixture(db: TestD1Database) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES ('evt_1', 1, 'DevFest 2026', '2026-11-07', '09:00', '19:00', 1, 'apply-1', 'view-1', ?, ?)`,
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO tracks (id, event_id, name, color, shared, sort_order) VALUES ('trk_1', 'evt_1', '全体', '#123456', 1, 0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES ('slot_1', 'evt_1', 0, '09:00', '10:00')",
    )
    .run();
  await db
    .prepare("INSERT INTO event_roles (event_id, role_id) VALUES ('evt_1', 'reception')")
    .run();

  // An active applicant with contact/note filled in — proves those fields
  // never make it into the public shape even though they exist in the row.
  await db
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, contact, party, note, withdrawn, created_at, updated_at)
       VALUES ('app_active', 'evt_1', 'user_active', 'active@example.com', 'Active Person', '090-0000-0000', 'yes', 'secret note', 0, ?, ?)`,
    )
    .bind(now, now)
    .run();
  // A withdrawn applicant who still has a residual assignment row — must be
  // excluded entirely, assignment included or not.
  await db
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, party, withdrawn, created_at, updated_at)
       VALUES ('app_withdrawn', 'evt_1', 'user_withdrawn', 'withdrawn@example.com', 'Withdrawn Person', 'no', 1, ?, ?)`,
    )
    .bind(now, now)
    .run();

  await db
    .prepare(
      "INSERT INTO assignments (event_id, application_id, time_slot_id, track_id, role_id, locked) VALUES ('evt_1', 'app_active', 'slot_1', 'trk_1', 'reception', 0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO assignments (event_id, application_id, time_slot_id, track_id, role_id, locked) VALUES ('evt_1', 'app_withdrawn', 'slot_1', 'trk_1', 'reception', 1)",
    )
    .run();
}

describe("buildPublicRosterData", () => {
  let testDb: TestD1Database;

  beforeEach(() => {
    testDb = createTestD1(MIGRATIONS);
  });

  it("returns the exact PublicRosterData key set — no email/contact/note/skills/availability/locked", async () => {
    await seedFullFixture(testDb);
    const result = await buildPublicRosterData(asD1(testDb), baseEvent());

    expect(result.published).toBe(true);
    if (!result.published) throw new Error("expected published");

    expect(Object.keys(result.data).sort()).toEqual(
      ["assignments", "event", "roles", "slots", "staff", "tracks"].sort(),
    );
    expect(Object.keys(result.data.event).sort()).toEqual(
      ["date", "endTime", "hasParty", "name", "startTime"].sort(),
    );
    for (const staff of result.data.staff) {
      expect(Object.keys(staff).sort()).toEqual(["id", "name", "party"].sort());
    }
    for (const slot of result.data.slots) {
      expect(Object.keys(slot).sort()).toEqual(["endTime", "id", "idx", "startTime"].sort());
    }
    for (const track of result.data.tracks) {
      expect(Object.keys(track).sort()).toEqual(["color", "id", "name"].sort());
    }
    for (const role of result.data.roles) {
      expect(Object.keys(role).sort()).toEqual(["id", "name"].sort());
    }
    for (const assignment of result.data.assignments) {
      expect(Object.keys(assignment).sort()).toEqual(
        ["applicationId", "roleId", "timeSlotId", "trackId"].sort(),
      );
    }

    // Belt-and-suspenders: none of the banned substrings appear anywhere in
    // the serialized payload, even inside a value (e.g. an email address).
    const serialized = JSON.stringify(result);
    for (const banned of [
      "email",
      "contact",
      "note",
      "skills",
      "availability",
      "locked",
      "example.com",
      "secret note",
      "090-0000-0000",
    ]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("excludes a withdrawn applicant from staff AND drops their residual assignment row", async () => {
    await seedFullFixture(testDb);
    const result = await buildPublicRosterData(asD1(testDb), baseEvent());
    if (!result.published) throw new Error("expected published");

    expect(result.data.staff.map((s) => s.id)).toEqual(["app_active"]);
    expect(result.data.assignments.map((a) => a.applicationId)).toEqual(["app_active"]);
  });

  it("returns only {published:false, event} for a non-published status, with no `data` key", async () => {
    await seedFullFixture(testDb);
    const result = await buildPublicRosterData(asD1(testDb), baseEvent({ status: "closed" }));

    expect(result.published).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["event", "published"].sort());
    expect("data" in result).toBe(false);
  });

  it("canView gates ASSEMBLY: no query touches applications or assignments when not published", async () => {
    await seedFullFixture(testDb);
    const { db, calls } = spyOn(testDb);
    await buildPublicRosterData(db, baseEvent({ status: "draft" }));

    expect(calls.some((sql) => /FROM applications/i.test(sql))).toBe(false);
    expect(calls.some((sql) => /FROM assignments/i.test(sql))).toBe(false);
    expect(calls.some((sql) => /FROM time_slots/i.test(sql))).toBe(false);
    expect(calls.some((sql) => /FROM tracks/i.test(sql))).toBe(false);
  });

  for (const status of ["draft", "open", "closed", "ended"] as const) {
    it(`treats status "${status}" as not-published`, async () => {
      await seedFullFixture(testDb);
      const result = await buildPublicRosterData(asD1(testDb), baseEvent({ status }));
      expect(result.published).toBe(false);
    });
  }

  it("returns empty arrays (not an error) for a published event with no staff yet", async () => {
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
         VALUES ('evt_1', 1, 'Empty Event', '2026-11-07', '09:00', '19:00', 1, 'apply-1', 'view-1', ?, ?)`,
      )
      .bind(now, now)
      .run();

    const result = await buildPublicRosterData(asD1(testDb), baseEvent());
    if (!result.published) throw new Error("expected published");
    expect(result.data.staff).toEqual([]);
    expect(result.data.assignments).toEqual([]);
    expect(result.data.tracks).toEqual([]);
    expect(result.data.slots).toEqual([]);
  });
});
