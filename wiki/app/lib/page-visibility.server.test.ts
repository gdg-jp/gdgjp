import { describe, expect, it, vi } from "vitest";
import { canUserSeePage, canUserSeePageAsync } from "./page-visibility.server";

const publicPage = { id: "p1", visibility: "public", chapterId: "ch1", authorId: "u1" };
const chapterPage = {
  id: "p2",
  visibility: "private_to_chapter",
  chapterId: "ch1",
  authorId: "u1",
};
const leadPage = { id: "p3", visibility: "private_to_lead", chapterId: "ch1", authorId: "u1" };
const restrictedPage = { id: "p4", visibility: "restricted", chapterId: null, authorId: "u1" };

const member = { id: "u2", isAdmin: false, email: "member@example.com" };
const admin = { id: "u3", isAdmin: true, email: "admin@example.com" };
const author = { id: "u1", isAdmin: false, email: "author@example.com" };

// ---------------------------------------------------------------------------
// canUserSeePage (sync)
//
// After moving chapter membership to the accounts IdP, wiki no longer knows
// which chapter a user belongs to locally. The chapter-scoped visibilities
// (private_to_chapter, private_to_lead) collapse to "admin or author only".
// ---------------------------------------------------------------------------

describe("canUserSeePage", () => {
  it("admin can see any page", () => {
    expect(canUserSeePage(admin, restrictedPage)).toBe(true);
    expect(canUserSeePage(admin, publicPage)).toBe(true);
    expect(canUserSeePage(admin, chapterPage)).toBe(true);
    expect(canUserSeePage(admin, leadPage)).toBe(true);
  });

  it("any signed-in user can see a public page", () => {
    expect(canUserSeePage(member, publicPage)).toBe(true);
  });

  it("author can see their own page regardless of visibility", () => {
    expect(canUserSeePage(author, restrictedPage)).toBe(true);
    expect(canUserSeePage(author, leadPage)).toBe(true);
    expect(canUserSeePage(author, chapterPage)).toBe(true);
  });

  it("non-author non-admin cannot see chapter-scoped pages (no per-user chapter info post-SSO)", () => {
    expect(canUserSeePage(member, chapterPage)).toBe(false);
    expect(canUserSeePage(member, leadPage)).toBe(false);
  });

  it("returns false for restricted page (sync — conservative fallback)", () => {
    expect(canUserSeePage(member, restrictedPage)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canUserSeePageAsync
// ---------------------------------------------------------------------------

describe("canUserSeePageAsync", () => {
  it("non-restricted page delegates to canUserSeePage", async () => {
    const db = {};
    expect(await canUserSeePageAsync(db as never, member, publicPage)).toBe(true);
    expect(await canUserSeePageAsync(db as never, member, chapterPage)).toBe(false);
  });

  it("admin can see restricted page without DB lookup", async () => {
    const db = { select: vi.fn() };
    expect(await canUserSeePageAsync(db as never, admin, restrictedPage)).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("author can see their own restricted page without DB lookup", async () => {
    const db = { select: vi.fn() };
    expect(await canUserSeePageAsync(db as never, author, restrictedPage)).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("user with page_access entry can see restricted page", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ id: "a1", pageRole: "viewer" }),
          }),
        }),
      }),
      update: vi.fn(),
    };
    expect(await canUserSeePageAsync(db as never, member, restrictedPage)).toBe(true);
  });

  it("user without page_access entry cannot see restricted page", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
      update: vi.fn(),
    };
    expect(await canUserSeePageAsync(db as never, member, restrictedPage)).toBe(false);
  });
});
