import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { canAccessImage, canShareImageWithChapter, resolveActorChapter } from "./policy";
import type { ImageRow } from "./repository";

function chapter(chapterId: number) {
  return { chapterId, chapterSlug: `chapter-${chapterId}`, role: "member" as const };
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "u1@example.com",
    name: "U1",
    image: null,
    isAdmin: false,
    ...overrides,
  };
}

function image(overrides: Partial<ImageRow> = {}): ImageRow {
  return {
    id: "img12345",
    userId: "u1",
    accountId: "u1",
    chapterId: 1,
    folderId: null,
    slug: null,
    r2Key: "img12345",
    contentType: "image/png",
    byteSize: 100,
    width: null,
    height: null,
    filename: null,
    mobileR2Key: null,
    mobileContentType: null,
    mobileByteSize: null,
    mobileFilename: null,
    mobileUpdatedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("canAccessImage", () => {
  it("allows the uploader", () => {
    const actor = { user: user({ id: "owner" }), chapters: [] };
    expect(canAccessImage(actor, image({ userId: "owner", chapterId: 99 }))).toBe(true);
  });

  it("allows a super admin regardless of chapter", () => {
    const actor = { user: user({ id: "admin", isAdmin: true }), chapters: [] };
    expect(canAccessImage(actor, image({ userId: "someone-else", chapterId: 99 }))).toBe(true);
  });

  it("allows a member of the image's chapter", () => {
    const actor = { user: user({ id: "member" }), chapters: [chapter(5)] };
    expect(canAccessImage(actor, image({ userId: "someone-else", chapterId: 5 }))).toBe(true);
  });

  it("allows a member who belongs to several chapters, one of which matches", () => {
    const actor = { user: user({ id: "member" }), chapters: [chapter(1), chapter(5)] };
    expect(canAccessImage(actor, image({ userId: "someone-else", chapterId: 5 }))).toBe(true);
  });

  it("rejects a non-owner, non-admin, non-member of the image's chapter", () => {
    const actor = { user: user({ id: "outsider" }), chapters: [chapter(1)] };
    expect(canAccessImage(actor, image({ userId: "someone-else", chapterId: 5 }))).toBe(false);
  });
});

describe("canShareImageWithChapter", () => {
  it("allows a member of the destination chapter", () => {
    const actor = { user: user(), chapters: [chapter(1), chapter(5)] };
    expect(canShareImageWithChapter(actor, 5)).toBe(true);
  });

  it("allows a super admin to target a chapter they don't belong to", () => {
    const actor = { user: user({ isAdmin: true }), chapters: [chapter(1)] };
    expect(canShareImageWithChapter(actor, 99)).toBe(true);
  });

  it("rejects a non-admin targeting a chapter they don't belong to", () => {
    const actor = { user: user({ isAdmin: false }), chapters: [chapter(1)] };
    expect(canShareImageWithChapter(actor, 99)).toBe(false);
  });
});

describe("resolveActorChapter", () => {
  it("rejects a caller with no chapter memberships", () => {
    expect(resolveActorChapter([], null)).toEqual({ ok: false, error: "forbidden" });
    expect(resolveActorChapter([], 1)).toEqual({ ok: false, error: "forbidden" });
  });

  it("uses the sole membership when none is requested", () => {
    expect(resolveActorChapter([chapter(5)], null)).toEqual({ ok: true, chapterId: 5 });
  });

  it("requires an explicit choice with multiple memberships", () => {
    expect(resolveActorChapter([chapter(1), chapter(2)], null)).toEqual({
      ok: false,
      error: "chapter_required",
    });
  });

  it("accepts a requested chapter that is a membership", () => {
    expect(resolveActorChapter([chapter(1), chapter(2)], 2)).toEqual({ ok: true, chapterId: 2 });
  });

  it("rejects a requested chapter the caller does not belong to", () => {
    expect(resolveActorChapter([chapter(1)], 99)).toEqual({ ok: false, error: "forbidden" });
  });
});
