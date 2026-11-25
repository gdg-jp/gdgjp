import { describe, expect, it } from "vitest";
import { canProxyForEvent, canViewEventTotal } from "./permissions";

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

describe("canViewEventTotal", () => {
  const event = { ownerUserId: "owner-1", ownerChapterIds: [10, 20] };

  it("allows the event owner even outside the event's chapters", () => {
    expect(
      canViewEventTotal(
        { userId: "owner-1", chapters: [{ chapterId: 99, chapterSlug: "x", role: "member" }] },
        event,
      ),
    ).toBe(true);
  });

  it("allows plain members and organizers of the event's chapters", () => {
    for (const role of ["member", "organizer"] as const) {
      expect(
        canViewEventTotal(
          { userId: "member-1", chapters: [{ chapterId: 20, chapterSlug: "osaka", role }] },
          event,
        ),
      ).toBe(true);
    }
  });

  it("denies members and organizers of other chapters", () => {
    for (const role of ["member", "organizer"] as const) {
      expect(
        canViewEventTotal(
          { userId: "other-1", chapters: [{ chapterId: 30, chapterSlug: "kyoto", role }] },
          event,
        ),
      ).toBe(false);
    }
  });
});
