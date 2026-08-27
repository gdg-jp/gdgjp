import type { UserChapter } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { listAccessibleChapters } from "./db.server";

/** D1 fake that only answers `contributorChapterIds`'s single query. */
function makeDb(contributorChapterIds: number[]) {
  return {
    prepare(_sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        all: async () => ({ results: contributorChapterIds.map((id) => ({ chapter_id: id })) }),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

const organizerOf = (chapterId: number): UserChapter => ({
  chapterId,
  chapterSlug: `gdg-${chapterId}`,
  role: "organizer",
});
const memberOf = (chapterId: number): UserChapter => ({
  chapterId,
  chapterSlug: `gdg-${chapterId}`,
  role: "member",
});

describe("listAccessibleChapters", () => {
  it("keeps organizer chapters and drops plain member chapters for a normal user", async () => {
    const chapters = await listAccessibleChapters(makeDb([]), "u@example.com", [
      organizerOf(1),
      memberOf(2),
    ]);
    expect(chapters.map((c) => c.chapterId)).toEqual([1]);
  });

  it("synthesizes a contributor chapter the user is not a member of", async () => {
    const chapters = await listAccessibleChapters(makeDb([9]), "u@example.com", [memberOf(2)]);
    expect(chapters).toEqual([{ chapterId: 9, chapterSlug: "chapter-9", role: "contributor" }]);
  });

  it("keeps every membership for a super-admin, including plain member chapters", async () => {
    const chapters = await listAccessibleChapters(
      makeDb([]),
      "admin@example.com",
      [organizerOf(1), memberOf(2)],
      true,
    );
    expect(chapters.map((c) => c.chapterId).sort()).toEqual([1, 2]);
    expect(chapters.find((c) => c.chapterId === 2)?.role).toBe("member");
  });
});
