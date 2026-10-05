import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  listSkillsForApplication,
  setApplicationSkills,
  toApplicationSkill,
} from "./skills.server";

const MIGRATIONS = [
  fileURLToPath(new URL("../../../migrations/0002_domain.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0004_applications.sql", import.meta.url)),
];

const APPLICATION_ID = "app_1";

async function seedApplication(testDb: TestD1Database) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'apply-tok', 'view-tok', ?, ?)`,
    )
    .bind(now, now)
    .run();
  await testDb
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
       VALUES (?, 'evt_1', 'user_1', 'a@example.com', 'A', ?, ?)`,
    )
    .bind(APPLICATION_ID, now, now)
    .run();
}

describe("toApplicationSkill", () => {
  it("maps snake_case columns to camelCase", () => {
    expect(
      toApplicationSkill({ application_id: "app_1", role_id: "reception", level: "lead", pref: 1 }),
    ).toEqual({ applicationId: "app_1", roleId: "reception", level: "lead", pref: 1 });
  });
});

describe("setApplicationSkills / listSkillsForApplication (real SQLite)", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedApplication(testDb);
  });

  it("inserts only the roles the applicant selected", async () => {
    await setApplicationSkills(db, APPLICATION_ID, [
      { roleId: "reception", level: "lead", pref: 1 },
      { roleId: "guide", level: "new", pref: 2 },
    ]);
    const skills = await listSkillsForApplication(db, APPLICATION_ID);
    expect(skills).toEqual([
      { applicationId: APPLICATION_ID, roleId: "guide", level: "new", pref: 2 },
      { applicationId: APPLICATION_ID, roleId: "reception", level: "lead", pref: 1 },
    ]);
  });

  it("wholesale-replaces the set on a second call, not merging with the first", async () => {
    await setApplicationSkills(db, APPLICATION_ID, [
      { roleId: "reception", level: "lead", pref: 1 },
    ]);
    await setApplicationSkills(db, APPLICATION_ID, [{ roleId: "guide", level: "exp", pref: 2 }]);

    const skills = await listSkillsForApplication(db, APPLICATION_ID);
    expect(skills).toEqual([
      { applicationId: APPLICATION_ID, roleId: "guide", level: "exp", pref: 2 },
    ]);
  });

  it("clears every skill when given an empty list", async () => {
    await setApplicationSkills(db, APPLICATION_ID, [
      { roleId: "reception", level: "lead", pref: 1 },
    ]);
    await setApplicationSkills(db, APPLICATION_ID, []);
    expect(await listSkillsForApplication(db, APPLICATION_ID)).toEqual([]);
  });
});
