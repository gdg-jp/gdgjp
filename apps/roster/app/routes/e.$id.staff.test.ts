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
  fileURLToPath(new URL("../../migrations/0013_event_custom_roles.sql", import.meta.url)),
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

async function seedAdditionalSheetsAndDemand(testDb: TestD1Database) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min, seed, sort_order, created_at, updated_at)
       VALUES
        ('sheet_party', 'evt_1', '懇親会', '2026-11-07', '09:00', '11:00', 60, 2, 1, ?, ?),
        ('sheet_archived', 'evt_1', 'Archived', '2026-11-07', '11:00', '12:00', 60, 3, 2, ?, ?)`,
    )
    .bind(now, now, now, now)
    .run();
  await testDb
    .prepare("UPDATE roster_sheets SET deleted_at = 'archived' WHERE id = 'sheet_archived'")
    .run();
  await testDb
    .prepare(
      `INSERT INTO roster_sheet_roles (roster_sheet_id, role_id)
       VALUES ('sheet_party', 'guide'), ('sheet_archived', 'setup')`,
    )
    .run();
  await testDb
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES
        ('party_slot', 'evt_1', 0, '09:00', '10:00', 'sheet_party'),
        ('archived_slot', 'evt_1', 0, '11:00', '12:00', 'sheet_archived')`,
    )
    .run();
  await testDb
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
       VALUES
        ('track_main', 'evt_1', '本編', '#000000', 1, 0, 'default:evt_1'),
        ('track_party', 'evt_1', '懇親会', '#000000', 1, 0, 'sheet_party')`,
    )
    .run();
  await testDb
    .prepare(
      `INSERT INTO demands
        (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max, roster_sheet_id)
       VALUES
        ('evt_1', 'slot_1', 'track_main', 'reception', 1, 1, 0, 99, 'default:evt_1'),
        ('evt_1', 'party_slot', 'track_party', 'guide', 2, 2, 0, 99, 'sheet_party')`,
    )
    .run();
}

async function seedApplicationAcrossSheets(testDb: TestD1Database, withdrawn = false) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO applications
        (id, event_id, user_id, email, name, withdrawn, created_at, updated_at)
       VALUES ('app_multi', 'evt_1', 'user_multi', 'multi@example.com', 'Multi Staff', ?, ?, ?)`,
    )
    .bind(withdrawn ? 1 : 0, now, now)
    .run();
  await testDb
    .prepare(
      `INSERT INTO application_skills (application_id, role_id, level, pref)
       VALUES ('app_multi', 'reception', 'lead', 1), ('app_multi', 'guide', 'exp', 2),
              ('app_multi', 'setup', 'lead', 1)`,
    )
    .run();
  await testDb
    .prepare(
      `INSERT INTO availabilities (application_id, time_slot_id, value)
       VALUES ('app_multi', 'slot_1', 'o'), ('app_multi', 'party_slot', 'o'),
              ('app_multi', 'archived_slot', 'd')`,
    )
    .run();
}

function mutateBeforeNextBatch(db: TestD1Database, mutation: string): D1Database {
  let added = false;
  const racingDb: TestD1Database = {
    prepare: (sql) => db.prepare(sql),
    async batch(statements) {
      if (!added) {
        added = true;
        await db.prepare(mutation).run();
      }
      return db.batch(statements);
    },
  };
  return asD1(racingDb);
}

function addSlotBeforeNextBatch(db: TestD1Database): D1Database {
  return mutateBeforeNextBatch(
    db,
    `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
     VALUES ('late_party_slot', 'evt_1', 1, '10:00', '11:00', 'sheet_party')`,
  );
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

  it("groups live sheets, roles, staff availability, and supply without crossing event/archive scope", async () => {
    await seedAdditionalSheetsAndDemand(testDb);
    await seedApplicationAcrossSheets(testDb);
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO events
          (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
         VALUES ('evt_2', 1, 'Other Event', '2026-11-08', '09:00', '10:00', 1, 'tok2', 'view2', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await testDb
      .prepare(
        `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
         VALUES ('foreign_app', 'evt_2', 'foreign_user', 'foreign@example.com', 'Foreign', ?, ?)`,
      )
      .bind(now, now)
      .run();

    asOwner();
    const result = await callLoader(
      new Request("http://localhost/e/evt_1/staff"),
      "evt_1",
      asD1(testDb),
    );

    expect(result.roles.map((role) => role.id)).toEqual(["reception", "guide"]);
    expect(result.rosterSheets.map((sheet) => sheet.id)).toEqual(["default:evt_1", "sheet_party"]);
    expect(result.timeSlots.map((slot) => slot.id)).toEqual(["slot_1", "party_slot"]);
    expect(result.staff.map((row) => row.applicationId)).toEqual(["app_multi"]);
    expect(result.staff[0].roles.map((role) => role.roleId)).toEqual(["guide", "reception"]);
    expect(result.staffDetails.app_multi.skills.map((skill) => skill.roleId)).toEqual([
      "guide",
      "reception",
    ]);
    expect(result.staff[0]).toMatchObject({ availableCount: 2, softAvailableCount: 0 });
    expect(result.staffDetails.app_multi.availability).toEqual([
      { timeSlotId: "slot_1", value: "o" },
      { timeSlotId: "party_slot", value: "o" },
    ]);
    expect(result.supplyGroups.map((group) => group.id)).toEqual(["default:evt_1", "sheet_party"]);
    expect(result.supplyGroups.map((group) => group.rows.map((row) => row.slot))).toEqual([
      [{ timeSlotId: "slot_1", need: 1, available: 1, tight: [] }],
      [
        {
          timeSlotId: "party_slot",
          need: 2,
          available: 1,
          tight: [{ roleId: "guide", kind: "head", lack: 1 }],
        },
      ],
    ]);
    expect(JSON.stringify(result)).not.toContain("archived_slot");
    expect(JSON.stringify(result)).not.toContain('"roleId":"setup"');
    expect(JSON.stringify(result)).not.toContain("setup");
    expect(JSON.stringify(result)).not.toContain("foreign_app");
  });

  /**
   * docs/roster/05-staff-supply-demand.md "回帰として固定すべきテスト",
   * exercised end-to-end through the loader: two `exp`-level applicants meet
   * headcount but the slot still needs to surface a lead shortage.
   */
  it("surfaces a lead shortage in grouped supply and summary, excluding withdrawn staff", async () => {
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
    expect(result.supplyGroups).toEqual([
      {
        id: "default:evt_1",
        name: "本編",
        date: "2026-11-07",
        rows: [
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
        ],
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

  it("accepts roles and slots from both live sheets in one proxy registration", async () => {
    await seedAdditionalSheetsAndDemand(testDb);
    const result = await callAction(
      buildRequest({
        intent: "proxyAdd",
        email: "proxy-multi@example.com",
        name: "Proxy Multi",
        contact: "",
        party: "undecided",
        note: "",
        role_guide: "on",
        level_guide: "exp",
        pref_guide: "1",
        avail_slot_1: "d",
        avail_party_slot: "o",
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "proxyAdd" });

    const application = await testDb
      .prepare("SELECT id, user_id FROM applications WHERE email = 'proxy-multi@example.com'")
      .first<{ id: string; user_id: string | null }>();
    expect(application?.user_id).toBeNull();
    const availability = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = ? ORDER BY time_slot_id",
      )
      .bind(application?.id)
      .all();
    expect(availability.results).toEqual([
      { time_slot_id: "party_slot", value: "o" },
      { time_slot_id: "slot_1", value: "d" },
    ]);
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

  it("404s when a valid application ID belongs to a different event", async () => {
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO events
          (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
         VALUES ('evt_2', 1, 'Other Event', '2026-11-08', '09:00', '10:00', 1, 'tok2', 'view2', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await testDb
      .prepare(
        `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
         VALUES ('foreign_app', 'evt_2', 'foreign_user', 'foreign@example.com', 'Foreign', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await expect(
      callAction(
        buildRequest({ intent: "correct", applicationId: "foreign_app", avail_slot_1: "o" }),
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

  it("corrects live skills while preserving archived-role skills and availability", async () => {
    await seedAdditionalSheetsAndDemand(testDb);
    await seedApplicationAcrossSheets(testDb);
    const result = await callAction(
      buildRequest({
        intent: "correct",
        applicationId: "app_multi",
        role_guide: "on",
        level_guide: "lead",
        pref_guide: "1",
        avail_slot_1: "x",
        avail_party_slot: "d",
      }),
      "evt_1",
      asD1(testDb),
    );
    expect(result).toEqual({ ok: true, intent: "correct" });
    const profile = await testDb
      .prepare("SELECT name, contact, party, note FROM applications WHERE id = 'app_multi'")
      .first();
    expect(profile).toEqual({
      name: "Multi Staff",
      contact: null,
      party: "undecided",
      note: null,
    });
    const skills = await testDb
      .prepare(
        "SELECT role_id, level, pref FROM application_skills WHERE application_id = 'app_multi' ORDER BY role_id",
      )
      .all();
    expect(skills.results).toEqual([
      { role_id: "guide", level: "lead", pref: 1 },
      { role_id: "setup", level: "lead", pref: 1 },
    ]);
    const availability = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_multi' ORDER BY time_slot_id",
      )
      .all();
    expect(availability.results).toEqual([
      { time_slot_id: "archived_slot", value: "d" },
      { time_slot_id: "party_slot", value: "d" },
      { time_slot_id: "slot_1", value: "x" },
    ]);
  });

  it("rolls back correction and reactivation when a live sheet gains a slot before the batch", async () => {
    await seedAdditionalSheetsAndDemand(testDb);
    await seedApplicationAcrossSheets(testDb, true);
    const beforeSkills = await testDb
      .prepare(
        "SELECT role_id, level, pref FROM application_skills WHERE application_id = 'app_multi' ORDER BY role_id",
      )
      .all();
    const beforeAvailability = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_multi' ORDER BY time_slot_id",
      )
      .all();
    const result = await callAction(
      buildRequest({
        intent: "correct",
        applicationId: "app_multi",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "x",
        avail_party_slot: "x",
      }),
      "evt_1",
      addSlotBeforeNextBatch(testDb),
    );
    expect(result).toEqual({
      error:
        "シフト表が更新されたため保存できませんでした。画面を再読み込みして、もう一度お試しください。",
      intent: "correct",
    });
    const application = await testDb
      .prepare("SELECT withdrawn, updated_by FROM applications WHERE id = 'app_multi'")
      .first();
    expect(application).toEqual({ withdrawn: 1, updated_by: "self" });
    expect(
      (
        await testDb
          .prepare(
            "SELECT role_id, level, pref FROM application_skills WHERE application_id = 'app_multi' ORDER BY role_id",
          )
          .all()
      ).results,
    ).toEqual(beforeSkills.results);
    expect(
      (
        await testDb
          .prepare(
            "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_multi' ORDER BY time_slot_id",
          )
          .all()
      ).results,
    ).toEqual(beforeAvailability.results);
  });

  it("rolls back owner writes if the existing application identity changes before the batch", async () => {
    await seedAdditionalSheetsAndDemand(testDb);
    await seedApplicationAcrossSheets(testDb);
    const beforeSkills = await testDb
      .prepare(
        "SELECT role_id, level, pref FROM application_skills WHERE application_id = 'app_multi' ORDER BY role_id",
      )
      .all();
    const beforeAvailability = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_multi' ORDER BY time_slot_id",
      )
      .all();
    const result = await callAction(
      buildRequest({
        intent: "correct",
        applicationId: "app_multi",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "x",
        avail_party_slot: "x",
      }),
      "evt_1",
      mutateBeforeNextBatch(
        testDb,
        "UPDATE applications SET email = 'changed@example.com', user_id = 'changed_user' WHERE id = 'app_multi'",
      ),
    );
    expect(result).toEqual({
      error:
        "シフト表が更新されたため保存できませんでした。画面を再読み込みして、もう一度お試しください。",
      intent: "correct",
    });
    const application = await testDb
      .prepare("SELECT name, email, user_id FROM applications WHERE id = 'app_multi'")
      .first();
    expect(application).toEqual({
      name: "Multi Staff",
      email: "changed@example.com",
      user_id: "changed_user",
    });
    expect(
      (
        await testDb
          .prepare(
            "SELECT role_id, level, pref FROM application_skills WHERE application_id = 'app_multi' ORDER BY role_id",
          )
          .all()
      ).results,
    ).toEqual(beforeSkills.results);
    expect(
      (
        await testDb
          .prepare(
            "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_multi' ORDER BY time_slot_id",
          )
          .all()
      ).results,
    ).toEqual(beforeAvailability.results);
  });

  it("does not leave a proxy application or child rows when a live slot races the save", async () => {
    await seedAdditionalSheetsAndDemand(testDb);
    const result = await callAction(
      buildRequest({
        intent: "proxyAdd",
        email: "raced-proxy@example.com",
        name: "Raced Proxy",
        contact: "",
        party: "undecided",
        note: "",
        role_guide: "on",
        avail_slot_1: "o",
        avail_party_slot: "o",
      }),
      "evt_1",
      addSlotBeforeNextBatch(testDb),
    );
    expect(result).toEqual({
      error:
        "シフト表が更新されたため保存できませんでした。画面を再読み込みして、もう一度お試しください。",
      intent: "proxyAdd",
    });
    expect(
      (
        await testDb
          .prepare(
            "SELECT id FROM applications WHERE event_id = 'evt_1' AND email = 'raced-proxy@example.com'",
          )
          .all()
      ).results,
    ).toEqual([]);
    expect(
      (
        await testDb
          .prepare(
            `SELECT count(*) AS count FROM application_skills s
             JOIN applications a ON a.id = s.application_id WHERE a.email = 'raced-proxy@example.com'`,
          )
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
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
