import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { getEventByApplyToken, getEventByViewToken, toEvent } from "./events.server";

const ROW = {
  id: "evt_1",
  chapter_id: 42,
  name: "DevFest 2026",
  date: "2026-11-07",
  start_time: "09:00",
  end_time: "19:00",
  step_min: 60,
  tz: "Asia/Tokyo",
  status: "draft",
  has_party: 1,
  no_solo_newcomer: 1,
  max_consecutive: 4,
  seed: 123456,
  apply_token: "a".repeat(40),
  view_token: "b".repeat(40),
  created_by: "user_1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  deleted_at: null,
} as const;

describe("toEvent", () => {
  it("maps snake_case columns to camelCase, converting 0/1 flags to booleans", () => {
    expect(toEvent(ROW)).toEqual({
      id: "evt_1",
      chapterId: 42,
      name: "DevFest 2026",
      date: "2026-11-07",
      startTime: "09:00",
      endTime: "19:00",
      stepMin: 60,
      tz: "Asia/Tokyo",
      status: "draft",
      hasParty: true,
      noSoloNewcomer: true,
      maxConsecutive: 4,
      seed: 123456,
      applyToken: "a".repeat(40),
      viewToken: "b".repeat(40),
      createdBy: "user_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      deletedAt: null,
    });
  });

  it("maps has_party=0 / no_solo_newcomer=0 to false", () => {
    const event = toEvent({ ...ROW, has_party: 0, no_solo_newcomer: 0 });
    expect(event.hasParty).toBe(false);
    expect(event.noSoloNewcomer).toBe(false);
  });

  it("passes through created_by and deleted_at nulls", () => {
    const event = toEvent({ ...ROW, created_by: null, deleted_at: "2026-02-01T00:00:00.000Z" });
    expect(event.createdBy).toBeNull();
    expect(event.deletedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});

/**
 * docs/roster/02-domain-schema.md "回帰として固定すべきテスト": every read
 * of `events` must filter `deleted_at IS NULL`, or a soft-deleted event
 * would resurface in the list / design page. There's no real D1 wired into
 * this workspace's vitest config (see `scheduler/app/lib/db.test.ts` for the
 * same pure-mapper-only convention), so this pins it at the SQL-text level
 * instead: every `SELECT ... FROM events` in this file must include the
 * filter.
 */
describe("deleted_at filtering", () => {
  it("every SELECT FROM events includes `deleted_at IS NULL`", () => {
    const source = readFileSync(new URL("./events.server.ts", import.meta.url), "utf8");
    const selects = source.match(/SELECT[\s\S]*?FROM events[^`]*/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).toMatch(/deleted_at IS NULL/);
    }
  });
});

/**
 * docs/roster/04-applications.md "Design" §5: `/apply/:applyToken` resolves
 * an event by `apply_token` alone, never by id. Real-SQLite (not just the
 * mapper) because getting this lookup wrong either 404s a live registration
 * link or — far worse — would need to leak the event id into the URL.
 */
describe("getEventByApplyToken (real SQLite)", () => {
  const MIGRATIONS = [
    fileURLToPath(new URL("../../../migrations/0002_domain.sql", import.meta.url)),
  ];

  function seedDb() {
    const testDb = createTestD1(MIGRATIONS);
    const now = new Date().toISOString();
    testDb
      .prepare(
        `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at, deleted_at)
         VALUES ('evt_live', 1, 'Live', '2026-11-07', '09:00', '19:00', 1, 'apply-live', 'view-live', ?, ?, NULL)`,
      )
      .bind(now, now)
      .run();
    testDb
      .prepare(
        `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at, deleted_at)
         VALUES ('evt_deleted', 1, 'Deleted', '2026-11-07', '09:00', '19:00', 1, 'apply-deleted', 'view-deleted', ?, ?, ?)`,
      )
      .bind(now, now, now)
      .run();
    return asD1(testDb);
  }

  it("finds the event by its apply_token", async () => {
    const db = seedDb();
    const event = await getEventByApplyToken(db, "apply-live");
    expect(event?.id).toBe("evt_live");
  });

  it("returns null for an unknown token", async () => {
    const db = seedDb();
    expect(await getEventByApplyToken(db, "no-such-token")).toBeNull();
  });

  it("returns null for a soft-deleted event's token", async () => {
    const db = seedDb();
    expect(await getEventByApplyToken(db, "apply-deleted")).toBeNull();
  });
});

/**
 * docs/roster/09-share-public-views.md "Design" §2: `/r/:viewToken` resolves
 * an event by `view_token` alone — same precedent and same real-SQLite
 * justification as `getEventByApplyToken` above, but this is the one public
 * route with zero authentication at all, so getting the lookup wrong is an
 * even more direct data-exposure risk than the apply-token case.
 */
describe("getEventByViewToken (real SQLite)", () => {
  const MIGRATIONS = [
    fileURLToPath(new URL("../../../migrations/0002_domain.sql", import.meta.url)),
  ];

  function seedDb() {
    const testDb = createTestD1(MIGRATIONS);
    const now = new Date().toISOString();
    testDb
      .prepare(
        `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at, deleted_at)
         VALUES ('evt_live', 1, 'Live', '2026-11-07', '09:00', '19:00', 1, 'apply-live', 'view-live', ?, ?, NULL)`,
      )
      .bind(now, now)
      .run();
    testDb
      .prepare(
        `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at, deleted_at)
         VALUES ('evt_deleted', 1, 'Deleted', '2026-11-07', '09:00', '19:00', 1, 'apply-deleted', 'view-deleted', ?, ?, ?)`,
      )
      .bind(now, now, now)
      .run();
    return asD1(testDb);
  }

  it("finds the event by its view_token", async () => {
    const db = seedDb();
    const event = await getEventByViewToken(db, "view-live");
    expect(event?.id).toBe("evt_live");
  });

  it("returns null for an unknown token", async () => {
    const db = seedDb();
    expect(await getEventByViewToken(db, "no-such-token")).toBeNull();
  });

  it("returns null for a soft-deleted event's token", async () => {
    const db = seedDb();
    expect(await getEventByViewToken(db, "view-deleted")).toBeNull();
  });
});
