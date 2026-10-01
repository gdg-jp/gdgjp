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

/**
 * Seeds an `open` event with two event_roles, two time slots, and two
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
      "INSERT INTO event_roles (event_id, role_id) VALUES ('evt_1', 'reception'), ('evt_1', 'guide')",
    )
    .run();
  await testDb
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES ('slot_1', 'evt_1', 0, '09:00', '10:00'), ('slot_2', 'evt_1', 1, '10:00', '11:00')",
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
    expect(result.timeSlots).toHaveLength(2);

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
      ["canApplyNow", "event", "own", "roles", "signInHref", "timeSlots", "viewer"].sort(),
    );

    expect(result.own).toEqual({
      name: SELF.name,
      contact: "self-contact@example.com",
      party: "undecided",
      note: "",
      withdrawn: false,
      skills: [{ roleId: "reception", level: "lead", pref: 1 }],
      availability: [{ timeSlotId: "slot_1", value: "o" }],
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
      avail_slot_1: "o",
      avail_slot_2: "x",
    });
    const result = await callAction(request, "tok1", asD1(testDb));
    expect(result).toEqual({ ok: true });

    const self = await testDb
      .prepare("SELECT name FROM applications WHERE id = 'app_self'")
      .first<{ name: string }>();
    expect(self?.name).toBe("Self Updated Name");

    const other = await testDb
      .prepare("SELECT name, contact FROM applications WHERE id = 'app_other'")
      .first<{ name: string; contact: string }>();
    expect(other).toEqual({ name: OTHER_NAME, contact: OTHER_CONTACT });
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
