import { describe, expect, it, vi } from "vitest";
import { canUserSeePage, canUserSeePageAsync } from "./page-visibility.server";

const publicPage = {
  id: "p1",
  visibility: "public",
  generalRole: "viewer",
  authorId: "u1",
};
const unlistedPage = {
  id: "p2",
  visibility: "unlisted",
  generalRole: "editor",
  authorId: "u1",
};
const restrictedPage = {
  id: "p3",
  visibility: "restricted",
  generalRole: "viewer",
  authorId: "u1",
};

const member = { id: "u2", isAdmin: false, email: "member@example.com" };
const admin = { id: "u3", isAdmin: true, email: "admin@example.com" };
const author = { id: "u1", isAdmin: false, email: "author@example.com" };

describe("canUserSeePage", () => {
  it("allows anonymous visitors to view public and unlisted pages", () => {
    expect(canUserSeePage(null, publicPage)).toBe(true);
    expect(canUserSeePage(null, unlistedPage)).toBe(true);
  });

  it("keeps restricted pages private without an explicit lookup", () => {
    expect(canUserSeePage(null, restrictedPage)).toBe(false);
    expect(canUserSeePage(member, restrictedPage)).toBe(false);
  });

  it("allows admins and authors without a database lookup", () => {
    expect(canUserSeePage(admin, restrictedPage)).toBe(true);
    expect(canUserSeePage(author, restrictedPage)).toBe(true);
  });
});

function mockExplicitRows(rows: Array<{ subjectType: string; role: string }>) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

describe("canUserSeePageAsync", () => {
  it("does not query grants when direct access already applies", async () => {
    const db = { select: vi.fn() };
    expect(await canUserSeePageAsync(db as never, member, publicPage)).toBe(true);
    expect(await canUserSeePageAsync(db as never, admin, restrictedPage)).toBe(true);
    expect(await canUserSeePageAsync(db as never, author, restrictedPage)).toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("allows a matching email grant on a restricted page", async () => {
    const db = mockExplicitRows([{ subjectType: "email", role: "viewer" }]);
    expect(await canUserSeePageAsync(db as never, member, restrictedPage)).toBe(true);
  });

  it("allows a matching Chapter grant on a restricted page", async () => {
    const db = mockExplicitRows([{ subjectType: "chapter", role: "commenter" }]);
    expect(await canUserSeePageAsync(db as never, member, restrictedPage, [42])).toBe(true);
  });

  it("denies a user without a matching grant", async () => {
    const db = mockExplicitRows([]);
    expect(await canUserSeePageAsync(db as never, member, restrictedPage)).toBe(false);
  });
});
