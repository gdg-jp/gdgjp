import { fileURLToPath } from "node:url";
import type { AuthUser } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  getOptionalUser: vi.fn(),
  buildSignInRedirect: vi.fn(),
}));

import { buildSignInRedirect, getOptionalUser } from "~/features/auth/auth-redirect.server";
import { type TestD1Database, asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import { action, loader } from "./apply.$token";

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

const SELF: AuthUser = {
  id: "user_self",
  email: "self@example.com",
  name: "Self Person",
  image: null,
  isAdmin: false,
};

const OTHER_EMAIL = "other-applicant@example.com";
const OTHER_NAME = "Other Stranger";
const OTHER_CONTACT = "other-secret-contact@example.com";
const RETRY_ERROR =
  "シフト表が更新されたため保存できませんでした。画面を再読み込みして、もう一度お試しください。";

function mockContext(db: D1Database) {
  return { cloudflare: { env: { DB: db } as unknown as Env } } as Parameters<
    typeof loader
  >[0]["context"];
}

/** Builds the full `Route.LoaderArgs`/`Route.ActionArgs` shape react-router 7 requires. */
function routeArgs(request: Request, token: string, db: D1Database) {
  return {
    request,
    params: { token },
    context: mockContext(db),
    unstable_pattern: "/apply/:token",
    unstable_url: new URL(request.url),
  };
}

function callLoader(request: Request, token: string, db: D1Database) {
  return loader(routeArgs(request, token, db) as Parameters<typeof loader>[0]);
}

function callAction(request: Request, token: string, db: D1Database) {
  return action(routeArgs(request, token, db) as Parameters<typeof action>[0]);
}

function addSlotBeforeNextBatch(db: TestD1Database): D1Database {
  let added = false;
  const racingDb: TestD1Database = {
    prepare: (sql) => db.prepare(sql),
    async batch(statements) {
      if (!added) {
        added = true;
        await db
          .prepare(
            `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
             VALUES ('late_slot', 'evt_1', 2, '11:00', '12:00', 'default:evt_1')`,
          )
          .run();
      }
      return db.batch(statements);
    },
  };
  return asD1(racingDb);
}

/**
 * Seeds an `open` event with roles and slots across two live sheets, one
 * archived sheet, and a second isolated event. It also creates two
 * applications: one belonging to `SELF` (matched by user_id) and one
 * belonging to a different person entirely ("other"), each with its own
 * skills and availability. Every PII-leakage assertion in this file checks
 * that the "other" strings never appear in what the public route returns.
 */
async function seedEventWithTwoApplicants(testDb: TestD1Database, overrides?: { status?: string }) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, status, has_party, created_at, updated_at)
       VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'tok1', 'view1', ?, 1, ?, ?)`,
    )
    .bind(overrides?.status ?? "open", now, now)
    .run();
  await testDb
    .prepare(
      "INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at) VALUES ('evt_2', 1, 'Other Event', '2026-11-08', '09:00', '10:00', 1, 'tok2', 'view2', ?, ?)",
    )
    .bind(now, now)
    .run();
  await testDb
    .prepare(
      "INSERT INTO event_roles (event_id, role_id) VALUES ('evt_1', 'reception'), ('evt_2', 'photo')",
    )
    .run();
  await testDb
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min, seed, sort_order, created_at, updated_at)
       VALUES
         ('sheet_workshop', 'evt_1', 'ワークショップ', '2026-11-07', '12:00', '14:00', 60, 3, 5, ?, ?),
         ('sheet_archived', 'evt_1', 'アーカイブ済み', '2026-11-07', '14:00', '15:00', 60, 4, 6, ?, ?)`,
    )
    .bind(now, now, now, now)
    .run();
  await testDb
    .prepare("UPDATE roster_sheets SET deleted_at = 'archived' WHERE id = 'sheet_archived'")
    .run();
  await testDb
    .prepare(
      `INSERT INTO roster_sheet_roles (roster_sheet_id, role_id)
       VALUES ('sheet_workshop', 'guide'), ('sheet_archived', 'setup')`,
    )
    .run();
  await testDb
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES
         ('slot_1', 'evt_1', 0, '09:00', '10:00', 'default:evt_1'),
         ('slot_2', 'evt_1', 1, '10:00', '11:00', 'default:evt_1'),
         ('workshop_slot', 'evt_1', 0, '12:00', '13:00', 'sheet_workshop'),
         ('archived_slot', 'evt_1', 0, '14:00', '15:00', 'sheet_archived'),
         ('other_event_slot', 'evt_2', 0, '09:00', '10:00', 'default:evt_2')`,
    )
    .run();

  await testDb
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, contact, created_at, updated_at)
       VALUES ('app_self', 'evt_1', ?, ?, ?, 'self-contact@example.com', ?, ?)`,
    )
    .bind(SELF.id, SELF.email, SELF.name, now, now)
    .run();
  await testDb
    .prepare(
      "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES ('app_self', 'reception', 'lead', 1)",
    )
    .run();
  await testDb
    .prepare(
      "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES ('app_self', 'slot_1', 'o')",
    )
    .run();
  await testDb
    .prepare(
      "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES ('app_self', 'workshop_slot', 'x'), ('app_self', 'archived_slot', 'd')",
    )
    .run();

  await testDb
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, contact, created_at, updated_at)
       VALUES ('app_other', 'evt_1', 'user_other', ?, ?, ?, ?, ?)`,
    )
    .bind(OTHER_EMAIL, OTHER_NAME, OTHER_CONTACT, now, now)
    .run();
  await testDb
    .prepare(
      "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES ('app_other', 'guide', 'new', 2)",
    )
    .run();
  await testDb
    .prepare(
      "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES ('app_other', 'slot_2', 'x')",
    )
    .run();
}

describe("apply.$token loader", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(getOptionalUser).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedEventWithTwoApplicants(testDb);
  });

  it("404s for an unknown token", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const request = new Request("http://localhost/apply/no-such-token");
    await expect(callLoader(request, "no-such-token", asD1(testDb))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("shows the event overview and recruiting roles, with no application data, when unauthenticated", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const request = new Request("http://localhost/apply/tok1");
    const result = await callLoader(request, "tok1", asD1(testDb));

    expect(result.viewer).toBeNull();
    expect(result.own).toBeNull();
    expect(result.canApplyNow).toBe(true);
    expect(result.roles.map((r) => r.id).sort()).toEqual(["guide", "reception"]);
    expect(result.rosterSheets.map((sheet) => sheet.id)).toEqual([
      "default:evt_1",
      "sheet_workshop",
    ]);
    expect(result.rosterSheets).toMatchObject([
      { id: "default:evt_1", name: "本編", timeSlots: [{ id: "slot_1" }, { id: "slot_2" }] },
      { id: "sheet_workshop", name: "ワークショップ", timeSlots: [{ id: "workshop_slot" }] },
    ]);
    expect(result.rosterSheets.flatMap((sheet) => sheet.timeSlots).map((slot) => slot.id)).toEqual([
      "slot_1",
      "slot_2",
      "workshop_slot",
    ]);
    expect(result.roles.map((role) => role.id)).toEqual(["reception", "guide"]);
    expect(JSON.stringify(result)).not.toContain("sheet_archived");
    expect(JSON.stringify(result)).not.toContain("archived_slot");
    expect(JSON.stringify(result)).not.toContain("other_event_slot");
    expect(JSON.stringify(result)).not.toContain("photo");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(OTHER_EMAIL);
    expect(serialized).not.toContain(OTHER_NAME);
    expect(serialized).not.toContain(SELF.email);
  });

  /**
   * The highest-consequence regression class for this stage
   * (docs/roster/04-applications.md "回帰として固定すべきテスト"): the
   * public loader must return only the viewer's own application, never
   * another applicant's name/email/contact/skills/availability.
   */
  it("returns only the viewer's own application — never another applicant's PII", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    const request = new Request("http://localhost/apply/tok1");
    const result = await callLoader(request, "tok1", asD1(testDb));

    expect(Object.keys(result).sort()).toEqual(
      ["canApplyNow", "event", "own", "roles", "rosterSheets", "signInHref", "viewer"].sort(),
    );

    expect(result.own).toEqual({
      name: SELF.name,
      contact: "self-contact@example.com",
      party: "undecided",
      note: "",
      withdrawn: false,
      skills: [{ roleId: "reception", level: "lead", pref: 1 }],
      availability: [
        { timeSlotId: "slot_1", value: "o" },
        { timeSlotId: "workshop_slot", value: "x" },
      ],
    });

    // result.own.skills above already exact-matches [{roleId: "reception", ...}]
    // (not "guide", the other applicant's role) — this is the string-level
    // cross-check for name/email/contact, which toEqual can't express as cleanly.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(OTHER_EMAIL);
    expect(serialized).not.toContain(OTHER_NAME);
    expect(serialized).not.toContain(OTHER_CONTACT);
  });

  it("shows the closed message (not 404) once the event stops accepting applications", async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedEventWithTwoApplicants(testDb, { status: "closed" });
    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    const request = new Request("http://localhost/apply/tok1");
    const result = await callLoader(request, "tok1", asD1(testDb));
    expect(result.canApplyNow).toBe(false);
  });

  it("auto-claims a proxy registration matching the viewer's email on load", async () => {
    testDb = createTestD1(MIGRATIONS);
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, status, created_at, updated_at)
         VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'tok1', 'view1', 'open', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await testDb
      .prepare(
        `INSERT INTO applications (id, event_id, user_id, email, name, updated_by, created_at, updated_at)
         VALUES ('app_proxy', 'evt_1', NULL, ?, 'Proxy Name', 'owner', ?, ?)`,
      )
      .bind(SELF.email, now, now)
      .run();

    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    const request = new Request("http://localhost/apply/tok1");
    const result = await callLoader(request, "tok1", asD1(testDb));

    expect(result.own?.name).toBe("Proxy Name");
    const row = await testDb
      .prepare("SELECT user_id FROM applications WHERE id = ?")
      .bind("app_proxy")
      .first<{
        user_id: string | null;
      }>();
    expect(row?.user_id).toBe(SELF.id);
  });
});

describe("apply.$token action", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(getOptionalUser).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await seedEventWithTwoApplicants(testDb);
  });

  function buildRequest(fields: Record<string, string>): Request {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("http://localhost/apply/tok1", { method: "POST", body: form });
  }

  it("redirects to sign-in when the viewer is unauthenticated", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    const redirectResponse = new Response(null, { status: 302 });
    vi.mocked(buildSignInRedirect).mockReturnValue(redirectResponse);
    await expect(
      callAction(buildRequest({ intent: "save", name: "X" }), "tok1", asD1(testDb)),
    ).rejects.toBe(redirectResponse);
  });

  it("updates only the viewer's own application, leaving the other applicant untouched", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    const request = buildRequest({
      intent: "save",
      name: "Self Updated Name",
      contact: "",
      party: "undecided",
      note: "",
      role_reception: "on",
      level_reception: "exp",
      pref_reception: "2",
      role_guide: "on",
      level_guide: "new",
      pref_guide: "2",
      avail_slot_1: "o",
      avail_slot_2: "x",
      avail_workshop_slot: "d",
      // An event-two slot cannot enter this token's apply write.
      avail_other_event_slot: "o",
    });
    const result = await callAction(request, "tok1", asD1(testDb));
    expect(result).toEqual({ ok: true });

    const self = await testDb
      .prepare("SELECT name FROM applications WHERE id = 'app_self'")
      .first<{ name: string }>();
    expect(self?.name).toBe("Self Updated Name");
    const selfAvailability = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_self' ORDER BY time_slot_id",
      )
      .all<{ time_slot_id: string; value: string }>();
    expect(selfAvailability.results).toEqual([
      { time_slot_id: "archived_slot", value: "d" },
      { time_slot_id: "slot_1", value: "o" },
      { time_slot_id: "slot_2", value: "x" },
      { time_slot_id: "workshop_slot", value: "d" },
    ]);

    const other = await testDb
      .prepare("SELECT name, contact FROM applications WHERE id = 'app_other'")
      .first<{ name: string; contact: string }>();
    expect(other).toEqual({ name: OTHER_NAME, contact: OTHER_CONTACT });
    const otherAvailability = await testDb
      .prepare("SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_other'")
      .all<{ time_slot_id: string; value: string }>();
    expect(otherAvailability.results).toEqual([{ time_slot_id: "slot_2", value: "x" }]);
  });

  it("requires a value for every live sheet slot before changing the application", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    const result = await callAction(
      buildRequest({
        intent: "save",
        name: "Should Not Save",
        contact: "",
        party: "undecided",
        note: "",
        role_reception: "on",
        avail_slot_1: "o",
        avail_slot_2: "x",
        // The active workshop_slot value is deliberately omitted.
      }),
      "tok1",
      asD1(testDb),
    );
    expect(result).toEqual({ error: "すべての時間枠について稼働可否を入力してください。" });
    const self = await testDb
      .prepare("SELECT name FROM applications WHERE id = 'app_self'")
      .first<{ name: string }>();
    expect(self?.name).toBe(SELF.name);
    const availability = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_self' ORDER BY time_slot_id",
      )
      .all<{ time_slot_id: string; value: string }>();
    expect(availability.results).toEqual([
      { time_slot_id: "archived_slot", value: "d" },
      { time_slot_id: "slot_1", value: "o" },
      { time_slot_id: "workshop_slot", value: "x" },
    ]);
  });

  it("rolls back profile reactivation, skills, and availability if a live slot appears before save", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    await testDb.prepare("UPDATE applications SET withdrawn = 1 WHERE id = 'app_self'").run();
    const result = await callAction(
      buildRequest({
        intent: "save",
        name: "Should Roll Back",
        contact: "new-contact@example.com",
        party: "yes",
        note: "new note",
        role_guide: "on",
        level_guide: "exp",
        pref_guide: "1",
        avail_slot_1: "x",
        avail_slot_2: "d",
        avail_workshop_slot: "o",
      }),
      "tok1",
      addSlotBeforeNextBatch(testDb),
    );
    expect(result).toEqual({ error: RETRY_ERROR });

    const self = await testDb
      .prepare(
        "SELECT name, contact, party, note, withdrawn FROM applications WHERE id = 'app_self'",
      )
      .first();
    expect(self).toEqual({
      name: SELF.name,
      contact: "self-contact@example.com",
      party: "undecided",
      note: null,
      withdrawn: 1,
    });
    const skills = await testDb
      .prepare(
        "SELECT role_id, level, pref FROM application_skills WHERE application_id = 'app_self'",
      )
      .all();
    expect(skills.results).toEqual([{ role_id: "reception", level: "lead", pref: 1 }]);
    const availability = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app_self' ORDER BY time_slot_id",
      )
      .all();
    expect(availability.results).toEqual([
      { time_slot_id: "archived_slot", value: "d" },
      { time_slot_id: "slot_1", value: "o" },
      { time_slot_id: "workshop_slot", value: "x" },
    ]);
  });

  it("does not leave a new application or child rows when a live slot races registration", async () => {
    const newViewer: AuthUser = {
      id: "user_new",
      email: "new@example.com",
      name: "New Person",
      image: null,
      isAdmin: false,
    };
    vi.mocked(getOptionalUser).mockResolvedValue(newViewer);
    const before = await testDb
      .prepare("SELECT (SELECT count(*) FROM applications) AS applications")
      .first<{ applications: number }>();
    const result = await callAction(
      buildRequest({
        intent: "save",
        name: "New Application",
        contact: "",
        party: "undecided",
        note: "",
        role_reception: "on",
        level_reception: "new",
        pref_reception: "2",
        avail_slot_1: "o",
        avail_slot_2: "x",
        avail_workshop_slot: "d",
      }),
      "tok1",
      addSlotBeforeNextBatch(testDb),
    );
    expect(result).toEqual({ error: RETRY_ERROR });

    const after = await testDb
      .prepare("SELECT (SELECT count(*) FROM applications) AS applications")
      .first<{ applications: number }>();
    expect(after?.applications).toBe(before?.applications);
    const byIdentity = await testDb
      .prepare("SELECT id FROM applications WHERE event_id = 'evt_1' AND user_id = ?")
      .bind(newViewer.id)
      .all();
    expect(byIdentity.results).toEqual([]);
    const childRows = await testDb
      .prepare(
        `SELECT (SELECT count(*) FROM application_skills s JOIN applications a ON a.id = s.application_id WHERE a.user_id = ?) AS skills,
          (SELECT count(*) FROM availabilities av JOIN applications a ON a.id = av.application_id WHERE a.user_id = ?) AS availability`,
      )
      .bind(newViewer.id, newViewer.id)
      .first();
    expect(childRows).toEqual({ skills: 0, availability: 0 });
  });

  it("withdraws only the viewer's own application", async () => {
    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    const request = buildRequest({ intent: "withdraw" });
    const result = await callAction(request, "tok1", asD1(testDb));
    expect(result).toEqual({ ok: true });

    const self = await testDb
      .prepare("SELECT withdrawn FROM applications WHERE id = 'app_self'")
      .first<{ withdrawn: number }>();
    expect(self?.withdrawn).toBe(1);

    const other = await testDb
      .prepare("SELECT withdrawn FROM applications WHERE id = 'app_other'")
      .first<{ withdrawn: number }>();
    expect(other?.withdrawn).toBe(0);
  });

  it("rejects a save once the event is closed, without writing anything", async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedEventWithTwoApplicants(testDb, { status: "closed" });
    vi.mocked(getOptionalUser).mockResolvedValue(SELF);
    const request = buildRequest({ intent: "save", name: "Should Not Save" });
    const result = await callAction(request, "tok1", asD1(testDb));
    expect(result).toEqual({ error: "募集は終了しました。" });

    const self = await testDb
      .prepare("SELECT name FROM applications WHERE id = 'app_self'")
      .first<{ name: string }>();
    expect(self?.name).toBe(SELF.name);
  });
});
