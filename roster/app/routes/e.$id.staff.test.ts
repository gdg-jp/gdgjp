import { fileURLToPath } from "node:url";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  requireUserWithChapter: vi.fn(),
}));

import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { type TestD1Database, asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import { action, loader } from "./e.$id.staff";

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
    cloudflare: { env: { DB: db, APP_URL: "https://roster.gdgs.jp" } as unknown as Env },
  } as Parameters<typeof loader>[0]["context"];
}

function routeArgs(request: Request, id: string, db: D1Database) {
  return {
    request,
    params: { id },
    context: mockContext(db),
    unstable_pattern: "/e/:id/staff",
    unstable_url: new URL(request.url),
  };
}

function callLoader(request: Request, id: string, db: D1Database) {
  return loader(routeArgs(request, id, db) as Parameters<typeof loader>[0]);
}

function callAction(request: Request, id: string, db: D1Database) {
  return action(routeArgs(request, id, db) as Parameters<typeof action>[0]);
}

async function seedEvent(testDb: TestD1Database) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, has_party, created_at, updated_at)
       VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'tok1', 'view1', 1, ?, ?)`,
    )
    .bind(now, now)
    .run();
  await testDb
    .prepare("INSERT INTO event_roles (event_id, role_id) VALUES ('evt_1', 'reception')")
    .run();
  await testDb
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES ('slot_1', 'evt_1', 0, '09:00', '10:00')",
    )
    .run();
}

function asOwner() {
  vi.mocked(requireUserWithChapter).mockResolvedValue({
    user: { id: "owner_1", email: "owner@example.com", name: "Owner", image: null, isAdmin: false },
    chapter: OWNER_CHAPTER,
    chapters: [OWNER_CHAPTER],
  });
}

describe("e.$id.staff loader", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
  });

  it("404s for an unknown event id", async () => {
    asOwner();
    await expect(
      callLoader(
        new Request("http://localhost/e/no-such-event/staff"),
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
      callLoader(new Request("http://localhost/e/evt_1/staff"), "evt_1", asD1(testDb)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns the apply URL built from apply_token and the event's recruiting roles", async () => {
    asOwner();
    const result = await callLoader(
      new Request("http://localhost/e/evt_1/staff"),
      "evt_1",
      asD1(testDb),
    );
    expect(result.applyUrl).toBe("https://roster.gdgs.jp/apply/tok1");
    expect(result.roles).toEqual([{ id: "reception", name: "受付" }]);
    expect(result.timeSlots).toHaveLength(1);
  });

  it("builds a staff row and drawer detail for each application, resolving role names", async () => {
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
         VALUES ('app_1', 'evt_1', 'user_1', 'a@example.com', 'A', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await testDb
      .prepare(
        "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES ('app_1', 'reception', 'lead', 1)",
      )
      .run();
    await testDb
      .prepare(
        "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES ('app_1', 'slot_1', 'o')",
      )
      .run();

    asOwner();
    const result = await callLoader(
      new Request("http://localhost/e/evt_1/staff"),
      "evt_1",
      asD1(testDb),
    );

    expect(result.staff).toEqual([
      {
        applicationId: "app_1",
        name: "A",
        withdrawn: false,
        roles: [{ roleId: "reception", roleName: "受付", level: "lead", pref: 1 }],
        availableCount: 1,
        softAvailableCount: 0,
        party: "undecided",
        updatedBy: "self",
        updatedAt: now,
      },
    ]);
    expect(result.staffDetails.app_1).toEqual({
      applicationId: "app_1",
      name: "A",
      withdrawn: false,
      skills: [{ roleId: "reception", level: "lead", pref: 1 }],
      availability: [{ timeSlotId: "slot_1", value: "o" }],
    });
  });

  /**
   * docs/roster/05-staff-supply-demand.md "回帰として固定すべきテスト",
   * exercised end-to-end through the loader: two `exp`-level applicants meet
   * headcount but the slot still needs to surface a lead shortage.
   */
  it("surfaces a lead shortage in supplyRows and shortageSummary, and counts registeredCount excluding withdrawals", async () => {
    await testDb
      .prepare(
        "INSERT INTO tracks (id, event_id, name, color, shared, sort_order) VALUES ('trk_1', 'evt_1', '全体', '#000', 1, 0)",
      )
      .run();
    await testDb
      .prepare(
        `INSERT INTO demands (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max)
         VALUES ('evt_1', 'slot_1', 'trk_1', 'reception', 2, 2, 1, 99)`,
      )
      .run();

    const now = new Date().toISOString();
    for (const [id, withdrawn] of [
      ["app_1", 0],
      ["app_2", 0],
      ["app_withdrawn", 1],
    ] as const) {
      await testDb
        .prepare(
          `INSERT INTO applications (id, event_id, user_id, email, name, withdrawn, created_at, updated_at)
           VALUES (?, 'evt_1', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, `user_${id}`, `${id}@example.com`, id, withdrawn, now, now)
        .run();
      await testDb
        .prepare(
          "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES (?, 'reception', 'exp', 2)",
        )
        .bind(id)
        .run();
      await testDb
        .prepare(
          "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, 'slot_1', 'o')",
        )
        .bind(id)
        .run();
    }

    asOwner();
    const result = await callLoader(
      new Request("http://localhost/e/evt_1/staff"),
      "evt_1",
      asD1(testDb),
    );

    expect(result.registeredCount).toBe(2);
    expect(result.supplyRows).toEqual([
      {
        label: "09:00–10:00",
        phaseName: null,
        slot: {
          timeSlotId: "slot_1",
          need: 2,
          available: 2,
          tight: [{ roleId: "reception", kind: "lead", lack: 1 }],
        },
      },
    ]);
    expect(result.shortageSummary).toEqual([{ roleId: "reception", kind: "lead" }]);
  });

  it("canApplyNow reflects the event's status (draft cannot apply)", async () => {
    asOwner();
    const result = await callLoader(
      new Request("http://localhost/e/evt_1/staff"),
      "evt_1",
      asD1(testDb),
    );
    expect(result.event.status).toBe("draft");
    expect(result.canApplyNow).toBe(false);
  });
});

describe("e.$id.staff action (proxy add)", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
    asOwner();
  });

  function buildRequest(fields: Record<string, string>): Request {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("http://localhost/e/evt_1/staff", { method: "POST", body: form });
  }

  it("rejects an unknown intent", async () => {
    const result = await callAction(buildRequest({ intent: "bogus" }), "evt_1", asD1(testDb));
    expect(result).toEqual({ error: "不明な操作です。", intent: "unknown" });
  });

  it("rejects a malformed email", async () => {
    const result = await callAction(
      buildRequest({ intent: "proxyAdd", email: "not-an-email", name: "X" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({
      error: "メールアドレスの形式が正しくありません。",
      intent: "proxyAdd",
    });
  });

  it("creates a new proxy registration with user_id NULL", async () => {
    const result = await callAction(
      buildRequest({
        intent: "proxyAdd",
        email: "proxy@example.com",
        name: "Proxy Person",
        contact: "",
        party: "undecided",
        note: "",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "o",
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "proxyAdd" });

    const row = await testDb
      .prepare("SELECT user_id, email, name, contact, updated_by FROM applications WHERE email = ?")
      .bind("proxy@example.com")
      .first<{
        user_id: string | null;
        email: string;
        name: string;
        contact: string;
        updated_by: string;
      }>();
    expect(row).toEqual({
      user_id: null,
      email: "proxy@example.com",
      name: "Proxy Person",
      contact: "proxy@example.com", // fell back to the email since contact was blank
      updated_by: "owner",
    });
  });

  it("upserts by email — a second proxyAdd for the same address edits that row instead of duplicating it", async () => {
    await callAction(
      buildRequest({
        intent: "proxyAdd",
        email: "proxy@example.com",
        name: "First Name",
        contact: "",
        party: "undecided",
        note: "",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "o",
      }),
      "evt_1",
      asD1(testDb),
    );
    const result = await callAction(
      buildRequest({
        intent: "proxyAdd",
        email: "proxy@example.com",
        name: "Corrected Name",
        contact: "",
        party: "undecided",
        note: "",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "o",
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "proxyAdd" });

    const rows = await testDb
      .prepare("SELECT name FROM applications WHERE email = ?")
      .bind("proxy@example.com")
      .all<{ name: string }>();
    expect(rows.results).toEqual([{ name: "Corrected Name" }]);
  });

  /**
   * ADR-008: proxy-add never overwrites a row's user_id. Editing an
   * already-claimed application by email (owner correcting a self-reported
   * value) must leave the link to that person's account intact.
   */
  it("never touches user_id when upserting an already-claimed application", async () => {
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
         VALUES ('app_claimed', 'evt_1', 'user_real', 'claimed@example.com', 'Self Reported', ?, ?)`,
      )
      .bind(now, now)
      .run();

    await callAction(
      buildRequest({
        intent: "proxyAdd",
        email: "claimed@example.com",
        name: "Owner Corrected",
        contact: "",
        party: "undecided",
        note: "",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "o",
      }),
      "evt_1",
      asD1(testDb),
    );

    const row = await testDb
      .prepare("SELECT user_id, name FROM applications WHERE id = 'app_claimed'")
      .first<{ user_id: string | null; name: string }>();
    expect(row).toEqual({ user_id: "user_real", name: "Owner Corrected" });
  });
});

describe("e.$id.staff action (owner correction)", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
         VALUES ('app_1', 'evt_1', 'user_1', 'a@example.com', 'Self Reported', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await testDb
      .prepare(
        "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES ('app_1', 'reception', 'new', 2)",
      )
      .run();
    asOwner();
  });

  function buildRequest(fields: Record<string, string>): Request {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("http://localhost/e/evt_1/staff", { method: "POST", body: form });
  }

  it("404s when the applicationId doesn't belong to this event", async () => {
    await expect(
      callAction(
        buildRequest({ intent: "correct", applicationId: "no-such-app" }),
        "evt_1",
        asD1(testDb),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  /**
   * docs/roster/05-staff-supply-demand.md "回帰として固定すべきテスト":
   * corrections land as updated_by = owner.
   */
  it("corrects skill level and availability, setting updated_by to owner", async () => {
    const result = await callAction(
      buildRequest({
        intent: "correct",
        applicationId: "app_1",
        role_reception: "on",
        level_reception: "lead",
        pref_reception: "1",
        avail_slot_1: "x",
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "correct" });

    const skill = await testDb
      .prepare("SELECT level, pref FROM application_skills WHERE application_id = 'app_1'")
      .first<{ level: string; pref: number }>();
    expect(skill).toEqual({ level: "lead", pref: 1 });

    const app = await testDb
      .prepare("SELECT updated_by FROM applications WHERE id = 'app_1'")
      .first<{ updated_by: string }>();
    expect(app).toEqual({ updated_by: "owner" });
  });

  it("reactivates a withdrawn application on correct, the same 'save reactivates' rule as /apply/:token", async () => {
    await testDb.prepare("UPDATE applications SET withdrawn = 1 WHERE id = 'app_1'").run();

    await callAction(
      buildRequest({
        intent: "correct",
        applicationId: "app_1",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "o",
      }),
      "evt_1",
      asD1(testDb),
    );

    const app = await testDb
      .prepare("SELECT withdrawn FROM applications WHERE id = 'app_1'")
      .first<{ withdrawn: number }>();
    expect(app?.withdrawn).toBe(0);
  });

  it("withdraws without touching skills, setting updated_by to owner", async () => {
    const result = await callAction(
      buildRequest({ intent: "withdraw", applicationId: "app_1" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "withdraw" });

    const app = await testDb
      .prepare("SELECT withdrawn, updated_by FROM applications WHERE id = 'app_1'")
      .first<{ withdrawn: number; updated_by: string }>();
    expect(app).toEqual({ withdrawn: 1, updated_by: "owner" });

    const skill = await testDb
      .prepare("SELECT level FROM application_skills WHERE application_id = 'app_1'")
      .first<{ level: string }>();
    expect(skill).toEqual({ level: "new" });
  });

  it("403s a chapter that doesn't own the event, even with a valid applicationId", async () => {
    vi.mocked(requireUserWithChapter).mockResolvedValue({
      user: { id: "u2", email: "u2@example.com", name: "U2", image: null, isAdmin: false },
      chapter: OTHER_CHAPTER,
      chapters: [OTHER_CHAPTER],
    });
    await expect(
      callAction(
        buildRequest({ intent: "correct", applicationId: "app_1" }),
        "evt_1",
        asD1(testDb),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("e.$id.staff action (updateStatus)", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedEvent(testDb);
    asOwner();
  });

  function buildRequest(fields: Record<string, string>): Request {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("http://localhost/e/evt_1/staff", { method: "POST", body: form });
  }

  it("rejects an invalid status value", async () => {
    const result = await callAction(
      buildRequest({ intent: "updateStatus", status: "bogus" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ error: "不明なステータスです。", intent: "updateStatus" });
  });

  it("updates the event's status, preserving stepMin/maxConsecutive/noSoloNewcomer", async () => {
    await testDb
      .prepare(
        "UPDATE events SET step_min = 30, max_consecutive = 6, no_solo_newcomer = 0 WHERE id = 'evt_1'",
      )
      .run();

    const result = await callAction(
      buildRequest({ intent: "updateStatus", status: "open" }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "updateStatus" });

    const row = await testDb
      .prepare(
        "SELECT status, step_min, max_consecutive, no_solo_newcomer FROM events WHERE id = 'evt_1'",
      )
      .first<{
        status: string;
        step_min: number;
        max_consecutive: number;
        no_solo_newcomer: number;
      }>();
    expect(row).toEqual({ status: "open", step_min: 30, max_consecutive: 6, no_solo_newcomer: 0 });
  });
});
