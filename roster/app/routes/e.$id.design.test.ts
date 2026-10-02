import { fileURLToPath } from "node:url";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  requireUserWithChapter: vi.fn(),
}));

import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { slotDataLossOnSlotChange } from "~/features/demand/impact";
import { type TestD1Database, asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import { loader as legacyLoader } from "./e.$id.design";
import { action, loader } from "./e.$id.s.$sheetId.design";

const MIGRATIONS = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
  "0009_time_slots_sheet_uniqueness.sql",
  "0010_revisions_sheet_sequence.sql",
].map((name) => fileURLToPath(new URL(`../../migrations/${name}`, import.meta.url)));

const OWNER: UserChapter = { chapterId: 1, chapterSlug: "tokyo", role: "member" };
const OTHER: UserChapter = { chapterId: 99, chapterSlug: "osaka", role: "member" };

function args(request: Request, db: D1Database, params: { id: string; sheetId?: string }) {
  return {
    request,
    params,
    context: { cloudflare: { env: { DB: db } as unknown as Env } },
    unstable_pattern: "/e/:id/s/:sheetId/design",
    unstable_url: new URL(request.url),
  };
}

function beforeNextBatch(db: TestD1Database, beforeBatch: () => Promise<void>): TestD1Database {
  let injected = false;
  return {
    prepare: (sql) => db.prepare(sql),
    async batch(statements) {
      if (!injected) {
        injected = true;
        await beforeBatch();
      }
      return db.batch(statements);
    },
  };
}

function owner() {
  vi.mocked(requireUserWithChapter).mockResolvedValue({
    user: { id: "owner", email: "owner@example.com", name: "Owner", image: null, isAdmin: false },
    chapter: OWNER,
    chapters: [OWNER],
  });
}

async function seed(db: TestD1Database) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, step_min, seed, apply_token, view_token, created_at, updated_at)
     VALUES ('event-a', 1, 'Event A', '2026-11-07', '09:00', '11:00', 60, 1, 'apply-a', 'view-a', ?, ?),
            ('event-b', 2, 'Event B', '2026-11-08', '10:00', '12:00', 60, 2, 'apply-b', 'view-b', ?, ?)`,
    )
    .bind(now, now, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO roster_sheets
       (id, event_id, name, date, start_time, end_time, step_min, no_solo_newcomer, max_consecutive, seed, visibility, sort_order, created_at, updated_at)
     VALUES ('sheet-a2', 'event-a', 'Parallel', '2026-11-07', '13:00', '15:00', 60, 1, 4, 3, 'private', 1, ?, ?)`,
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
     VALUES ('track-default', 'event-a', 'Default', '#000000', 1, 0, 'default:event-a'),
            ('track-sheet', 'event-a', 'Selected', '#ffffff', 1, 0, 'sheet-a2')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES ('slot-default', 'event-a', 0, '09:00', '10:00', 'default:event-a')`,
    )
    .run();
}

describe("e.$id.design sheet routing", () => {
  let db: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    db = createTestD1(MIGRATIONS);
    await seed(db);
  });

  it("redirects the legacy URL to the live default sheet design URL", async () => {
    owner();
    let redirectResponse: Response | undefined;
    try {
      await legacyLoader(
        args(new Request("http://localhost/e/event-a/design"), asD1(db), {
          id: "event-a",
        }) as Parameters<typeof legacyLoader>[0],
      );
    } catch (error) {
      redirectResponse = error as Response;
    }
    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toBe("/e/event-a/s/default:event-a/design");
  });

  it("requires chapter access and returns 404 for a sheet from another event", async () => {
    owner();
    await expect(
      loader(
        args(new Request("http://localhost/e/event-a/s/default%3Aevent-b/design"), asD1(db), {
          id: "event-a",
          sheetId: "default:event-b",
        }) as Parameters<typeof loader>[0],
      ),
    ).rejects.toMatchObject({ status: 404 });
    vi.mocked(requireUserWithChapter).mockResolvedValue({
      user: { id: "other", email: "other@example.com", name: "Other", image: null, isAdmin: false },
      chapter: OTHER,
      chapters: [OTHER],
    });
    await expect(
      loader(
        args(new Request("http://localhost/e/event-a/s/sheet-a2/design"), asD1(db), {
          id: "event-a",
          sheetId: "sheet-a2",
        }) as Parameters<typeof loader>[0],
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("scopes settings, phase regeneration, and track deletion to the selected sheet", async () => {
    owner();
    const req = (entries: Record<string, string>) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(entries)) form.set(key, value);
      return new Request("http://localhost/e/event-a/s/sheet-a2/design", {
        method: "POST",
        body: form,
      });
    };
    const call = (request: Request) =>
      action(
        args(request, asD1(db), { id: "event-a", sheetId: "sheet-a2" }) as Parameters<
          typeof action
        >[0],
      );

    await call(
      req({
        intent: "updateSettings",
        name: "Parallel updated",
        date: "2026-11-09",
        startTime: "14:00",
        endTime: "16:00",
        stepMin: "60",
        maxConsecutive: "5",
        noSoloNewcomer: "true",
      }),
    );
    await call(req({ intent: "createPhase", name: "Afternoon", from: "14:00", to: "16:00" }));
    await call(req({ intent: "deleteTrack", trackId: "track-sheet" }));

    const selected = await db
      .prepare(
        "SELECT name, date, start_time, end_time, max_consecutive FROM roster_sheets WHERE id = 'sheet-a2'",
      )
      .first<Record<string, unknown>>();
    const sibling = await db
      .prepare(
        "SELECT name, date, start_time, end_time, max_consecutive FROM roster_sheets WHERE id = 'default:event-a'",
      )
      .first<Record<string, unknown>>();
    expect(selected).toMatchObject({
      name: "Parallel updated",
      date: "2026-11-09",
      start_time: "14:00",
      end_time: "16:00",
      max_consecutive: 5,
    });
    expect(sibling).toMatchObject({
      name: "本編",
      date: "2026-11-07",
      start_time: "09:00",
      end_time: "11:00",
      max_consecutive: 4,
    });
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM phases WHERE roster_sheet_id = 'sheet-a2'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM phases WHERE roster_sheet_id = 'default:event-a'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM time_slots WHERE roster_sheet_id = 'sheet-a2'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(2);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM time_slots WHERE id = 'slot-default'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM tracks WHERE id = 'track-default'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM tracks WHERE id = 'track-sheet'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
  });

  it("requires current confirmation before deleting availability-only and assigned slots", async () => {
    owner();
    await db
      .prepare(
        `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
         VALUES ('slot-remove', 'event-a', 0, '13:00', '14:00', 'sheet-a2'),
                ('slot-keep', 'event-a', 1, '14:00', '15:00', 'sheet-a2')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO applications
         (id, event_id, email, name, party, updated_by, created_at, updated_at)
         VALUES ('app-impact', 'event-a', 'staff@example.com', 'Staff', 'yes', 'owner', 'now', 'now')`,
      )
      .run();
    await db
      .prepare("INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, ?, ?)")
      .bind("app-impact", "slot-remove", "o")
      .run();
    await db
      .prepare(
        `INSERT INTO assignments
         (event_id, application_id, time_slot_id, track_id, role_id, roster_sheet_id)
         VALUES ('event-a', 'app-impact', 'slot-remove', 'track-sheet', 'reception', 'sheet-a2')`,
      )
      .run();

    const fields = {
      intent: "updateSettings",
      name: "Parallel updated",
      date: "2026-11-09",
      startTime: "14:00",
      endTime: "16:00",
      stepMin: "60",
      maxConsecutive: "5",
      noSoloNewcomer: "true",
    };
    const req = (entries: Record<string, string>) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(entries)) form.set(key, value);
      return new Request("http://localhost/e/event-a/s/sheet-a2/design", {
        method: "POST",
        body: form,
      });
    };
    const call = (request: Request) =>
      action(
        args(request, asD1(db), { id: "event-a", sheetId: "sheet-a2" }) as Parameters<
          typeof action
        >[0],
      );

    expect(await call(req(fields))).toMatchObject({ error: expect.any(String) });
    expect(
      await db
        .prepare("SELECT start_time FROM roster_sheets WHERE id = 'sheet-a2'")
        .first<{ start_time: string }>(),
    ).toEqual({ start_time: "13:00" });
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM availabilities WHERE time_slot_id = 'slot-remove'",
          )
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);

    const confirmation = slotDataLossOnSlotChange(
      [
        { id: "slot-remove", start: "13:00", end: "14:00" },
        { id: "slot-keep", start: "14:00", end: "15:00" },
      ],
      [
        { start: "14:00", end: "15:00" },
        { start: "15:00", end: "16:00" },
      ],
      [],
      { "slot-remove": 1 },
      { "slot-remove": 1 },
    ).confirmationKey;
    expect(confirmation).toBeTruthy();
    expect(await call(req({ ...fields, slotDataLossConfirmation: confirmation }))).toEqual({
      ok: true,
    });
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM availabilities WHERE time_slot_id = 'slot-remove'",
          )
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM assignments WHERE time_slot_id = 'slot-remove'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM time_slots WHERE id = 'slot-keep'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
  });

  it("rejects a confirmation when slot-dependent rows changed after preview", async () => {
    owner();
    await db
      .prepare(
        `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
         VALUES ('slot-stale-remove', 'event-a', 0, '13:00', '14:00', 'sheet-a2')`,
      )
      .run();
    const staleConfirmation = slotDataLossOnSlotChange(
      [{ id: "slot-stale-remove", start: "13:00", end: "14:00" }],
      [
        { start: "14:00", end: "15:00" },
        { start: "15:00", end: "16:00" },
      ],
      [],
      {},
      {},
    ).confirmationKey;
    await db
      .prepare(
        `INSERT INTO applications
         (id, event_id, email, name, party, updated_by, created_at, updated_at)
         VALUES ('app-stale', 'event-a', 'stale@example.com', 'Staff', 'yes', 'owner', 'now', 'now')`,
      )
      .run();
    await db
      .prepare("INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, ?, ?)")
      .bind("app-stale", "slot-stale-remove", "o")
      .run();
    const fields = {
      intent: "updateSettings",
      name: "Parallel updated",
      date: "2026-11-09",
      startTime: "14:00",
      endTime: "16:00",
      stepMin: "60",
      maxConsecutive: "5",
      slotDataLossConfirmation: staleConfirmation,
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const result = await action(
      args(
        new Request("http://localhost/e/event-a/s/sheet-a2/design", { method: "POST", body: form }),
        asD1(db),
        { id: "event-a", sheetId: "sheet-a2" },
      ) as Parameters<typeof action>[0],
    );
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(
      await db
        .prepare("SELECT start_time FROM roster_sheets WHERE id = 'sheet-a2'")
        .first<{ start_time: string }>(),
    ).toEqual({ start_time: "13:00" });
  });

  it("rolls back settings and slot deletion if availability arrives after impact validation", async () => {
    owner();
    await db
      .prepare(
        `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
         VALUES ('slot-race-remove', 'event-a', 0, '13:00', '14:00', 'sheet-a2'),
                ('slot-race-keep', 'event-a', 1, '14:00', '15:00', 'sheet-a2')`,
      )
      .run();

    const racingDb = beforeNextBatch(db, async () => {
      await db
        .prepare(
          `INSERT INTO applications
           (id, event_id, email, name, party, updated_by, created_at, updated_at)
           VALUES ('app-race', 'event-a', 'race@example.com', 'Staff', 'yes', 'owner', 'now', 'now')`,
        )
        .run();
      await db
        .prepare(
          "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, ?, ?)",
        )
        .bind("app-race", "slot-race-remove", "o")
        .run();
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      intent: "updateSettings",
      name: "Parallel updated",
      date: "2026-11-09",
      startTime: "14:00",
      endTime: "16:00",
      stepMin: "60",
      maxConsecutive: "5",
      noSoloNewcomer: "true",
    })) {
      form.set(key, value);
    }

    const result = await action(
      args(
        new Request("http://localhost/e/event-a/s/sheet-a2/design", { method: "POST", body: form }),
        asD1(racingDb),
        { id: "event-a", sheetId: "sheet-a2" },
      ) as Parameters<typeof action>[0],
    );

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(
      await db
        .prepare("SELECT start_time, end_time FROM roster_sheets WHERE id = 'sheet-a2'")
        .first<{ start_time: string; end_time: string }>(),
    ).toEqual({ start_time: "13:00", end_time: "15:00" });
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM time_slots WHERE id = 'slot-race-remove'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM availabilities WHERE time_slot_id = 'slot-race-remove'",
          )
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
  });

  it("rolls back settings and slot reconciliation if the slot grid changes after validation", async () => {
    owner();
    await db
      .prepare(
        `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
         VALUES ('slot-grid-before-0', 'event-a', 0, '13:00', '14:00', 'sheet-a2'),
                ('slot-grid-before-1', 'event-a', 1, '14:00', '15:00', 'sheet-a2')`,
      )
      .run();

    const racingDb = beforeNextBatch(db, async () => {
      await db
        .prepare(
          `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
           VALUES ('slot-grid-race', 'event-a', 2, '16:00', '17:00', 'sheet-a2')`,
        )
        .run();
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      intent: "updateSettings",
      name: "Parallel updated",
      date: "2026-11-09",
      startTime: "14:00",
      endTime: "16:00",
      stepMin: "60",
      maxConsecutive: "5",
    })) {
      form.set(key, value);
    }

    const result = await action(
      args(
        new Request("http://localhost/e/event-a/s/sheet-a2/design", { method: "POST", body: form }),
        asD1(racingDb),
        { id: "event-a", sheetId: "sheet-a2" },
      ) as Parameters<typeof action>[0],
    );

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(
      await db
        .prepare("SELECT start_time, end_time FROM roster_sheets WHERE id = 'sheet-a2'")
        .first<{ start_time: string; end_time: string }>(),
    ).toEqual({ start_time: "13:00", end_time: "15:00" });
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM time_slots WHERE roster_sheet_id = 'sheet-a2'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(3);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM time_slots WHERE id = 'slot-grid-before-0'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM time_slots WHERE id = 'slot-grid-race'")
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
  });
});
