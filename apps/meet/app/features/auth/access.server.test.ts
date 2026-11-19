import { type AuthUser, ClaimsUnavailableError } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser, requireUserWithChapter } from "~/features/auth/access.server";

const mockRequireUser = vi.fn();
const mockGetSessionUser = vi.fn();
const mockGetFreshClaims = vi.fn();

vi.mock("~/features/auth/auth.server", () => ({
  getAuth: () => ({
    requireUser: mockRequireUser,
    getSessionUser: mockGetSessionUser,
    getFreshClaims: mockGetFreshClaims,
  }),
}));

const ENV = {} as Env;
const USER: AuthUser = {
  id: "u-1",
  email: "organizer@example.com",
  name: "Organizer",
  image: null,
  isAdmin: false,
};

beforeEach(() => {
  mockRequireUser.mockReset();
  mockGetSessionUser.mockReset();
  mockGetFreshClaims.mockReset();
});

describe("requireUser", () => {
  it("returns the authenticated user", async () => {
    mockRequireUser.mockResolvedValue(USER);
    const request = new Request("https://meet.gdgs.jp/");
    await expect(requireUser(ENV, request)).resolves.toEqual(USER);
  });

  it("redirects to /signin?return_to=... when unauthenticated (401)", async () => {
    mockRequireUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const request = new Request("https://meet.gdgs.jp/meetings/new?from=top");
    let caught: unknown;
    try {
      await requireUser(ENV, request);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Response);
    const response = caught as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/signin?return_to=%2Fmeetings%2Fnew%3Ffrom%3Dtop",
    );
  });

  it("rethrows 503 responses instead of looping through sign-in", async () => {
    const unavailable = new Response("Service Temporarily Unavailable", { status: 503 });
    mockRequireUser.mockRejectedValue(unavailable);
    const request = new Request("https://meet.gdgs.jp/");
    await expect(requireUser(ENV, request)).rejects.toBe(unavailable);
  });
});

describe("requireUserWithChapter", () => {
  it("redirects to /no-chapter when the user has no active chapter", async () => {
    mockRequireUser.mockResolvedValue(USER);
    mockGetSessionUser.mockResolvedValue(USER);
    mockGetFreshClaims.mockResolvedValue({ chapter: null, chapters: [] });

    const request = new Request("https://meet.gdgs.jp/meetings/new");
    let caught: unknown;
    try {
      await requireUserWithChapter(ENV, request);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Response);
    const response = caught as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/no-chapter");
  });

  it("redirects to /signin when fresh claims are unavailable", async () => {
    mockRequireUser.mockResolvedValue(USER);
    mockGetSessionUser.mockResolvedValue(USER);
    mockGetFreshClaims.mockRejectedValue(new ClaimsUnavailableError("userinfo_failed"));

    const request = new Request("https://meet.gdgs.jp/meetings/new");
    let caught: unknown;
    try {
      await requireUserWithChapter(ENV, request);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Response);
    const response = caught as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/signin?return_to=%2Fmeetings%2Fnew");
  });

  it("returns user and chapter memberships when the user belongs to a chapter", async () => {
    const chapter = { chapterId: 1, chapterSlug: "tokyo", role: "organizer" as const };
    mockRequireUser.mockResolvedValue(USER);
    mockGetSessionUser.mockResolvedValue(USER);
    mockGetFreshClaims.mockResolvedValue({ chapter, chapters: [chapter] });

    const request = new Request("https://meet.gdgs.jp/meetings/new");
    await expect(requireUserWithChapter(ENV, request)).resolves.toEqual({
      user: USER,
      chapter,
      chapters: [chapter],
    });
  });
});
