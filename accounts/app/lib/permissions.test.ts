import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import type { Membership } from "./db";
import {
  canManageChapter,
  canManageChapters,
  requireOrganizerOf,
  requireSuperAdmin,
} from "./permissions";

const admin: AuthUser = { id: "u_admin", email: "a@x", name: "A", image: null, isAdmin: true };
const member: AuthUser = { id: "u_member", email: "m@x", name: "M", image: null, isAdmin: false };

const activeOrganizerOf1: Membership = {
  userId: "u_member",
  chapterId: 1,
  role: "organizer",
  status: "active",
  createdAt: 0,
  approvedAt: 1,
};

const pendingOrganizerOf1: Membership = {
  ...activeOrganizerOf1,
  status: "pending",
  approvedAt: null,
};

const activeMemberOf1: Membership = { ...activeOrganizerOf1, role: "member" };

describe("canManageChapters", () => {
  it("only super-admins can manage chapters", () => {
    expect(canManageChapters(admin)).toBe(true);
    expect(canManageChapters(member)).toBe(false);
  });
});

describe("canManageChapter", () => {
  it("super-admin can manage any chapter", () => {
    expect(canManageChapter(admin, 1, null)).toBe(true);
    expect(canManageChapter(admin, 99, null)).toBe(true);
  });

  it("active organizer of the chapter can manage it", () => {
    expect(canManageChapter(member, 1, activeOrganizerOf1)).toBe(true);
  });

  it("organizer of a different chapter cannot manage", () => {
    expect(canManageChapter(member, 2, activeOrganizerOf1)).toBe(false);
  });

  it("pending organizer cannot manage", () => {
    expect(canManageChapter(member, 1, pendingOrganizerOf1)).toBe(false);
  });

  it("active member (not organizer) cannot manage", () => {
    expect(canManageChapter(member, 1, activeMemberOf1)).toBe(false);
  });

  it("user with no membership cannot manage", () => {
    expect(canManageChapter(member, 1, null)).toBe(false);
  });
});

describe("requireSuperAdmin", () => {
  it("returns void for super-admins", () => {
    expect(() => requireSuperAdmin(admin)).not.toThrow();
  });

  it("throws 403 for non-admins", () => {
    try {
      requireSuperAdmin(member);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
  });
});

describe("requireOrganizerOf", () => {
  it("passes for super-admin even without membership", () => {
    expect(() => requireOrganizerOf(admin, 1, null)).not.toThrow();
  });

  it("throws 403 for member of the wrong chapter", () => {
    try {
      requireOrganizerOf(member, 2, {
        ...activeOrganizerOf1,
        chapter: { id: 1, slug: "a", name: "A", kind: "gdg", createdAt: 0 },
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
  });
});
