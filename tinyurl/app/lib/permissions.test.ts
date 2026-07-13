import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import type { Link, LinkPermission } from "./db";
import { canEditLink, canViewLink } from "./permissions";

const owner: AuthUser = {
  id: "u_owner",
  email: "owner@example.com",
  name: "Owner",
  image: null,
  isAdmin: false,
};
const stranger: AuthUser = {
  id: "u_stranger",
  email: "stranger@example.com",
  name: "Stranger",
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

const LINK_ID = "link_01ARZ3NDEKTSV4RRFFQ69G5FAV";

const link: Link = {
  id: LINK_ID,
  slug: "abc",
  destinationUrl: "https://example.com",
  title: null,
  description: null,
  ogImageUrl: null,
  ownerUserId: "u_owner",
  ownerChapterId: null,
  campaignMediaId: null,
  creativeName: null,
  visibility: "private",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

function perm(overrides: Partial<LinkPermission>): LinkPermission {
  return {
    id: 1,
    linkId: LINK_ID,
    principalType: "user",
    principalId: "stranger@example.com",
    role: "viewer",
    createdAt: 0,
    ...overrides,
  };
}

describe("canViewLink / canEditLink", () => {
  it("owner can view and edit", () => {
    const ctx = { user: owner, chapterId: null };
    expect(canViewLink(ctx, link, [])).toBe(true);
    expect(canEditLink(ctx, link, [])).toBe(true);
  });

  it("super-admin can view and edit any link", () => {
    const ctx = { user: admin, chapterId: null };
    expect(canViewLink(ctx, link, [])).toBe(true);
    expect(canEditLink(ctx, link, [])).toBe(true);
  });

  it("stranger with no perms cannot view or edit", () => {
    const ctx = { user: stranger, chapterId: null };
    expect(canViewLink(ctx, link, [])).toBe(false);
    expect(canEditLink(ctx, link, [])).toBe(false);
  });

  it("user perm by email grants viewer", () => {
    const ctx = { user: stranger, chapterId: null };
    const perms = [perm({ role: "viewer" })];
    expect(canViewLink(ctx, link, perms)).toBe(true);
    expect(canEditLink(ctx, link, perms)).toBe(false);
  });

  it("user perm by email grants editor", () => {
    const ctx = { user: stranger, chapterId: null };
    const perms = [perm({ role: "editor" })];
    expect(canViewLink(ctx, link, perms)).toBe(true);
    expect(canEditLink(ctx, link, perms)).toBe(true);
  });

  it("chapter perm grants viewer to all chapter members", () => {
    const ctx = { user: stranger, chapterId: 42 };
    const perms = [perm({ principalType: "chapter", principalId: "42", role: "viewer" })];
    expect(canViewLink(ctx, link, perms)).toBe(true);
    expect(canEditLink(ctx, link, perms)).toBe(false);
  });

  it("chapter perm does not match a different chapter", () => {
    const ctx = { user: stranger, chapterId: 99 };
    const perms = [perm({ principalType: "chapter", principalId: "42", role: "editor" })];
    expect(canViewLink(ctx, link, perms)).toBe(false);
    expect(canEditLink(ctx, link, perms)).toBe(false);
  });

  it("chapter-owned link grants view and edit to chapter members", () => {
    const ctx = { user: stranger, chapterId: 7 };
    const chapterLink: Link = { ...link, ownerChapterId: 7 };
    expect(canViewLink(ctx, chapterLink, [])).toBe(true);
    expect(canEditLink(ctx, chapterLink, [])).toBe(true);
  });

  it("editor permission overrides a viewer permission on the same link", () => {
    const ctx = { user: stranger, chapterId: 42 };
    const perms = [
      perm({ id: 1, principalType: "chapter", principalId: "42", role: "viewer" }),
      perm({ id: 2, principalType: "user", principalId: "stranger@example.com", role: "editor" }),
    ];
    expect(canEditLink(ctx, link, perms)).toBe(true);
  });

  it("public link is viewable to any signed-in member but not editable", () => {
    const ctx = { user: stranger, chapterId: 42 };
    const publicLink: Link = { ...link, visibility: "public" };
    expect(canViewLink(ctx, publicLink, [])).toBe(true);
    expect(canEditLink(ctx, publicLink, [])).toBe(false);
  });

  it("public link still grants editor via explicit perm", () => {
    const ctx = { user: stranger, chapterId: 42 };
    const publicLink: Link = { ...link, visibility: "public" };
    const perms = [perm({ role: "editor" })];
    expect(canEditLink(ctx, publicLink, perms)).toBe(true);
  });

  it("private link without perms still hidden from non-members", () => {
    const ctx = { user: stranger, chapterId: 42 };
    expect(canViewLink(ctx, link, [])).toBe(false);
  });
});
