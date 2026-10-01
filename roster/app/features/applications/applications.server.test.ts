import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  claimApplication,
  correctApplication,
  createApplication,
  getApplicationByEventAndEmail,
  getApplicationById,
  resolveOwnApplication,
  toApplication,
  updateApplication,
  withdrawApplication,
} from "./applications.server";
import { listAvailabilityForApplication } from "./availability.server";
import { listSkillsForApplication } from "./skills.server";

const MIGRATIONS = [
  fileURLToPath(new URL("../../../migrations/0001_init.sql", import.meta.url)),
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

const EVENT_ID = "evt_1";

async function seedEvent(testDb: TestD1Database, id = EVENT_ID) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES (?, 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'apply-tok', 'view-tok', ?, ?)`,
    )
    .bind(id, now, now)
    .run();
}

describe("toApplication", () => {
  it("maps snake_case columns to camelCase, converting withdrawn to a boolean", () => {
    const now = "2026-01-01T00:00:00.000Z";
    expect(
      toApplication({
        id: "app_1",
        event_id: "evt_1",
        user_id: "user_1",
        email: "a@example.com",
        name: "山田太郎",
        contact: "090-0000-0000",
        party: "yes",
        note: "note",
        withdrawn: 0,
        updated_by: "self",
        created_at: now,
        updated_at: now,
      }),
    ).toEqual({
      id: "app_1",
      eventId: "evt_1",
      userId: "user_1",
      email: "a@example.com",
      name: "山田太郎",
      contact: "090-0000-0000",
      party: "yes",
      note: "note",
      withdrawn: false,
      updatedBy: "self",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("passes through a null user_id (proxy registration)", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const app = toApplication({
      id: "app_2",
      event_id: "evt_1",
      user_id: null,
      email: "b@example.com",
      name: "B",
      contact: null,
      party: "undecided",
      note: null,
      withdrawn: 1,
      updated_by: "owner",
      created_at: now,
      updated_at: now,
    });
    expect(app.userId).toBeNull();
    expect(app.withdrawn).toBe(true);
  });
});

describe("createApplication dedup (real SQLite, migrated schema)", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEvent(testDb);
  });

  /**
   * docs/roster/04-applications.md "回帰として固定すべきテスト": a second
   * application with the same (event_id, email) must be rejected — this is
   * the dedup guarantee the whole proxy-registration design depends on.
   */
  it("rejects a second application with the same (event_id, email)", async () => {
    const first = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "dup@example.com",
      name: "First",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    expect(first.ok).toBe(true);

    const second = await createApplication(db, EVENT_ID, {
      userId: null,
      email: "dup@example.com",
      name: "Second",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "owner",
    });
    expect(second).toEqual({ ok: false, reason: "duplicate_email" });
  });

  it("rejects a second application with the same (event_id, user_id)", async () => {
    const first = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "First",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    expect(first.ok).toBe(true);

    const second = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "different@example.com",
      name: "Second",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    expect(second).toEqual({ ok: false, reason: "duplicate_user" });
  });

  /**
   * Found during review: neither `accounts.gdgs.jp` nor an owner typing a
   * proxy-add address guarantees stable email casing, and the
   * `(event_id, email)` UNIQUE index has no `COLLATE NOCASE` — without
   * normalizing, "Person@Example.com" and "person@example.com" would
   * silently create two rows for the same person on the same event.
   */
  it("treats emails as case-insensitive for dedup", async () => {
    const first = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "Person@Example.com",
      name: "First",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    expect(first.ok).toBe(true);

    const second = await createApplication(db, EVENT_ID, {
      userId: null,
      email: "person@example.com",
      name: "Second",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "owner",
    });
    expect(second).toEqual({ ok: false, reason: "duplicate_email" });
  });

  it("stores email normalized to lowercase regardless of input casing", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "  Mixed.Case@Example.COM  ",
      name: "First",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");
    expect(created.application.email).toBe("mixed.case@example.com");
  });

  it("allows any number of proxy registrations (user_id NULL) as long as emails differ", async () => {
    const first = await createApplication(db, EVENT_ID, {
      userId: null,
      email: "proxy1@example.com",
      name: "Proxy 1",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "owner",
    });
    const second = await createApplication(db, EVENT_ID, {
      userId: null,
      email: "proxy2@example.com",
      name: "Proxy 2",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "owner",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});

describe("claimApplication", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEvent(testDb);
  });

  it("fills user_id on an unclaimed row", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: null,
      email: "proxy@example.com",
      name: "Proxy",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "owner",
    });
    if (!created.ok) throw new Error("setup failed");

    const claimed = await claimApplication(db, created.application.id, "user_9");
    expect(claimed?.userId).toBe("user_9");
  });

  /**
   * docs/roster/04-applications.md "回帰として固定すべきテスト": an
   * already-claimed row must never be claimable by someone else.
   */
  it("does nothing when the row is already claimed by someone else", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "A",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");

    const claimed = await claimApplication(db, created.application.id, "user_2");
    expect(claimed).toBeNull();

    const unchanged = await getApplicationById(db, EVENT_ID, created.application.id);
    expect(unchanged?.userId).toBe("user_1");
  });
});

describe("resolveOwnApplication", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEvent(testDb);
  });

  it("returns new when the viewer has no application yet", async () => {
    const result = await resolveOwnApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
    });
    expect(result).toEqual({ kind: "new" });
  });

  it("auto-claims a proxy registration matching the viewer's email", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: null,
      email: "proxy@example.com",
      name: "Proxy",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "owner",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await resolveOwnApplication(db, EVENT_ID, {
      userId: "user_5",
      email: "proxy@example.com",
    });
    expect(result.kind).toBe("own");
    if (result.kind === "own") {
      expect(result.application.id).toBe(created.application.id);
      expect(result.application.userId).toBe("user_5");
    }
  });

  it("returns the viewer's own application without re-claiming it", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "A",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await resolveOwnApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
    });
    expect(result).toEqual({ kind: "own", application: created.application });
  });

  /**
   * Found during review: the IdP-returned email case for a real sign-in
   * won't always match whatever case a proxy-add row was created with, so
   * the claim match must be case-insensitive too — not just dedup at write
   * time.
   */
  it("auto-claims a proxy registration even when the viewer's email differs only in case", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: null,
      email: "proxy@example.com",
      name: "Proxy",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "owner",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await resolveOwnApplication(db, EVENT_ID, {
      userId: "user_5",
      email: "Proxy@Example.com",
    });
    expect(result.kind).toBe("own");
    if (result.kind === "own") {
      expect(result.application.id).toBe(created.application.id);
      expect(result.application.userId).toBe("user_5");
    }
  });
});

describe("updateApplication / withdrawApplication", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEvent(testDb);
  });

  it("overwrites the editable fields and updated_by, leaving email/userId untouched", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "Self-reported",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");

    const updated = await updateApplication(db, created.application.id, {
      name: "Owner-corrected",
      contact: "070-1111-2222",
      party: "yes",
      note: "owner note",
      withdrawn: false,
      updatedBy: "owner",
    });
    expect(updated?.name).toBe("Owner-corrected");
    expect(updated?.updatedBy).toBe("owner");
    expect(updated?.email).toBe("a@example.com");
    expect(updated?.userId).toBe("user_1");
  });

  it("withdraws without touching name/contact/party/note", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "A",
      contact: "c",
      party: "yes",
      note: "n",
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");

    const withdrawn = await withdrawApplication(db, created.application.id, "self");
    expect(withdrawn?.withdrawn).toBe(true);
    expect(withdrawn?.name).toBe("A");
    expect(withdrawn?.contact).toBe("c");
    expect(withdrawn?.party).toBe("yes");
  });
});

describe("getApplicationByEventAndEmail", () => {
  it("returns null when no row matches", async () => {
    const testDb = createTestD1(MIGRATIONS);
    const db = asD1(testDb);
    await seedEvent(testDb);
    expect(await getApplicationByEventAndEmail(db, EVENT_ID, "nobody@example.com")).toBeNull();
  });
});

/**
 * docs/roster/05-staff-supply-demand.md "回帰として固定すべきテスト": an
 * owner correction must land as `updated_by = 'owner'`, and (like
 * `/apply/:token`'s own "save reactivates" convention) reactivate a
 * withdrawn applicant rather than leaving them withdrawn.
 */
describe("correctApplication", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEvent(testDb);
    await testDb
      .prepare(
        "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES ('slot_1', 'evt_1', 0, '09:00', '10:00')",
      )
      .run();
  });

  it("sets updated_by to owner and replaces skills/availability wholesale", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "Self-reported",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");

    await correctApplication(db, created.application, {
      skills: [{ roleId: "reception", level: "lead", pref: 1 }],
      availability: [{ timeSlotId: "slot_1", value: "x" }],
    });

    const updated = await getApplicationById(db, EVENT_ID, created.application.id);
    expect(updated?.updatedBy).toBe("owner");

    expect(await listSkillsForApplication(db, created.application.id)).toEqual([
      { applicationId: created.application.id, roleId: "reception", level: "lead", pref: 1 },
    ]);
    expect(await listAvailabilityForApplication(db, created.application.id)).toEqual([
      { applicationId: created.application.id, timeSlotId: "slot_1", value: "x" },
    ]);
  });

  it("reactivates a withdrawn application, the same 'save reactivates' rule as /apply/:token", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "A",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");
    await withdrawApplication(db, created.application.id, "self");

    await correctApplication(db, created.application, { skills: [], availability: [] });

    const updated = await getApplicationById(db, EVENT_ID, created.application.id);
    expect(updated?.withdrawn).toBe(false);
    expect(updated?.updatedBy).toBe("owner");
  });

  it("leaves email/userId untouched, like updateApplication", async () => {
    const created = await createApplication(db, EVENT_ID, {
      userId: "user_1",
      email: "a@example.com",
      name: "A",
      contact: null,
      party: "undecided",
      note: null,
      updatedBy: "self",
    });
    if (!created.ok) throw new Error("setup failed");

    await correctApplication(db, created.application, { skills: [], availability: [] });

    const updated = await getApplicationById(db, EVENT_ID, created.application.id);
    expect(updated?.email).toBe("a@example.com");
    expect(updated?.userId).toBe("user_1");
  });
});
