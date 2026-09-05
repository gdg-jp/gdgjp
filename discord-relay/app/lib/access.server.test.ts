import { ClaimsUnavailableError, type RpAuthInstance } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChapterAccess, requireChapterAccess, requireOrganizer } from "./access.server";
import { getAuth } from "./auth.server";

vi.mock("./auth.server", () => ({
  getAuth: vi.fn(),
}));

describe("access.server", () => {
  const mockUser = {
    id: "user-1",
    email: "user@example.com",
    name: "User One",
    image: null,
    isAdmin: false,
  };

  const createMockDb = () => ({
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
    }),
  });

  const createMockEnv = (db: D1Database = createMockDb() as unknown as D1Database) =>
    ({
      DB: db,
      ENVIRONMENT: "production",
      APP_URL: "https://relay.gdgs.jp",
      ACCOUNTS_URL: "https://accounts.gdgs.jp",
      IDP_URL: "https://accounts.gdgs.jp",
      IDP_CLIENT_ID: "discord-relay",
      RP_SESSION_SECRET: "test-secret",
      IDP_CLIENT_SECRET: "test-idp-secret",
    }) as unknown as Env;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. requireChapterAccess calls getFreshClaims() on every invocation (COND-604 / REQ-601)
  it("calls getFreshClaims() on every requireChapterAccess call without caching", async () => {
    const mockGetFreshClaims = vi.fn().mockResolvedValue({
      sub: "user-1",
      email: "user@example.com",
      isAdmin: false,
      chapters: [{ chapterId: 1, chapterSlug: "tokyo", role: "organizer" }],
    });

    vi.mocked(getAuth).mockReturnValue({
      requireUser: vi.fn().mockResolvedValue(mockUser),
      getFreshClaims: mockGetFreshClaims,
    } as unknown as RpAuthInstance);

    const env = createMockEnv();
    const request1 = new Request("https://relay.gdgs.jp/");
    const request2 = new Request("https://relay.gdgs.jp/");

    await requireChapterAccess(env, request1);
    await requireChapterAccess(env, request2);

    expect(mockGetFreshClaims).toHaveBeenCalledTimes(2);
  });

  // 2. Revocation of membership immediately results in /no-chapter on subsequent request
  it("immediately denies access (/no-chapter redirect) when membership is revoked", async () => {
    const mockGetFreshClaims = vi
      .fn()
      .mockResolvedValueOnce({
        sub: "user-1",
        email: "user@example.com",
        isAdmin: false,
        chapters: [{ chapterId: 1, chapterSlug: "tokyo", role: "organizer" }],
      })
      .mockResolvedValueOnce({
        sub: "user-1",
        email: "user@example.com",
        isAdmin: false,
        chapters: [],
      });

    vi.mocked(getAuth).mockReturnValue({
      requireUser: vi.fn().mockResolvedValue(mockUser),
      getFreshClaims: mockGetFreshClaims,
    } as unknown as RpAuthInstance);

    const env = createMockEnv();
    const request1 = new Request("https://relay.gdgs.jp/");
    const access1 = await requireChapterAccess(env, request1);
    expect(access1.chapter.chapterId).toBe(1);

    const request2 = new Request("https://relay.gdgs.jp/");
    let redirected: Response | null = null;
    try {
      await requireChapterAccess(env, request2);
    } catch (res) {
      if (res instanceof Response) redirected = res;
    }

    expect(redirected).not.toBeNull();
    expect(redirected?.status).toBe(302);
    expect(redirected?.headers.get("Location")).toBe("/no-chapter");
  });

  // 3. Cookie selection works for 2+ chapters; invalid cookie falls back to chapters[0] (REQ-603)
  it("respects chapter selection cookie and falls back to chapters[0] if invalid", async () => {
    const mockChapters = [
      { chapterId: 1, chapterSlug: "tokyo", role: "organizer" as const },
      { chapterId: 2, chapterSlug: "osaka", role: "member" as const },
    ];

    vi.mocked(getAuth).mockReturnValue({
      requireUser: vi.fn().mockResolvedValue(mockUser),
      getFreshClaims: vi.fn().mockResolvedValue({
        sub: "user-1",
        isAdmin: false,
        chapters: mockChapters,
      }),
    } as unknown as RpAuthInstance);

    const env = createMockEnv();

    // With cookie selecting chapter 2
    const reqWithCookie = new Request("https://relay.gdgs.jp/", {
      headers: { Cookie: "discord-relay-chapter=2" },
    });
    const accessWithCookie = await requireChapterAccess(env, reqWithCookie);
    expect(accessWithCookie.chapter.chapterId).toBe(2);

    // With invalid cookie value (999) -> fallback to chapters[0]
    const reqWithInvalid = new Request("https://relay.gdgs.jp/", {
      headers: { Cookie: "discord-relay-chapter=999" },
    });
    const accessWithInvalid = await requireChapterAccess(env, reqWithInvalid);
    expect(accessWithInvalid.chapter.chapterId).toBe(1);

    // Without cookie -> default to chapters[0]
    const reqWithoutCookie = new Request("https://relay.gdgs.jp/");
    const accessWithoutCookie = await requireChapterAccess(env, reqWithoutCookie);
    expect(accessWithoutCookie.chapter.chapterId).toBe(1);
  });

  // 4. Discards chapter claim entries where chapterId is not a number
  it("discards claim entries where chapterId is not a valid number", async () => {
    vi.mocked(getAuth).mockReturnValue({
      requireUser: vi.fn().mockResolvedValue(mockUser),
      getFreshClaims: vi.fn().mockResolvedValue({
        sub: "user-1",
        isAdmin: false,
        chapters: [
          { chapterId: 1, chapterSlug: "tokyo", role: "organizer" },
          { chapterId: "invalid", chapterSlug: "bad", role: "member" },
          { chapterId: null, chapterSlug: "bad2", role: "member" },
          { chapterId: Number.NaN, chapterSlug: "bad3", role: "member" },
        ],
      }),
    } as unknown as RpAuthInstance);

    const env = createMockEnv();
    const req = new Request("https://relay.gdgs.jp/", {
      headers: { Cookie: "discord-relay-chapter=invalid" },
    });

    const access = await requireChapterAccess(env, req);
    expect(access.chapters).toHaveLength(1);
    expect(access.chapters[0]?.chapterId).toBe(1);
    expect(access.chapter.chapterId).toBe(1);
  });

  // 5. Member role gets 403 on requireOrganizer (COND-602)
  it("throws 403 Forbidden for member role in requireOrganizer", () => {
    const memberAccess: ChapterAccess = {
      user: mockUser,
      chapter: { chapterId: 1, chapterSlug: "tokyo", role: "member" },
      chapters: [{ chapterId: 1, chapterSlug: "tokyo", role: "member" }],
      isAdmin: false,
      crossChapter: false,
    };

    let error: Response | null = null;
    try {
      requireOrganizer(memberAccess);
    } catch (res) {
      if (res instanceof Response) error = res;
    }

    expect(error).not.toBeNull();
    expect(error?.status).toBe(403);

    // Organizer does not throw
    const organizerAccess: ChapterAccess = {
      user: mockUser,
      chapter: { chapterId: 1, chapterSlug: "tokyo", role: "organizer" },
      chapters: [{ chapterId: 1, chapterSlug: "tokyo", role: "organizer" }],
      isAdmin: false,
      crossChapter: false,
    };
    expect(() => requireOrganizer(organizerAccess)).not.toThrow();

    // Admin passes even with member role
    const adminAccess: ChapterAccess = {
      user: { ...mockUser, isAdmin: true },
      chapter: { chapterId: 1, chapterSlug: "tokyo", role: "member" },
      chapters: [{ chapterId: 1, chapterSlug: "tokyo", role: "member" }],
      isAdmin: true,
      crossChapter: false,
    };
    expect(() => requireOrganizer(adminAccess)).not.toThrow();
  });

  // 6. is_admin cross-chapter access records in audit_log; if recording fails, operation fails
  it("records audit log on is_admin cross-chapter access and fails operation if log write fails", async () => {
    const adminUser = { ...mockUser, id: "admin-1", isAdmin: true };
    vi.mocked(getAuth).mockReturnValue({
      requireUser: vi.fn().mockResolvedValue(adminUser),
      getFreshClaims: vi.fn().mockResolvedValue({
        sub: "admin-1",
        isAdmin: true,
        chapters: [{ chapterId: 1, chapterSlug: "tokyo", role: "organizer" }],
      }),
    } as unknown as RpAuthInstance);

    const mockRun = vi.fn().mockResolvedValue({ success: true });
    const mockBind = vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({ chapter_id: 99, slug: "kyoto", name: "GDG Kyoto" }),
      run: mockRun,
    });
    const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
    const db = { prepare: mockPrepare } as unknown as D1Database;
    const env = createMockEnv(db);

    const req = new Request("https://relay.gdgs.jp/", {
      headers: { Cookie: "discord-relay-chapter=99" },
    });

    const access = await requireChapterAccess(env, req);
    expect(access.crossChapter).toBe(true);
    expect(access.chapter.chapterId).toBe(99);
    expect(mockRun).toHaveBeenCalled();

    // If recording audit log fails (throws), requireChapterAccess must reject
    mockRun.mockRejectedValueOnce(new Error("D1 write failure"));
    await expect(requireChapterAccess(env, req)).rejects.toThrow("D1 write failure");
  });

  // 7. ClaimsUnavailableError redirects to /signin instead of 500
  it("redirects to /signin when ClaimsUnavailableError is thrown", async () => {
    vi.mocked(getAuth).mockReturnValue({
      requireUser: vi.fn().mockResolvedValue(mockUser),
      getFreshClaims: vi.fn().mockRejectedValue(new ClaimsUnavailableError("refresh_failed")),
    } as unknown as RpAuthInstance);

    const env = createMockEnv();
    const req = new Request("https://relay.gdgs.jp/some/path");

    let redirectResponse: Response | null = null;
    try {
      await requireChapterAccess(env, req);
    } catch (res) {
      if (res instanceof Response) redirectResponse = res;
    }

    expect(redirectResponse).not.toBeNull();
    expect(redirectResponse?.status).toBe(302);
    expect(redirectResponse?.headers.get("Location")).toContain("/signin?return_to=");
  });
});
