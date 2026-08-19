import { describe, expect, it } from "vitest";
import { audienceContains, parseLevelAudienceKey, sourceAudienceKey } from "./audience";

describe("source audience keys", () => {
  it("rejects unknown values and missing chapter ids", () => {
    expect(sourceAudienceKey("future", null)).toBeNull();
    expect(sourceAudienceKey("chapter-member", null)).toBeNull();
    expect(parseLevelAudienceKey("chapter-member:tokyo")).toEqual({
      kind: "chapter-member",
      chapterId: "tokyo",
    });
  });

  it("keeps proven page inclusions only", () => {
    expect(audienceContains({ kind: "member" }, { visibility: "member", access: [] })).toBe(true);
    expect(audienceContains({ kind: "member" }, { visibility: "organizer", access: [] })).toBe(
      true,
    );
    expect(audienceContains({ kind: "organizer" }, { visibility: "member", access: [] })).toBe(
      false,
    );
    expect(audienceContains({ kind: "member" }, { visibility: "public", access: [] })).toBe(false);
  });

  it("fails closed for email and incomparable chapter grants", () => {
    expect(
      audienceContains(
        { kind: "chapter-member", chapterId: "tokyo" },
        { visibility: "restricted", access: [{ subjectType: "email", subjectKey: "a" }] },
      ),
    ).toBe(false);
    expect(
      audienceContains(
        { kind: "chapter-member", chapterId: "tokyo" },
        {
          visibility: "restricted",
          access: [
            { subjectType: "chapter", subjectKey: "tokyo" },
            { subjectType: "chapter", subjectKey: "osaka" },
          ],
        },
      ),
    ).toBe(false);
  });
});
