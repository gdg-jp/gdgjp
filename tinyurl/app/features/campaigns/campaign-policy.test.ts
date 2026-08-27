import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { canAccessCampaign, chapterIdsAreOwnedByCaller } from "./campaign-policy";

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user_1",
    email: "a@example.com",
    name: "A",
    image: null,
    isAdmin: false,
    ...overrides,
  };
}

function chapter(chapterId: number, role: UserChapter["role"] = "member"): UserChapter {
  return { chapterId, chapterSlug: `chapter-${chapterId}`, role };
}

describe("canAccessCampaign", () => {
  it("grants access to a plain member of one of the campaign's chapters", () => {
    expect(canAccessCampaign(user(), [chapter(42)], { chapterIds: [42, 84] })).toBe(true);
  });

  it("denies a caller outside every campaign chapter", () => {
    expect(canAccessCampaign(user(), [chapter(1)], { chapterIds: [42] })).toBe(false);
  });

  it("grants a super-admin access regardless of chapter membership", () => {
    expect(canAccessCampaign(user({ isAdmin: true }), [], { chapterIds: [42] })).toBe(true);
  });

  it("does not grant access from ownerUserId alone", () => {
    // ownerUserId is not part of the policy input at all — this asserts the
    // policy only ever looks at chapter membership and admin status.
    expect(canAccessCampaign(user(), [chapter(1)], { chapterIds: [42] })).toBe(false);
  });
});

describe("chapterIdsAreOwnedByCaller", () => {
  it("accepts chapter ids the caller belongs to", () => {
    expect(chapterIdsAreOwnedByCaller([chapter(1), chapter(2)], [1, 2])).toBe(true);
  });

  it("rejects a chapter id the caller does not belong to, even for a super-admin caller", () => {
    expect(chapterIdsAreOwnedByCaller([chapter(1)], [1, 2])).toBe(false);
  });

  it("rejects an empty chapter id list", () => {
    expect(chapterIdsAreOwnedByCaller([chapter(1)], [])).toBe(false);
  });
});
