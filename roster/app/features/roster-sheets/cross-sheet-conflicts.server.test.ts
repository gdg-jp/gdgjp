import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { listCrossSheetAssignmentConflicts } from "./cross-sheet-conflicts.server";

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

function makeDb() {
  const db = createTestD1(migrations);
  db.prepare(
    `INSERT INTO events
      (id, chapter_id, name, date, start_time, end_time, step_min, seed,
       apply_token, view_token, created_at, updated_at)
     VALUES (?, 1, 'Event', '2026-11-07', '09:00', '18:00', 30, 42, ?, ?, 'created', 'updated')`,
  )
    .bind("event-a", "apply-a", "view-a")
    .run();
  db.prepare(
    `INSERT INTO events
      (id, chapter_id, name, date, start_time, end_time, step_min, seed,
       apply_token, view_token, created_at, updated_at)
     VALUES ('event-b', 1, 'Other event', '2026-11-07', '09:00', '18:00', 30, 42,
       'apply-b', 'view-b', 'created', 'updated')`,
  ).run();
  return db;
}

function addSheet(db: ReturnType<typeof makeDb>, id: string, name: string, date = "2026-11-07") {
  db.prepare(
    `INSERT INTO roster_sheets
      (id, event_id, name, date, start_time, end_time, step_min, seed, created_at, updated_at)
     VALUES (?, 'event-a', ?, ?, '09:00', '18:00', 30, 42, 'created', 'updated')`,
  )
    .bind(id, name, date)
    .run();
}

function addStaff(db: ReturnType<typeof makeDb>, id: string, name = id, withdrawn = 0) {
  db.prepare(
    `INSERT INTO applications (id, event_id, email, name, withdrawn, created_at, updated_at)
     VALUES (?, 'event-a', ?, ?, ?, 'created', 'updated')`,
  )
    .bind(id, `${id}@example.com`, name, withdrawn)
    .run();
}

function addAssignment(
  db: ReturnType<typeof makeDb>,
  input: {
    applicationId: string;
    sheetId: string;
    slotId: string;
    start: string;
    end: string;
    eventId?: string;
  },
) {
  const eventId = input.eventId ?? "event-a";
  const trackId = `track:${input.sheetId}`;
  db.prepare(
    `INSERT OR IGNORE INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
     VALUES (?, ?, 'Hall', '#fff', 0, 0, ?)`,
  )
    .bind(trackId, eventId, input.sheetId)
    .run();
  db.prepare(
    `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
     VALUES (?, ?,
       (SELECT COALESCE(MAX(idx), -1) + 1 FROM time_slots WHERE roster_sheet_id = ?),
       ?, ?, ?)`,
  )
    .bind(input.slotId, eventId, input.sheetId, input.start, input.end, input.sheetId)
    .run();
  db.prepare(
    `INSERT INTO assignments
      (event_id, application_id, time_slot_id, track_id, role_id, roster_sheet_id)
     VALUES (?, ?, ?, ?, 'reception', ?)`,
  )
    .bind(eventId, input.applicationId, input.slotId, trackId, input.sheetId)
    .run();
}

describe("cross-sheet assignment conflicts", () => {
  it("finds same-day overlapping assignments and returns useful details", async () => {
    const db = makeDb();
    addSheet(db, "sheet-other", "Second venue");
    addStaff(db, "staff-1", "Aki");
    addAssignment(db, {
      applicationId: "staff-1",
      sheetId: "default:event-a",
      slotId: "target-slot",
      start: "10:00",
      end: "10:30",
    });
    addAssignment(db, {
      applicationId: "staff-1",
      sheetId: "sheet-other",
      slotId: "other-slot",
      start: "10:15",
      end: "10:45",
    });

    await expect(
      listCrossSheetAssignmentConflicts(asD1(db), "event-a", "default:event-a"),
    ).resolves.toEqual([
      {
        application: { id: "staff-1", name: "Aki" },
        target: {
          sheetId: "default:event-a",
          slotId: "target-slot",
          startTime: "10:00",
          endTime: "10:30",
          trackId: "track:default:event-a",
          roleId: "reception",
        },
        other: {
          sheetId: "sheet-other",
          sheetName: "Second venue",
          sheetDate: "2026-11-07",
          slotId: "other-slot",
          startTime: "10:15",
          endTime: "10:45",
          trackId: "track:sheet-other",
          roleId: "reception",
        },
      },
    ]);
  });

  it("treats adjacent endpoints as non-conflicting", async () => {
    const db = makeDb();
    addSheet(db, "sheet-other", "Second venue");
    addStaff(db, "staff-1");
    addAssignment(db, {
      applicationId: "staff-1",
      sheetId: "default:event-a",
      slotId: "target-slot",
      start: "10:00",
      end: "10:30",
    });
    addAssignment(db, {
      applicationId: "staff-1",
      sheetId: "sheet-other",
      slotId: "other-slot",
      start: "10:30",
      end: "11:00",
    });

    await expect(
      listCrossSheetAssignmentConflicts(asD1(db), "event-a", "default:event-a"),
    ).resolves.toEqual([]);
  });

  it("does not compare overlapping slots on different dates", async () => {
    const db = makeDb();
    addSheet(db, "sheet-other", "Next day", "2026-11-08");
    addStaff(db, "staff-1");
    addAssignment(db, {
      applicationId: "staff-1",
      sheetId: "default:event-a",
      slotId: "target-slot",
      start: "10:00",
      end: "10:30",
    });
    addAssignment(db, {
      applicationId: "staff-1",
      sheetId: "sheet-other",
      slotId: "other-slot",
      start: "10:15",
      end: "10:45",
    });

    await expect(
      listCrossSheetAssignmentConflicts(asD1(db), "event-a", "default:event-a"),
    ).resolves.toEqual([]);
  });

  it("includes sibling sheets but excludes other events and archived sheets", async () => {
    const db = makeDb();
    addSheet(db, "sibling", "Sibling");
    addSheet(db, "archived", "Archived");
    db.prepare("UPDATE roster_sheets SET deleted_at = 'archived' WHERE id = 'archived'").run();
    db.prepare(
      `INSERT INTO applications (id, event_id, email, name, created_at, updated_at)
       VALUES ('staff-b', 'event-b', 'staff-b@example.com', 'B', 'created', 'updated')`,
    ).run();
    addStaff(db, "staff-a", "A");
    addAssignment(db, {
      applicationId: "staff-a",
      sheetId: "default:event-a",
      slotId: "target-slot",
      start: "10:00",
      end: "10:30",
    });
    addAssignment(db, {
      applicationId: "staff-a",
      sheetId: "sibling",
      slotId: "sibling-slot",
      start: "10:15",
      end: "10:45",
    });
    addAssignment(db, {
      applicationId: "staff-a",
      sheetId: "archived",
      slotId: "archived-slot",
      start: "10:15",
      end: "10:45",
    });
    addAssignment(db, {
      applicationId: "staff-b",
      sheetId: "default:event-b",
      slotId: "event-b-slot",
      start: "10:15",
      end: "10:45",
      eventId: "event-b",
    });

    const conflicts = await listCrossSheetAssignmentConflicts(
      asD1(db),
      "event-a",
      "default:event-a",
    );
    expect(conflicts.map((conflict) => conflict.other.sheetId)).toEqual(["sibling"]);
  });

  it("omits withdrawn applicants and returns multiple results in stable order", async () => {
    const db = makeDb();
    addSheet(db, "sheet-a", "Alpha");
    addSheet(db, "sheet-z", "Zulu");
    addStaff(db, "withdrawn", "Withdrawn", 1);
    addStaff(db, "staff-z", "Zed");
    addStaff(db, "staff-a", "Ari");
    for (const [applicationId, prefix] of [
      ["withdrawn", "withdrawn"],
      ["staff-z", "z"],
      ["staff-a", "a"],
    ]) {
      addAssignment(db, {
        applicationId,
        sheetId: "default:event-a",
        slotId: `target-${prefix}`,
        start: "10:00",
        end: "10:30",
      });
    }
    for (const [applicationId, prefix] of [
      ["withdrawn", "withdrawn"],
      ["staff-z", "z"],
      ["staff-a", "a"],
    ]) {
      addAssignment(db, {
        applicationId,
        sheetId: "sheet-z",
        slotId: `other-z-${prefix}`,
        start: "10:15",
        end: "10:45",
      });
      addAssignment(db, {
        applicationId,
        sheetId: "sheet-a",
        slotId: `other-a-${prefix}`,
        start: "10:15",
        end: "10:45",
      });
    }

    const conflicts = await listCrossSheetAssignmentConflicts(
      asD1(db),
      "event-a",
      "default:event-a",
    );
    expect(
      conflicts.map((conflict) => [conflict.application.name, conflict.other.sheetId]),
    ).toEqual([
      ["Ari", "sheet-a"],
      ["Ari", "sheet-z"],
      ["Zed", "sheet-a"],
      ["Zed", "sheet-z"],
    ]);
  });

  it("requires the target sheet to be live and belong to the requested event", async () => {
    const db = makeDb();
    await expect(listCrossSheetAssignmentConflicts(asD1(db), "event-a", "missing")).rejects.toThrow(
      "Roster sheet not found for this event.",
    );
    await expect(
      listCrossSheetAssignmentConflicts(asD1(db), "event-a", "default:event-b"),
    ).rejects.toThrow("Roster sheet not found for this event.");
    db.prepare(
      "UPDATE roster_sheets SET deleted_at = 'archived' WHERE id = 'default:event-a'",
    ).run();
    await expect(
      listCrossSheetAssignmentConflicts(asD1(db), "event-a", "default:event-a"),
    ).rejects.toThrow("Roster sheet not found for this event.");
  });
});
