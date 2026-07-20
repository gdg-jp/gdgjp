import { describe, expect, it } from "vitest";
import {
  type PagePermissionSubject,
  canUserGrantRole,
  evaluatePagePermissions,
  normalizeEmail,
} from "./page-access.server";

const page: PagePermissionSubject = {
  id: "page-1",
  authorId: "author-1",
  visibility: "restricted",
  generalRole: "viewer",
};
const member = { id: "member-1", email: "member@example.com", isAdmin: false };

describe("evaluatePagePermissions", () => {
  it("keeps restricted pages inaccessible without an explicit grant", () => {
    expect(evaluatePagePermissions(page, member)).toMatchObject({
      role: null,
      canView: false,
      canComment: false,
      canEdit: false,
      canManageSharing: false,
    });
  });

  it("makes unlisted/public pages anonymous read-only", () => {
    for (const visibility of ["unlisted", "public"]) {
      expect(evaluatePagePermissions({ ...page, visibility, generalRole: "editor" }, null)).toEqual(
        {
          role: "viewer",
          canView: true,
          canComment: false,
          canEdit: false,
          canManageSharing: false,
          source: "general",
        },
      );
    }
  });

  it("applies general commenter/editor only to signed-in users", () => {
    expect(
      evaluatePagePermissions({ ...page, visibility: "public", generalRole: "commenter" }, member),
    ).toMatchObject({ role: "commenter", canView: true, canComment: true, canEdit: false });
    expect(
      evaluatePagePermissions({ ...page, visibility: "unlisted", generalRole: "editor" }, member),
    ).toMatchObject({ role: "editor", canComment: true, canEdit: true, canManageSharing: false });
  });

  it("uses the strongest explicit email/chapter role", () => {
    expect(
      evaluatePagePermissions(page, member, [
        { role: "viewer", source: "email" },
        { role: "commenter", source: "chapter" },
        { role: "editor", source: "chapter" },
      ]),
    ).toMatchObject({ role: "editor", source: "chapter", canEdit: true, canManageSharing: true });
  });

  it("does not let a general editor manage sharing without an explicit editor grant", () => {
    expect(
      evaluatePagePermissions({ ...page, visibility: "public", generalRole: "editor" }, member, [
        { role: "viewer", source: "email" },
      ]),
    ).toMatchObject({ role: "editor", source: "general", canManageSharing: false });
  });

  it("always gives authors and admins implicit ownership", () => {
    expect(evaluatePagePermissions(page, { ...member, id: "author-1" })).toMatchObject({
      role: "owner",
      source: "owner",
      canManageSharing: true,
    });
    expect(evaluatePagePermissions(page, { ...member, isAdmin: true })).toMatchObject({
      role: "owner",
      source: "admin",
      canManageSharing: true,
    });
  });
});

describe("share policy helpers", () => {
  it("only lets an owner/editor or admin grant supported roles", () => {
    expect(canUserGrantRole("editor", false, "viewer")).toBe(true);
    expect(canUserGrantRole("viewer", false, "editor")).toBe(false);
    expect(canUserGrantRole(null, true, "editor")).toBe(true);
  });

  it("normalizes email subject keys", () => {
    expect(normalizeEmail("  Member@Example.COM ")).toBe("member@example.com");
  });
});
