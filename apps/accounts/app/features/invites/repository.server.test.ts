import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { joinMembershipViaInvite } from "~/features/memberships/mutations.server";
import {
  createInvite,
  getInviteByToken,
  listActiveInvitesForChapters,
  revokeInvite,
} from "./repository.server";

/**
 * Runs the invite SQL against real SQLite (Node's built-in driver) so the
 * migration's constraints and the membership upsert are exercised, not just
 * the calls. Only the slice of D1 these modules use is wrapped.
 */
function createDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE chapters (id INTEGER PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE memberships (
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('organizer', 'member')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      approved_at INTEGER,
      PRIMARY KEY (user_id, chapter_id)
    );
    INSERT INTO "user" VALUES ('org', 'Organizer', 'org@example.com'), ('u1', 'User', 'u@example.com');
    INSERT INTO chapters VALUES (1, 'gdg-tokyo', 'GDG Tokyo'), (2, 'gdg-osaka', 'GDG Osaka'), (3, 'gdg-kyoto', 'GDG Kyoto');`);
  raw.exec(
    readFileSync(new URL("../../../migrations/0022_chapter_invites.sql", import.meta.url), "utf8"),
  );
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...(params as never[])) }),
    run: async () => ({
      meta: { changes: Number(raw.prepare(sql).run(...(params as never[])).changes) },
    }),
    runSync: () => raw.prepare(sql).run(...(params as never[])),
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<ReturnType<typeof statement>>) => {
      raw.exec("BEGIN");
      try {
        for (const s of statements) s.runSync();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
      return [];
    },
  };
  return { raw, db: db as unknown as D1Database };
}

const now = Math.floor(Date.now() / 1000);

describe("invite repository", () => {
  it("stores an invite with several chapters and finds it by token", async () => {
    const { db } = createDb();
    await createInvite(db, {
      id: "i1",
      token: "t1",
      createdBy: "org",
      chapterIds: [2, 1],
      expiresAt: now + 60,
    });
    const invite = await getInviteByToken(db, "t1");
    expect(invite).toMatchObject({
      id: "i1",
      createdBy: "org",
      expiresAt: now + 60,
      revokedAt: null,
    });
    expect(invite?.chapters.map((c) => c.slug)).toEqual(["gdg-osaka", "gdg-tokyo"]);
    await expect(getInviteByToken(db, "missing")).resolves.toBeNull();
  });

  it("rolls back the invite when a linked chapter does not exist", async () => {
    const { db } = createDb();
    await expect(
      createInvite(db, {
        id: "i1",
        token: "t1",
        createdBy: "org",
        chapterIds: [1, 99],
        expiresAt: now + 60,
      }),
    ).rejects.toThrow();
    await expect(getInviteByToken(db, "t1")).resolves.toBeNull();
  });

  it("lists only usable invites touching the given chapters", async () => {
    const { db } = createDb();
    await createInvite(db, {
      id: "a",
      token: "ta",
      createdBy: "org",
      chapterIds: [1],
      expiresAt: now + 60,
    });
    await createInvite(db, {
      id: "b",
      token: "tb",
      createdBy: "org",
      chapterIds: [1, 2],
      expiresAt: now - 1,
    });
    await createInvite(db, {
      id: "c",
      token: "tc",
      createdBy: "org",
      chapterIds: [2, 3],
      expiresAt: now + 60,
    });
    await createInvite(db, {
      id: "d",
      token: "td",
      createdBy: "org",
      chapterIds: [3],
      expiresAt: now + 60,
    });
    await revokeInvite(db, "d");
    const listed = await listActiveInvitesForChapters(db, [2, 3], now);
    expect(listed.map((i) => i.id)).toEqual(["c"]);
    expect(listed[0]?.creator).toEqual({ name: "Organizer", email: "org@example.com" });
    expect((await getInviteByToken(db, "td"))?.revokedAt).not.toBeNull();
  });
});

describe("joinMembershipViaInvite", () => {
  it("adds a new active member", async () => {
    const { db, raw } = createDb();
    await expect(joinMembershipViaInvite(db, "u1", 1)).resolves.toBe("joined");
    expect(raw.prepare("SELECT role, status FROM memberships WHERE user_id = 'u1'").get()).toEqual({
      role: "member",
      status: "active",
    });
  });

  it("promotes a pending request to active", async () => {
    const { db, raw } = createDb();
    raw.exec(
      "INSERT INTO memberships (user_id, chapter_id, role, status) VALUES ('u1', 1, 'member', 'pending')",
    );
    await expect(joinMembershipViaInvite(db, "u1", 1)).resolves.toBe("joined");
    expect(raw.prepare("SELECT status FROM memberships WHERE user_id = 'u1'").get()).toEqual({
      status: "active",
    });
  });

  it("keeps an existing organizer untouched", async () => {
    const { db, raw } = createDb();
    raw.exec(
      "INSERT INTO memberships (user_id, chapter_id, role, status, approved_at) VALUES ('org', 1, 'organizer', 'active', 5)",
    );
    await expect(joinMembershipViaInvite(db, "org", 1)).resolves.toBe("already_member");
    expect(
      raw.prepare("SELECT role, approved_at FROM memberships WHERE user_id = 'org'").get(),
    ).toEqual({
      role: "organizer",
      approved_at: 5,
    });
  });
});
