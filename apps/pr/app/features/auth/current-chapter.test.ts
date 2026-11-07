import { describe, expect, it } from "vitest";
import { CHAPTER_COOKIE, chapterLabel, pickChapter } from "./current-chapter";

const chapters = [
  { chapterId: 1, chapterSlug: "gdg-kwansai", role: "organizer" as const },
  { chapterId: 2, chapterSlug: "gdg-kyoto", role: "member" as const },
];

describe("pickChapter", () => {
  it("uses the cookie's chapter while the user is in it", () => {
    expect(pickChapter(`a=1; ${CHAPTER_COOKIE}=2`, chapters)?.chapterId).toBe(2);
  });
  it("falls back to the first membership", () => {
    expect(pickChapter(`${CHAPTER_COOKIE}=9`, chapters)?.chapterId).toBe(1);
    expect(pickChapter(null, chapters)?.chapterId).toBe(1);
    expect(pickChapter(null, [])).toBeNull();
  });
});

describe("chapterLabel", () => {
  it("reads like a name", () => {
    expect(chapterLabel("gdg-kwansai")).toBe("GDG Kwansai");
    expect(chapterLabel("gdg-cloud-tokyo")).toBe("GDG Cloud Tokyo");
  });
});
