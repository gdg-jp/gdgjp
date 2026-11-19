import { DatabaseSync } from "node:sqlite";
import type { ChapterRole, MeetActor } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import {
  MAX_MEET_AVATAR_EMAILS,
  MAX_MEET_DIRECTORY_CHAPTER_IDS,
  listMeetChapterMembers,
  listMeetUserAvatarsByEmails,
} from "./meet-directory.server";

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
      email TEXT NOT NULL UNIQUE,
      image TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
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

    INSERT INTO "user" (id, name, email, image, updated_at) VALUES
      ('u-org-b', 'Bob Organizer', 'bob@example.com', 'https://lh3.googleusercontent.com/a/bob=s96-c', 100),
      ('u-org-a', 'Alice Organizer', 'alice@example.com', 'https://lh3.googleusercontent.com/a/alice=s96-c', 200),
      ('u-mem-c', 'Carol Member', 'carol@example.com', NULL, 150),
      ('u-pending', 'Dave Pending', 'dave@example.com', 'http://insecure.example.com/dave.png', 100),
      ('u-outsider', 'Eve Outsider', 'eve@example.com', 'https://lh3.googleusercontent.com/a/eve=s96-c', 100),
      ('u-gmail', 'Gmail Dotted', 'first.last@gmail.com', 'https://lh3.googleusercontent.com/a/gmail=s96-c', 100),
      ('u-googlemail', 'Googlemail Dotted', 'g.mail@googlemail.com', 'https://lh3.googleusercontent.com/a/googlemail=s96-c', 100),
      ('u-custom-dot', 'Custom Dotted', 'first.last@example.com', 'https://lh3.googleusercontent.com/a/custom=s96-c', 100),
      ('u-bad-js', 'Bad JS', 'badjs@example.com', 'javascript:alert(1)', 100),
      ('u-bad-data', 'Bad Data', 'baddata@example.com', 'data:image/png;base64,AAAA', 100),
      ('u-bad-creds', 'Bad Creds', 'badcreds@example.com', 'https://user:pass@example.com/a.png', 100),
      ('u-blank', 'Blank Image', 'blank@example.com', '   ', 100);

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

describe("listMeetUserAvatarsByEmails", () => {
  it("returns HTTPS avatars for valid chapter-member and non-chapter-member callers", async () => {
    const { db } = createDb();

    const byMember = await listMeetUserAvatarsByEmails(db, {
      actorUserId: "u-org-a",
      emails: ["alice@example.com", "bob@example.com", "carol@example.com"],
    });
    expect(byMember).toEqual({
      ok: true,
      avatars: [
        {
          emailNormalized: "alice@example.com",
          image: "https://lh3.googleusercontent.com/a/alice=s96-c",
        },
        {
          emailNormalized: "bob@example.com",
          image: "https://lh3.googleusercontent.com/a/bob=s96-c",
        },
      ],
    });

    // 会議詳細画面はチャプター未所属の招待ゲストにも閲覧を許可するため、
    // memberships を持たない accounts ユーザーでも照会できる。
    const byNonChapterUser = await listMeetUserAvatarsByEmails(db, {
      actorUserId: "u-outsider",
      emails: ["alice@example.com", "eve@example.com"],
    });
    expect(byNonChapterUser).toEqual({
      ok: true,
      avatars: [
        {
          emailNormalized: "alice@example.com",
          image: "https://lh3.googleusercontent.com/a/alice=s96-c",
        },
        {
          emailNormalized: "eve@example.com",
          image: "https://lh3.googleusercontent.com/a/eve=s96-c",
        },
      ],
    });
  });

  it("matches Gmail and Googlemail dot variants while keeping custom-domain dots distinct", async () => {
    const { db } = createDb();

    const result = await listMeetUserAvatarsByEmails(db, {
      actorUserId: "u-org-a",
      emails: [
        "FirstLast@gmail.com",
        "gmail@googlemail.com",
        "firstlast@example.com",
        "first.last@example.com",
      ],
    });

    expect(result).toEqual({
      ok: true,
      avatars: [
        {
          emailNormalized: "first.last@example.com",
          image: "https://lh3.googleusercontent.com/a/custom=s96-c",
        },
        {
          emailNormalized: "firstlast@gmail.com",
          image: "https://lh3.googleusercontent.com/a/gmail=s96-c",
        },
        {
          emailNormalized: "gmail@googlemail.com",
          image: "https://lh3.googleusercontent.com/a/googlemail=s96-c",
        },
      ],
    });
  });

  it("filters out NULL, blank, non-HTTPS, and credential-bearing avatar URLs", async () => {
    const { db } = createDb();

    const result = await listMeetUserAvatarsByEmails(db, {
      actorUserId: "u-org-a",
      emails: [
        "carol@example.com",
        "dave@example.com",
        "badjs@example.com",
        "baddata@example.com",
        "badcreds@example.com",
        "blank@example.com",
        "bob@example.com",
      ],
    });

    expect(result).toEqual({
      ok: true,
      avatars: [
        {
          emailNormalized: "bob@example.com",
          image: "https://lh3.googleusercontent.com/a/bob=s96-c",
        },
      ],
    });
  });

  it("rejects missing or unknown actorUserId with forbidden without querying target emails", async () => {
    const { db, executedSql } = createDb();

    expect(
      await listMeetUserAvatarsByEmails(db, {
        actorUserId: "  ",
        emails: ["alice@example.com"],
      }),
    ).toEqual({ ok: false, code: "forbidden" });
    expect(executedSql).toHaveLength(0);

    expect(
      await listMeetUserAvatarsByEmails(db, {
        actorUserId: "u-does-not-exist",
        emails: ["alice@example.com"],
      }),
    ).toEqual({ ok: false, code: "forbidden" });
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain('SELECT 1 FROM "user" WHERE id = ? LIMIT 1');
  });

  it("rejects invalid emails inputs and requests exceeding MAX_MEET_AVATAR_EMAILS", async () => {
    const { db } = createDb();

    expect(
      await listMeetUserAvatarsByEmails(db, {
        actorUserId: "u-org-a",
        emails: "alice@example.com" as unknown as string[],
      }),
    ).toEqual({ ok: false, code: "invalid_emails" });

    expect(
      await listMeetUserAvatarsByEmails(db, {
        actorUserId: "u-org-a",
        emails: [123 as unknown as string],
      }),
    ).toEqual({ ok: false, code: "invalid_emails" });

    const overLimit = Array.from(
      { length: MAX_MEET_AVATAR_EMAILS + 1 },
      (_, idx) => `u${idx}@example.com`,
    );
    expect(
      await listMeetUserAvatarsByEmails(db, {
        actorUserId: "u-org-a",
        emails: overLimit,
      }),
    ).toEqual({ ok: false, code: "too_many_emails" });
  });

  it("handles empty emails cleanly and chunks queries of > 100 unique emails into <= 50 variables", async () => {
    const { db, executedSql } = createDb();

    const emptyRes = await listMeetUserAvatarsByEmails(db, {
      actorUserId: "u-org-a",
      emails: ["  ", ""],
    });
    expect(emptyRes).toEqual({ ok: true, avatars: [] });
    expect(executedSql).toHaveLength(1);

    executedSql.length = 0;
    const bulkEmails = [
      "alice@example.com",
      ...Array.from({ length: 119 }, (_, idx) => `bulk-${idx}@example.com`),
    ];
    const bulkRes = await listMeetUserAvatarsByEmails(db, {
      actorUserId: "u-org-a",
      emails: bulkEmails,
    });
    expect(bulkRes).toEqual({
      ok: true,
      avatars: [
        {
          emailNormalized: "alice@example.com",
          image: "https://lh3.googleusercontent.com/a/alice=s96-c",
        },
      ],
    });
    // 1 actor check + 3 chunked SELECTs (50 + 50 + 20)
    expect(executedSql).toHaveLength(4);
    for (const sql of executedSql.slice(1)) {
      const placeholderCount = (sql.match(/\?/g) ?? []).length;
      expect(placeholderCount).toBeLessThanOrEqual(50);
    }
  });

  it("converts unexpected DB exceptions into internal_error instead of throwing", async () => {
    const brokenDb = {
      prepare() {
        throw new Error("D1 connection lost");
      },
    } as unknown as D1Database;

    await expect(
      listMeetUserAvatarsByEmails(brokenDb, {
        actorUserId: "u-org-a",
        emails: ["alice@example.com"],
      }),
    ).resolves.toEqual({ ok: false, code: "internal_error" });
  });
});
