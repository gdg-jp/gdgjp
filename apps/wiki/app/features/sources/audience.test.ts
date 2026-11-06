import { canAccessSource } from "@gdgjp/gdg-lib/acl";
import { describe, expect, it } from "vitest";
import { readableAudienceKeys, sourceAudience } from "./audience";

const visibilities = ["private", "member", "organizer", "chapter-member", "chapter-organizer"];
const chapterSets = [
  [],
  [{ chapterId: "tokyo", role: "member" }],
  [{ chapterId: "tokyo", role: "organizer" }],
  [{ chapterId: "osaka", role: "member" }],
  [
    { chapterId: "osaka", role: "organizer" },
    { chapterId: "tokyo", role: "member" },
  ],
];

describe("audience keys agree with canAccessSource", () => {
  it("for every visibility × membership (sources added by someone else)", () => {
    const reader = { id: "reader", isAdmin: false };
    for (const visibility of visibilities) {
      const source = {
        visibility,
        chapterId: visibility.startsWith("chapter-") ? "tokyo" : null,
        addedBy: "owner",
      };
      for (const chapters of chapterSets) {
        const keys = readableAudienceKeys(reader, chapters);
        expect(
          keys !== "all" && keys.includes(sourceAudience(source)),
          `${visibility} / ${JSON.stringify(chapters)}`,
        ).toBe(canAccessSource(source, reader, chapters));
      }
    }
  });

  it("lets the adder read their private source and admins read everything", () => {
    const source = { visibility: "private", chapterId: null, addedBy: "reader" };
    const keys = readableAudienceKeys({ id: "reader" }, []);
    expect(keys !== "all" && keys.includes(sourceAudience(source))).toBe(true);
    expect(readableAudienceKeys({ id: "x", isAdmin: true }, [])).toBe("all");
  });

  it("fails closed for anonymous readers and malformed sources", () => {
    expect(readableAudienceKeys(null, [])).toEqual([]);
    expect(sourceAudience({ visibility: "chapter-member", chapterId: null, addedBy: "o" })).toBe(
      "none",
    );
  });
});
