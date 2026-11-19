import { DatabaseSync } from "node:sqlite";
import type {
  ListChapterMembersInput,
  MeetDirectoryMember,
  MeetRpcResult,
  MeetUserAvatar,
} from "@gdgjp/gdg-lib";
import { describe, expect, it, vi } from "vitest";
import type { ChapterSummary } from "./directory";
import {
  DirectoryError,
  fetchChapterMembers,
  fetchChaptersDirectory,
  fetchUserAvatarsByEmails,
  listLocalUserAvatarsByEmails,
  resolveInviteeAvatars,
} from "./directory.server";

const SAMPLE_INPUT: ListChapterMembersInput = {
  actor: {
    user: {
      id: "u-1",
      email: "organizer@example.com",
      name: "Organizer",
      image: null,
      isAdmin: false,
    },
    chapters: [{ chapterId: 1, chapterSlug: "gdg-tokyo", role: "organizer" }],
  },
  chapterIds: [1, 2],
  roles: ["organizer"],
};

describe("fetchChaptersDirectory", () => {
  it("parses /api/chapters/directory, converts id to number, and strips non-public fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        chapters: [
          {
            id: "1",
            slug: "gdg-tokyo",
            name: "GDG Tokyo",
            kind: "gdg",
            region: "kanto",
            // 余分な個人情報が混入してもブラウザ向け型 ChapterSummary には含めない。
            email: "secret@example.com",
          },
          {
            id: "12",
            slug: "gdgoc-example",
            name: "GDGoC Example",
            kind: "gdgoc",
            region: "kansai",
          },
        ],
      }),
    );
    const env = {
      ACCOUNTS_URL: "https://accounts.gdgs.jp",
      ACCOUNTS: { fetch: fetchMock },
    } as unknown as Env;

    const chapters: ChapterSummary[] = await fetchChaptersDirectory(env);

    expect(fetchMock).toHaveBeenCalledWith("https://accounts.gdgs.jp/api/chapters/directory");
    expect(chapters).toEqual([
      {
        id: 1,
        slug: "gdg-tokyo",
        name: "GDG Tokyo",
        kind: "gdg",
        region: "kanto",
      },
      {
        id: 12,
        slug: "gdgoc-example",
        name: "GDGoC Example",
        kind: "gdgoc",
        region: "kansai",
      },
    ]);
    // ブラウザ向け型 ChapterSummary のキーにメールアドレス等の個人情報が含まれないことを固定する。
    for (const chapter of chapters) {
      expect(Object.keys(chapter).sort()).toEqual(["id", "kind", "name", "region", "slug"]);
      expect("email" in chapter).toBe(false);
    }
  });

  it("throws DirectoryError when ACCOUNTS returns a non-OK response", async () => {
    const env = {
      ACCOUNTS_URL: "https://accounts.gdgs.jp",
      ACCOUNTS: {
        fetch: vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })),
      },
    } as unknown as Env;

    await expect(fetchChaptersDirectory(env)).rejects.toMatchObject({
      name: "DirectoryError",
      code: "chapters_fetch_failed",
    });
  });

  it("throws DirectoryError when chapter id is not a positive integer", async () => {
    const env = {
      ACCOUNTS_URL: "https://accounts.gdgs.jp",
      ACCOUNTS: {
        fetch: vi.fn().mockResolvedValue(
          Response.json({
            chapters: [{ id: "abc", slug: "bad", name: "Bad", kind: "gdg", region: "other" }],
          }),
        ),
      },
    } as unknown as Env;

    await expect(fetchChaptersDirectory(env)).rejects.toMatchObject({
      name: "DirectoryError",
      code: "invalid_chapters_response",
    });
  });
});

/** RP ローカル `user.id` → accounts ユーザー ID（`oidc_subject`）を返す D1 スタブ。 */
function fakeUserDb(oidcSubject: string | null = "accounts-u-1") {
  const bound: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          bound.push(args);
          return {
            async first() {
              if (!sql.includes('FROM "user" WHERE id = ?'))
                throw new Error(`unexpected SQL: ${sql}`);
              return oidcSubject === null ? null : { oidc_subject: oidcSubject };
            },
          };
        },
      };
    },
  };
  return { db, bound };
}

describe("fetchChapterMembers", () => {
  it("sends the accounts user id (oidc_subject), not the RP-local user id, as the actor", async () => {
    const listChapterMembers = vi
      .fn<() => Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>>>()
      .mockResolvedValue({ ok: true, members: [] });
    const { db, bound } = fakeUserDb("accounts-u-1");
    const env = { DB: db, ACCOUNTS_DIRECTORY: { listChapterMembers } } as unknown as Env;

    await fetchChapterMembers(env, SAMPLE_INPUT);

    expect(bound).toEqual([["u-1"]]);
    expect(listChapterMembers).toHaveBeenCalledWith({
      ...SAMPLE_INPUT,
      actor: { ...SAMPLE_INPUT.actor, user: { ...SAMPLE_INPUT.actor.user, id: "accounts-u-1" } },
    });
  });

  it("fails closed with DirectoryError(forbidden) when the user has no oidc_subject", async () => {
    const listChapterMembers = vi.fn();
    const env = {
      DB: fakeUserDb(null).db,
      ACCOUNTS_DIRECTORY: { listChapterMembers },
    } as unknown as Env;

    await expect(fetchChapterMembers(env, SAMPLE_INPUT)).rejects.toMatchObject({
      name: "DirectoryError",
      code: "forbidden",
    });
    expect(listChapterMembers).not.toHaveBeenCalled();
  });

  it("returns members when ACCOUNTS_DIRECTORY succeeds", async () => {
    const expectedMembers: MeetDirectoryMember[] = [
      {
        userId: "u-1",
        name: "Organizer",
        email: "organizer@example.com",
        chapterId: 1,
        chapterSlug: "gdg-tokyo",
        chapterName: "GDG Tokyo",
        role: "organizer",
      },
    ];
    const listChapterMembers = vi
      .fn<() => Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>>>()
      .mockResolvedValue({ ok: true, members: expectedMembers });
    const env = {
      DB: fakeUserDb().db,
      ACCOUNTS_DIRECTORY: { listChapterMembers },
    } as unknown as Env;

    const members = await fetchChapterMembers(env, SAMPLE_INPUT);

    expect(listChapterMembers).toHaveBeenCalledTimes(1);
    expect(members).toEqual(expectedMembers);
  });

  it("throws typed DirectoryError when ACCOUNTS_DIRECTORY returns { ok: false }", async () => {
    const listChapterMembers = vi
      .fn<() => Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>>>()
      .mockResolvedValue({ ok: false, code: "forbidden", message: "no active chapter" });
    const env = {
      DB: fakeUserDb().db,
      ACCOUNTS_DIRECTORY: { listChapterMembers },
    } as unknown as Env;

    let caught: unknown;
    try {
      await fetchChapterMembers(env, SAMPLE_INPUT);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DirectoryError);
    expect(caught).toMatchObject({
      code: "forbidden",
      message: "no active chapter",
    });
  });

  it("wraps unexpected RPC transport errors into DirectoryError(binding_error)", async () => {
    const listChapterMembers = vi.fn().mockRejectedValue(new Error("worker unavailable"));
    const env = {
      DB: fakeUserDb().db,
      ACCOUNTS_DIRECTORY: { listChapterMembers },
    } as unknown as Env;

    await expect(fetchChapterMembers(env, SAMPLE_INPUT)).rejects.toMatchObject({
      name: "DirectoryError",
      code: "binding_error",
      message: "worker unavailable",
    });
  });
});

function createLocalUserDb(
  rows: Array<{
    id: string;
    email: string;
    image: string | null;
    oidcSubject?: string | null;
    updatedAt?: number;
  }>,
) {
  const raw = new DatabaseSync(":memory:");
  const executedSql: string[] = [];

  raw.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      image TEXT,
      oidc_issuer TEXT,
      oidc_subject TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  const insert = raw.prepare(
    `INSERT INTO "user" (id, email, name, image, oidc_subject, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(row.id, row.email, row.id, row.image, row.oidcSubject ?? null, row.updatedAt ?? 100);
  }

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

  return { db, executedSql };
}

describe("fetchUserAvatarsByEmails", () => {
  it("resolves oidc_subject, passes it as actorUserId, and sanitizes returned URLs", async () => {
    const listUserAvatarsByEmails = vi
      .fn<() => Promise<MeetRpcResult<{ avatars: MeetUserAvatar[] }>>>()
      .mockResolvedValue({
        ok: true,
        avatars: [
          {
            emailNormalized: "alice@example.com",
            image: "https://lh3.googleusercontent.com/a/alice=s96-c",
          },
          {
            emailNormalized: "unsafe-js@example.com",
            image: "javascript:alert(1)",
          },
          {
            emailNormalized: "unsafe-http@example.com",
            image: "http://example.com/a.png",
          },
          {
            emailNormalized: "unsafe-data@example.com",
            image: "data:image/svg+xml,<svg></svg>",
          },
        ],
      });
    const { db, bound } = fakeUserDb("accounts-u-1");
    const env = {
      DB: db,
      ACCOUNTS_DIRECTORY: { listUserAvatarsByEmails },
    } as unknown as Env;

    const result = await fetchUserAvatarsByEmails(env, "u-1", [
      "Alice@example.com",
      "alice@example.com",
      "unsafe-js@example.com",
      "unsafe-http@example.com",
      "unsafe-data@example.com",
    ]);

    expect(bound).toEqual([["u-1"]]);
    expect(listUserAvatarsByEmails).toHaveBeenCalledWith({
      actorUserId: "accounts-u-1",
      emails: [
        "alice@example.com",
        "unsafe-js@example.com",
        "unsafe-http@example.com",
        "unsafe-data@example.com",
      ],
    });
    expect(result).toEqual(
      new Map([["alice@example.com", "https://lh3.googleusercontent.com/a/alice=s96-c"]]),
    );
  });

  it("returns an empty Map without throwing on missing oidc_subject, RPC error, thrown exception, or absent method", async () => {
    const envMissingSub = {
      DB: fakeUserDb(null).db,
      ACCOUNTS_DIRECTORY: { listUserAvatarsByEmails: vi.fn() },
    } as unknown as Env;
    await expect(
      fetchUserAvatarsByEmails(envMissingSub, "u-1", ["a@example.com"]),
    ).resolves.toEqual(new Map());

    const envRpcFail = {
      DB: fakeUserDb("accounts-u-1").db,
      ACCOUNTS_DIRECTORY: {
        listUserAvatarsByEmails: vi.fn().mockResolvedValue({ ok: false, code: "forbidden" }),
      },
    } as unknown as Env;
    await expect(fetchUserAvatarsByEmails(envRpcFail, "u-1", ["a@example.com"])).resolves.toEqual(
      new Map(),
    );

    const envRpcThrow = {
      DB: fakeUserDb("accounts-u-1").db,
      ACCOUNTS_DIRECTORY: {
        listUserAvatarsByEmails: vi.fn().mockRejectedValue(new Error("worker unavailable")),
      },
    } as unknown as Env;
    await expect(fetchUserAvatarsByEmails(envRpcThrow, "u-1", ["a@example.com"])).resolves.toEqual(
      new Map(),
    );

    const envOldBinding = {
      DB: fakeUserDb("accounts-u-1").db,
      ACCOUNTS_DIRECTORY: {},
    } as unknown as Env;
    await expect(
      fetchUserAvatarsByEmails(envOldBinding, "u-1", ["a@example.com"]),
    ).resolves.toEqual(new Map());
  });
});

describe("listLocalUserAvatarsByEmails", () => {
  it("matches Gmail dot variants, filters unsafe URLs, and chunks > 50 emails", async () => {
    const { db, executedSql } = createLocalUserDb([
      {
        id: "u-gmail",
        email: "first.last@gmail.com",
        image: "https://lh3.googleusercontent.com/a/local-gmail=s96-c",
      },
      {
        id: "u-bad",
        email: "bad@example.com",
        image: "http://example.com/bad.png",
      },
    ]);

    const emails = [
      "firstlast@gmail.com",
      "bad@example.com",
      ...Array.from({ length: 65 }, (_, i) => `extra-${i}@example.com`),
    ];

    const result = await listLocalUserAvatarsByEmails(db, emails);

    expect(result).toEqual(
      new Map([["firstlast@gmail.com", "https://lh3.googleusercontent.com/a/local-gmail=s96-c"]]),
    );
    expect(executedSql).toHaveLength(2);
    for (const sql of executedSql) {
      expect((sql.match(/\?/g) ?? []).length).toBeLessThanOrEqual(50);
    }
  });
});

describe("resolveInviteeAvatars", () => {
  it("merges avatars with precedence: accounts RPC > viewer session image > local D1", async () => {
    const { db } = createLocalUserDb([
      {
        id: "viewer-local",
        email: "viewer@example.com",
        image: "https://lh3.googleusercontent.com/a/viewer-stale=s96-c",
        oidcSubject: "accounts-viewer",
      },
      {
        id: "rpc-user",
        email: "rpc@example.com",
        image: "https://lh3.googleusercontent.com/a/rpc-stale=s96-c",
      },
      {
        id: "local-only",
        email: "local@example.com",
        image: "https://lh3.googleusercontent.com/a/local-only=s96-c",
      },
    ]);

    const listUserAvatarsByEmails = vi.fn().mockResolvedValue({
      ok: true,
      avatars: [
        {
          emailNormalized: "rpc@example.com",
          image: "https://lh3.googleusercontent.com/a/rpc-fresh=s96-c",
        },
      ],
    });

    const env = {
      DB: db,
      ACCOUNTS_DIRECTORY: { listUserAvatarsByEmails },
    } as unknown as Env;

    const resolved = await resolveInviteeAvatars(
      env,
      {
        id: "viewer-local",
        email: "viewer@example.com",
        image: "https://lh3.googleusercontent.com/a/viewer-session=s96-c",
      },
      [
        { emailNormalized: "viewer@example.com" },
        { emailNormalized: "rpc@example.com" },
        { emailNormalized: "local@example.com" },
        { emailNormalized: "external@example.com" },
      ],
    );

    expect(resolved).toEqual(
      new Map([
        ["viewer@example.com", "https://lh3.googleusercontent.com/a/viewer-session=s96-c"],
        ["rpc@example.com", "https://lh3.googleusercontent.com/a/rpc-fresh=s96-c"],
        ["local@example.com", "https://lh3.googleusercontent.com/a/local-only=s96-c"],
      ]),
    );
  });

  it("prefers accounts RPC over viewer session image when accounts returns a fresher URL", async () => {
    const { db } = createLocalUserDb([
      {
        id: "viewer-local",
        email: "viewer@example.com",
        image: "https://lh3.googleusercontent.com/a/viewer-local=s96-c",
        oidcSubject: "accounts-viewer",
      },
    ]);

    const env = {
      DB: db,
      ACCOUNTS_DIRECTORY: {
        listUserAvatarsByEmails: vi.fn().mockResolvedValue({
          ok: true,
          avatars: [
            {
              emailNormalized: "viewer@example.com",
              image: "https://lh3.googleusercontent.com/a/viewer-accounts=s96-c",
            },
          ],
        }),
      },
    } as unknown as Env;

    const resolved = await resolveInviteeAvatars(
      env,
      {
        id: "viewer-local",
        email: "viewer@example.com",
        image: "https://lh3.googleusercontent.com/a/viewer-session=s96-c",
      },
      [{ emailNormalized: "viewer@example.com" }],
    );

    expect(resolved).toEqual(
      new Map([
        ["viewer@example.com", "https://lh3.googleusercontent.com/a/viewer-accounts=s96-c"],
      ]),
    );
  });
});
