import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  createTrack,
  deleteTrack,
  listEventRoleIds,
  listRoles,
  listTracks,
  reorderTracks,
  setEventRoles,
  toRole,
  toTrack,
} from "./tracks.server";

const migrations = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
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
  return db;
}

describe("toTrack", () => {
  it("maps snake_case columns to camelCase, converting shared to a boolean", () => {
    expect(
      toTrack({
        id: "trk_1",
        event_id: "evt_1",
        name: "全体",
        color: "#4285f4",
        shared: 1,
        sort_order: 0,
      }),
    ).toEqual({
      id: "trk_1",
      eventId: "evt_1",
      name: "全体",
      color: "#4285f4",
      shared: true,
      sortOrder: 0,
    });
  });

  it("maps shared=0 to false", () => {
    const track = toTrack({
      id: "trk_2",
      event_id: "evt_1",
      name: "Track A",
      color: "#ea4335",
      shared: 0,
      sort_order: 1,
    });
    expect(track.shared).toBe(false);
  });
});

describe("toRole", () => {
  it("maps snake_case columns to camelCase", () => {
    expect(toRole({ id: "reception", name: "受付", sort_order: 1 })).toEqual({
      id: "reception",
      name: "受付",
      sortOrder: 1,
    });
  });
});

describe("sheet-scoped track and role access", () => {
  it("defaults event-only calls to the live default sheet and scopes creates, deletes, and reorders", async () => {
    const db = await makeDb();
    await expect(reorderTracks(db, "evt", [])).resolves.toBeUndefined();
    const main = await createTrack(db, "evt", { name: "Main", color: "#111", shared: true });
    const second = await createTrack(db, "evt", { name: "Second", color: "#222", shared: false });
    const other = await createTrack(
      db,
      "evt",
      { name: "Other sheet", color: "#333", shared: false },
      "sheet:other",
    );

    expect([main.sortOrder, second.sortOrder, other.sortOrder]).toEqual([0, 1, 0]);
    expect((await listTracks(db, "evt")).map((track) => track.id)).toEqual([main.id, second.id]);
    expect((await listTracks(db, "evt", "sheet:other")).map((track) => track.id)).toEqual([
      other.id,
    ]);

    await expect(reorderTracks(db, "evt", [])).rejects.toThrow(
      "Track order must contain every track from the selected roster sheet",
    );
    await expect(reorderTracks(db, "evt", [other.id, main.id])).rejects.toThrow(
      "Track order must contain every track from the selected roster sheet",
    );
    await reorderTracks(db, "evt", [second.id, main.id]);
    expect((await listTracks(db, "evt")).map((track) => track.id)).toEqual([second.id, main.id]);
    expect((await listTracks(db, "evt", "sheet:other"))[0]).toMatchObject({
      id: other.id,
      sortOrder: 0,
    });

    await deleteTrack(db, main.id, "evt");
    expect((await listTracks(db, "evt")).map((track) => track.id)).toEqual([second.id]);
    expect((await listTracks(db, "evt", "sheet:other"))[0].id).toBe(other.id);
  });

  it("replaces role selection only on the chosen sheet and leaves role master/event roles alone", async () => {
    const db = await makeDb();
    await setEventRoles(db, "evt", ["reception"]);
    expect(await listEventRoleIds(db, "evt")).toEqual(["reception"]);
    expect(await listEventRoleIds(db, "evt", "sheet:other")).toEqual([]);
    expect((await listRoles(db)).map((role) => role.id)).toEqual([
      "reception",
      "guide",
      "mc",
      "stream",
      "photo",
      "setup",
    ]);
    expect(
      (await db.prepare("SELECT role_id FROM event_roles WHERE event_id = 'evt'").all()).results,
    ).toEqual([{ role_id: "guide" }]);

    await setEventRoles(db, "evt", ["guide"], "sheet:other");
    expect(await listEventRoleIds(db, "evt")).toEqual(["reception"]);
    expect(await listEventRoleIds(db, "evt", "sheet:other")).toEqual(["guide"]);
  });

  it("rejects an explicit sheet outside the event for reads and writes", async () => {
    const db = await makeDb();
    await expect(listTracks(db, "evt", "missing")).rejects.toThrow(
      "Roster sheet does not belong to this event or is not live",
    );
    await expect(
      createTrack(db, "evt", { name: "Wrong", color: "#000", shared: false }, "missing"),
    ).rejects.toThrow("Roster sheet does not belong to this event or is not live");
    await expect(setEventRoles(db, "evt", ["guide"], "missing")).rejects.toThrow(
      "Roster sheet does not belong to this event or is not live",
    );
  });
});
