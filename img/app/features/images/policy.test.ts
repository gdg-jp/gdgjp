import { describe, expect, it } from "vitest";
import { resolveActorChapter } from "./policy";

function chapter(chapterId: number) {
  return { chapterId, chapterSlug: `chapter-${chapterId}`, role: "member" as const };
}

describe("resolveActorChapter", () => {
  it("rejects a caller with no chapter memberships", () => {
    expect(resolveActorChapter([], null)).toEqual({ ok: false, error: "forbidden" });
    expect(resolveActorChapter([], 1)).toEqual({ ok: false, error: "forbidden" });
  });

  it("uses the sole membership when none is requested", () => {
    expect(resolveActorChapter([chapter(5)], null)).toEqual({ ok: true, chapterId: 5 });
  });

  it("requires an explicit choice with multiple memberships", () => {
    expect(resolveActorChapter([chapter(1), chapter(2)], null)).toEqual({
      ok: false,
      error: "chapter_required",
    });
  });

  it("accepts a requested chapter that is a membership", () => {
    expect(resolveActorChapter([chapter(1), chapter(2)], 2)).toEqual({ ok: true, chapterId: 2 });
  });

  it("rejects a requested chapter the caller does not belong to", () => {
    expect(resolveActorChapter([chapter(1)], 99)).toEqual({ ok: false, error: "forbidden" });
  });
});
