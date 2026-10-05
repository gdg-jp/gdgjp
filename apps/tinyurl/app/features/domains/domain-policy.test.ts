import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { canManageChapterDomains } from "./domain-policy";

const owner: AuthUser = {
  id: "u_owner",
  email: "owner@example.com",
  name: "Owner",
  image: null,
  isAdmin: false,
};
const admin: AuthUser = {
  id: "u_admin",
  email: "admin@example.com",
  name: "Admin",
  image: null,
  isAdmin: true,
};

describe("canManageChapterDomains", () => {
  it("allows organizers and superadmins, but not ordinary members", () => {
    expect(
      canManageChapterDomains(owner, { chapterId: 1, chapterSlug: "tokyo", role: "organizer" }),
    ).toBe(true);
    expect(
      canManageChapterDomains(owner, { chapterId: 1, chapterSlug: "tokyo", role: "member" }),
    ).toBe(false);
    expect(
      canManageChapterDomains(admin, { chapterId: 1, chapterSlug: "tokyo", role: "member" }),
    ).toBe(true);
  });
});
