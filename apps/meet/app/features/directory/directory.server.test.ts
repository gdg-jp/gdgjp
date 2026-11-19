import type { ListChapterMembersInput, MeetDirectoryMember, MeetRpcResult } from "@gdgjp/gdg-lib";
import { describe, expect, it, vi } from "vitest";
import type { ChapterSummary } from "./directory";
import { DirectoryError, fetchChapterMembers, fetchChaptersDirectory } from "./directory.server";

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
