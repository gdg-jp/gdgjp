import { describe, expect, it } from "vitest";
import { canApproveTarget, rollupItemStatus } from "./target";

const chapters = [{ chapterId: 1, chapterSlug: "kwansai", role: "organizer" as const }];

describe("canApproveTarget", () => {
  it("lets members of the account's chapter approve, nobody else", () => {
    expect(canApproveTarget({ chapterId: 1 }, { chapters, isMember: false, isAdmin: false })).toBe(
      true,
    );
    // The host chapter's lead is not in the co-host chapter.
    expect(canApproveTarget({ chapterId: 2 }, { chapters, isMember: true, isAdmin: false })).toBe(
      false,
    );
    expect(canApproveTarget({ chapterId: 2 }, { chapters, isMember: true, isAdmin: true })).toBe(
      false,
    );
  });
  it("needs campaign membership for a plain chapter member", () => {
    const member = [{ chapterId: 2, chapterSlug: "osaka", role: "member" as const }];
    expect(
      canApproveTarget({ chapterId: 2 }, { chapters: member, isMember: false, isAdmin: false }),
    ).toBe(false);
    expect(
      canApproveTarget({ chapterId: 2 }, { chapters: member, isMember: true, isAdmin: false }),
    ).toBe(true);
  });
});

describe("rollupItemStatus", () => {
  it("waits for every target", () => {
    expect(rollupItemStatus([])).toBeNull();
    expect(rollupItemStatus(["scheduled", "pending"])).toBeNull();
    expect(rollupItemStatus(["scheduled", "delegated"])).toBe("scheduled");
    expect(rollupItemStatus(["done", "skipped", "delegated"])).toBe("done");
    expect(rollupItemStatus(["failed", "scheduled"])).toBe("failed");
    expect(rollupItemStatus(["failed", "dispatching"])).toBeNull();
  });
});
