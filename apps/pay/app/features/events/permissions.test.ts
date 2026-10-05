import { describe, expect, it } from "vitest";
import { canProxyForEvent } from "./permissions";

describe("canProxyForEvent", () => {
  const event = { ownerUserId: "owner-1", ownerChapterIds: [10, 20] };

  it("allows the event owner", () => {
    expect(
      canProxyForEvent(
        { userId: "owner-1", chapters: [{ chapterId: 99, chapterSlug: "x", role: "member" }] },
        event,
      ),
    ).toBe(true);
  });

  it("allows organizers of snapshotted chapters", () => {
    expect(
      canProxyForEvent(
        {
          userId: "org-1",
          chapters: [{ chapterId: 20, chapterSlug: "osaka", role: "organizer" }],
        },
        event,
      ),
    ).toBe(true);
  });

  it("denies plain members of snapshotted chapters", () => {
    expect(
      canProxyForEvent(
        {
          userId: "member-1",
          chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "member" }],
        },
        event,
      ),
    ).toBe(false);
  });
});
