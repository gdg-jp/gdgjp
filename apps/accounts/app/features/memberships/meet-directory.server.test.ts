import { DatabaseSync } from "node:sqlite";
import type { ChapterRole, MeetActor } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { MAX_MEET_DIRECTORY_CHAPTER_IDS, listMeetChapterMembers } from "./meet-directory.server";

/**
 * Node 組み込み SQLite（`:memory:`）上に accounts の必要テーブルを用意し、
 * 実 SQL の JOIN・status フィルタ・並び順をそのまま検証する。
 */
function createDb() {
  const raw = new DatabaseSync(":memory:");
  const executedSql: string[] = [];

  raw.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE memberships (
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('organizer', 'member')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      approved_at INTEGER,
      PRIMARY KEY (user_id, chapter_id)
    );

    INSERT INTO chapters (id, slug, name) VALUES
      (1, 'gdg-tokyo', 'GDG Tokyo'),
      (2, 'gdg-osaka', 'GDG Osaka');

    INSERT INTO "user" (id, name, email) VALUES
      ('u-org-b', 'Bob Organizer', 'bob@example.com'),
      ('u-org-a', 'Alice Organizer', 'alice@example.com'),
      ('u-mem-c', 'Carol Member', 'carol@example.com'),
      ('u-pending', 'Dave Pending', 'dave@example.com'),
      ('u-outsider', 'Eve Outsider', 'eve@example.com');

    INSERT INTO memberships (user_id, chapter_id, role, status) VALUES
      ('u-org-b', 1, 'organizer', 'active'),
      ('u-org-a', 1, 'organizer', 'active'),
      ('u-mem-c', 1, 'member', 'active'),
      ('u-pending', 1, 'organizer', 'pending'),
      ('u-org-a', 2, 'member', 'active'),
      ('u-mem-c', 2, 'organizer', 'active'),
      ('u-pending', 2, 'member', 'pending');
  `);

  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      executedSql.push(sql);
      return raw.prepare(sql).get(...(params as never[])) ?? null;
    },
    all: async () => {
      executedSql.push(sql);
      return { results: raw.prepare(sql).all(...(params as never[])) };
    },
  });

  const db = {
    prepare: (sql: string) => statement(sql),
  } as unknown as D1Database;

  return { raw, db, executedSql };
}

function makeActor(id: string, chapters: MeetActor["chapters"] = []): MeetActor {
  return {
    user: {
      id,
      email: `${id}@example.com`,
      name: id,
      image: null,
      isAdmin: false,
    },
    chapters,
  };
}

describe("listMeetChapterMembers", () => {
  it("returns only active memberships sorted by chapterId, role (organizer first), and name", async () => {
    const { db } = createDb();
    const actor = makeActor("u-mem-c", [
      { chapterId: 1, chapterSlug: "gdg-tokyo", role: "member" },
    ]);

    const result = await listMeetChapterMembers(db, {
      actor,
      chapterIds: [2, 1, 1],
    });

    expect(result).toEqual({
      ok: true,
      members: [
        {
          userId: "u-org-a",
          name: "Alice Organizer",
          email: "alice@example.com",
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "organizer",
        },
        {
          userId: "u-org-b",
          name: "Bob Organizer",
          email: "bob@example.com",
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "organizer",
        },
        {
          userId: "u-mem-c",
          name: "Carol Member",
          email: "carol@example.com",
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "member",
        },
        {
          userId: "u-mem-c",
          name: "Carol Member",
          email: "carol@example.com",
          chapterId: 2,
          chapterSlug: "gdg-osaka",
          chapterName: "GDG Osaka",
          role: "organizer",
        },
        {
          userId: "u-org-a",
          name: "Alice Organizer",
          email: "alice@example.com",
          chapterId: 2,
          chapterSlug: "gdg-osaka",
          chapterName: "GDG Osaka",
          role: "member",
        },
      ],
    });
  });

  it("never returns pending memberships", async () => {
    const { db } = createDb();
    const actor = makeActor("u-org-a");

    const result = await listMeetChapterMembers(db, {
      actor,
      chapterIds: [1, 2],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members.some((m) => m.userId === "u-pending")).toBe(false);
  });

  it("rejects an actor without an active membership in D1 even when actor.chapters is forged", async () => {
    const { db } = createDb();
    const forgedOutsider = makeActor("u-outsider", [
      { chapterId: 1, chapterSlug: "gdg-tokyo", role: "organizer" },
    ]);
    const forgedPending = makeActor("u-pending", [
      { chapterId: 1, chapterSlug: "gdg-tokyo", role: "organizer" },
    ]);

    expect(await listMeetChapterMembers(db, { actor: forgedOutsider, chapterIds: [1] })).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(await listMeetChapterMembers(db, { actor: forgedPending, chapterIds: [1] })).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(await listMeetChapterMembers(db, { actor: makeActor("  "), chapterIds: [1] })).toEqual({
      ok: false,
      code: "forbidden",
    });
  });

  it("returns an empty array for non-existent chapterIds and returns only existing ones when mixed", async () => {
    const { db } = createDb();
    const actor = makeActor("u-org-a");

    expect(await listMeetChapterMembers(db, { actor, chapterIds: [999] })).toEqual({
      ok: true,
      members: [],
    });

    const mixed = await listMeetChapterMembers(db, {
      actor,
      chapterIds: [999, 2],
      roles: ["organizer"],
    });
    expect(mixed).toEqual({
      ok: true,
      members: [
        {
          userId: "u-mem-c",
          name: "Carol Member",
          email: "carol@example.com",
          chapterId: 2,
          chapterSlug: "gdg-osaka",
          chapterName: "GDG Osaka",
          role: "organizer",
        },
      ],
    });
  });

  it("returns empty members without running the member query when chapterIds is empty", async () => {
    const { db, executedSql } = createDb();
    const actor = makeActor("u-org-a");

    const result = await listMeetChapterMembers(db, { actor, chapterIds: [] });
    expect(result).toEqual({ ok: true, members: [] });
    // actor の active 所属検証クエリのみ実行され、メンバー一覧クエリは実行されない。
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain("SELECT 1 FROM memberships");
  });

  it("rejects chapterIds exceeding MAX_MEET_DIRECTORY_CHAPTER_IDS (50)", async () => {
    const { db } = createDb();
    const actor = makeActor("u-org-a");
    const overLimit = Array.from(
      { length: MAX_MEET_DIRECTORY_CHAPTER_IDS + 1 },
      (_, index) => index + 1,
    );
    const atLimit = Array.from({ length: MAX_MEET_DIRECTORY_CHAPTER_IDS }, (_, index) => index + 1);

    expect(await listMeetChapterMembers(db, { actor, chapterIds: overLimit })).toEqual({
      ok: false,
      code: "too_many_chapters",
    });

    const okAtLimit = await listMeetChapterMembers(db, { actor, chapterIds: atLimit });
    expect(okAtLimit.ok).toBe(true);
  });

  it("rejects non-positive or non-integer chapterIds", async () => {
    const { db } = createDb();
    const actor = makeActor("u-org-a");

    for (const bad of [[0], [-1], [1.5], [Number.NaN], ["1" as unknown as number]]) {
      expect(await listMeetChapterMembers(db, { actor, chapterIds: bad })).toEqual({
        ok: false,
        code: "invalid_chapter_ids",
      });
    }
  });

  it("filters by roles when specified and rejects empty or unknown roles", async () => {
    const { db } = createDb();
    const actor = makeActor("u-org-a");

    const organizersOnly = await listMeetChapterMembers(db, {
      actor,
      chapterIds: [1],
      roles: ["organizer"],
    });
    expect(organizersOnly.ok).toBe(true);
    if (organizersOnly.ok) {
      expect(organizersOnly.members.map((m) => m.userId)).toEqual(["u-org-a", "u-org-b"]);
      expect(organizersOnly.members.every((m) => m.role === "organizer")).toBe(true);
    }

    expect(await listMeetChapterMembers(db, { actor, chapterIds: [1], roles: [] })).toEqual({
      ok: false,
      code: "invalid_roles",
    });
    expect(
      await listMeetChapterMembers(db, {
        actor,
        chapterIds: [1],
        roles: ["admin" as unknown as ChapterRole],
      }),
    ).toEqual({
      ok: false,
      code: "invalid_roles",
    });
  });

  it("converts unexpected DB exceptions into internal_error instead of throwing", async () => {
    const brokenDb = {
      prepare() {
        throw new Error("D1 connection lost");
      },
    } as unknown as D1Database;

    await expect(
      listMeetChapterMembers(brokenDb, {
        actor: makeActor("u-org-a"),
        chapterIds: [1],
      }),
    ).resolves.toEqual({ ok: false, code: "internal_error" });
  });
});
