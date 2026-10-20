import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { getAccessIdentity } from "./utils.server";

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

describe("getAccessIdentity", () => {
  beforeEach(() => {
    getSessionUser.mockReset();
    getFreshClaims.mockReset();
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

  it("uses the live claims on every call so membership changes apply immediately", async () => {
    getSessionUser.mockResolvedValue(user);
    getFreshClaims.mockResolvedValueOnce(claims).mockResolvedValueOnce({
      ...claims,
      chapter: null,
      chapters: [],
    });

    const first = await getAccessIdentity(request, env);
    const second = await getAccessIdentity(request, env);

    expect(first.chapterIds).toEqual(["10"]);
    expect(first.chapters).toEqual([{ chapterId: "10", chapterSlug: "tokyo", role: "member" }]);
    expect(second.chapterIds).toEqual([]);
    expect(getFreshClaims).toHaveBeenCalledTimes(2);
  });

  it("surfaces an unreachable IdP instead of guessing", async () => {
    getSessionUser.mockResolvedValue(user);
    getFreshClaims.mockRejectedValue(new Response(null, { status: 503 }));

    await expect(getAccessIdentity(request, env)).rejects.toMatchObject({ status: 503 });
  });
});
