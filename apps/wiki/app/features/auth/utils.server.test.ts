import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const getFreshClaims = vi.fn();

vi.mock("~/features/auth/auth.server", () => ({
  createAuth: () => ({
    getSessionUser,
    getFreshClaims,
  }),
}));

vi.mock("~/features/auth/redirect", () => ({
  buildSignInRedirect: () => new Response(null, { status: 302 }),
}));

import { clearChapterClaimsCacheForTests, getAccessIdentity } from "./utils.server";

const env = {} as Env;
const request = new Request("https://wiki.gdgs.jp/wiki/example");

const user = {
  id: "user-1",
  email: "a@example.com",
  name: "A",
  image: null,
  isAdmin: false,
};

const claims = {
  sub: "sub-1",
  email: "a@example.com",
  name: "A",
  picture: null,
  emailVerified: true,
  isAdmin: false,
  chapter: { chapterId: 10, chapterSlug: "tokyo", role: "member" as const },
  chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "member" as const }],
};

describe("getAccessIdentity claims cache", () => {
  beforeEach(() => {
    clearChapterClaimsCacheForTests();
    getSessionUser.mockReset();
    getFreshClaims.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty identity when signed out", async () => {
    getSessionUser.mockResolvedValue(null);
    await expect(getAccessIdentity(request, env)).resolves.toEqual({
      user: null,
      chapterIds: [],
      chapters: [],
      claimsAvailable: true,
    });
    expect(getFreshClaims).not.toHaveBeenCalled();
  });

  it("fetches /userinfo once and reuses claims within the TTL", async () => {
    getSessionUser.mockResolvedValue(user);
    getFreshClaims.mockResolvedValue(claims);

    const first = await getAccessIdentity(request, env);
    const second = await getAccessIdentity(request, env);

    expect(getFreshClaims).toHaveBeenCalledTimes(1);
    expect(first.chapterIds).toEqual(["10"]);
    expect(second.chapters).toEqual([{ chapterId: "10", chapterSlug: "tokyo", role: "member" }]);
    expect(second.claimsAvailable).toBe(true);
  });

  it("refreshes claims after the TTL expires", async () => {
    getSessionUser.mockResolvedValue(user);
    getFreshClaims.mockResolvedValue(claims);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:00:00Z"));
    await getAccessIdentity(request, env);

    vi.setSystemTime(new Date("2026-08-12T00:00:31Z"));
    await getAccessIdentity(request, env);

    expect(getFreshClaims).toHaveBeenCalledTimes(2);
  });

  it("falls back to a stale cache entry when /userinfo fails", async () => {
    getSessionUser.mockResolvedValue(user);
    getFreshClaims.mockResolvedValueOnce(claims);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:00:00Z"));
    await getAccessIdentity(request, env);

    vi.setSystemTime(new Date("2026-08-12T00:00:31Z"));
    getFreshClaims.mockRejectedValueOnce(new Error("userinfo_failed"));
    const identity = await getAccessIdentity(request, env);

    expect(identity.claimsAvailable).toBe(true);
    expect(identity.chapterIds).toEqual(["10"]);
    expect(identity.chapters[0]?.chapterSlug).toBe("tokyo");
  });
});
