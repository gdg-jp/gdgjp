import type { AuthUser } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceVisibility } from "~/lib/sources-shared";
import {
  canAccessSource,
  canAssignSourceVisibility,
  parseSourceVisibilitySelection,
  updateSourceVisibility,
} from "~/lib/sources.server";

const updateMock = vi.fn();
const getMock = vi.fn();

vi.mock("~/lib/db.server", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: getMock,
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => updateMock(values),
      }),
    }),
  }),
}));

const ADMIN = { id: "admin", isAdmin: true } as AuthUser;
const OWNER = { id: "owner", isAdmin: false } as AuthUser;
const MEMBER = { id: "member", isAdmin: false } as AuthUser;
const OUTSIDER = { id: "outsider", isAdmin: false } as AuthUser;

const OSAKA = { chapterId: "chapter-osaka", role: "member" };
const TOKYO_ORG = { chapterId: 42, role: "organizer" };

function source(overrides: {
  addedBy?: string;
  chapterId?: string | null;
  visibility: string;
}) {
  return {
    addedBy: overrides.addedBy ?? "owner",
    chapterId: overrides.chapterId ?? null,
    visibility: overrides.visibility,
  };
}

function oldCanAccess(
  row: { addedBy: string; chapterId: string | null },
  user: AuthUser,
  chapterIds: readonly string[],
): boolean {
  if (user.isAdmin) return true;
  if (row.addedBy === user.id) return true;
  if (row.chapterId === null) return true;
  return chapterIds.includes(row.chapterId);
}

function migratedVisibility(chapterId: string | null): SourceVisibility {
  return chapterId === null ? "member" : "chapter-member";
}

describe("canAccessSource", () => {
  it("rejects unknown visibility values", () => {
    expect(canAccessSource(source({ visibility: "future-level" }), MEMBER, [OSAKA])).toBe(false);
  });

  it("denies organizer sources when claims are unavailable", () => {
    expect(canAccessSource(source({ visibility: "organizer" }), MEMBER, [])).toBe(false);
  });

  it("matches chapter ids across number and string claims", () => {
    expect(
      canAccessSource(source({ visibility: "chapter-member", chapterId: "42" }), MEMBER, [
        TOKYO_ORG,
      ]),
    ).toBe(true);
  });

  it("preserves pre-migration access for backfilled rows, for users with some chapter", () => {
    // Fail-closed `member` (chapters.length > 0, see below) is a deliberate departure from
    // pre-migration behavior for signed-in users with no chapter at all — excluded here on
    // purpose, not an oversight. Equivalence still holds for everyone else.
    const cases = [
      { user: ADMIN, chapterIds: [] as string[], chapters: [] as const },
      { user: OWNER, chapterIds: [], chapters: [] },
      {
        user: MEMBER,
        chapterIds: ["chapter-osaka"],
        chapters: [OSAKA],
      },
    ] as const;

    for (const chapterId of [null, "chapter-osaka"] as const) {
      const row = { addedBy: "owner", chapterId };
      const visibility = migratedVisibility(chapterId);
      for (const { user, chapterIds, chapters } of cases) {
        const legacy = oldCanAccess(row, user, chapterIds);
        const next = canAccessSource({ ...row, visibility }, user, chapters);
        expect(next).toBe(legacy);
      }
    }
  });

  it("denies member-visibility sources to a signed-in user with no chapter membership", () => {
    // Pre-migration, a chapter_id-IS-NULL source was visible to every signed-in user
    // unconditionally. `member` is fail-closed instead: it means "belongs to at least one
    // chapter," not "is signed in." This intentionally breaks equivalence for outsiders.
    expect(canAccessSource(source({ visibility: "member" }), OUTSIDER, [])).toBe(false);
    expect(canAccessSource(source({ visibility: "member" }), OUTSIDER, [OSAKA])).toBe(true);
  });

  it("blocks non-organizers from organizer-only sources", () => {
    expect(canAccessSource(source({ visibility: "organizer" }), MEMBER, [OSAKA])).toBe(false);
    expect(canAccessSource(source({ visibility: "organizer" }), MEMBER, [TOKYO_ORG])).toBe(true);
  });

  it("blocks everyone except owner and admin from private sources", () => {
    const privateSource = source({ visibility: "private" });
    expect(canAccessSource(privateSource, ADMIN, [])).toBe(true);
    expect(canAccessSource(privateSource, OWNER, [])).toBe(true);
    expect(canAccessSource(privateSource, MEMBER, [OSAKA])).toBe(false);
  });
});

describe("parseSourceVisibilitySelection", () => {
  it("requires an explicit visibility", () => {
    expect(parseSourceVisibilitySelection("", null)).toEqual({
      ok: false,
      error: "invalid_visibility",
    });
  });

  it("requires a chapter for chapter-scoped visibility", () => {
    expect(parseSourceVisibilitySelection("chapter-member", null)).toEqual({
      ok: false,
      error: "chapter_required",
    });
  });
});

describe("canAssignSourceVisibility", () => {
  it("allows any signed-in user to pick private, member, or organizer", () => {
    for (const visibility of ["private", "member", "organizer"] as const) {
      expect(canAssignSourceVisibility(visibility, null, OUTSIDER, [])).toBe(true);
    }
  });

  it("rejects chapter scopes the user does not belong to", () => {
    expect(canAssignSourceVisibility("chapter-member", "chapter-tokyo", MEMBER, [OSAKA])).toBe(
      false,
    );
  });
});

describe("updateSourceVisibility", () => {
  beforeEach(() => {
    getMock.mockReset();
    updateMock.mockReset().mockResolvedValue(undefined);
  });

  it("returns forbidden when the caller is neither owner nor admin", async () => {
    getMock.mockResolvedValue({ addedBy: "owner" });
    const result = await updateSourceVisibility({} as Env, "src-1", {
      visibility: "member",
      chapter: null,
      user: MEMBER,
      chapters: [OSAKA],
    });
    expect(result).toEqual({ ok: false, error: "forbidden", status: 403 });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clears chapter_id when moving away from chapter-scoped visibility", async () => {
    getMock.mockResolvedValue({ addedBy: "owner" });
    const result = await updateSourceVisibility({} as Env, "src-1", {
      visibility: "member",
      chapter: null,
      user: OWNER,
      chapters: [OSAKA],
    });
    expect(result).toEqual({ ok: true, visibility: "member", chapterId: null });
    expect(updateMock).toHaveBeenCalledWith({
      visibility: "member",
      chapterId: null,
      updatedAt: expect.any(Date),
    });
  });
});
