import { afterEach, describe, expect, it, vi } from "vitest";
import { getBearerIdentity, getCliIdentity } from "./bearer";
import { CHAPTERS_CLAIM, IS_ADMIN_CLAIM } from "./claims";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestWithAuth(authorization?: string): Request {
  return new Request("https://rp.example/api", {
    headers: authorization ? { authorization } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getBearerIdentity", () => {
  it("returns null when the Authorization header is missing or not Bearer-prefixed", async () => {
    await expect(getBearerIdentity(requestWithAuth(), "https://accounts.example")).resolves.toBe(
      null,
    );
    await expect(
      getBearerIdentity(requestWithAuth("Basic abc"), "https://accounts.example"),
    ).resolves.toBe(null);
  });

  it("returns null when userinfo responds non-OK, whatever the body says", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ sub: "user-1" }, 401)),
    );
    await expect(
      getBearerIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toBe(null);
  });

  it("returns null when sub is missing, empty, or not a string", async () => {
    for (const body of [{ email: "a@b.c" }, { sub: "" }, { sub: 123 }]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(body)),
      );
      await expect(
        getBearerIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
      ).resolves.toBe(null);
    }
  });

  it("forwards the bearer token to userinfo and defaults missing optional strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://accounts.example/api/auth/oauth2/userinfo");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t");
        return jsonResponse({ sub: "user-1" });
      }),
    );
    await expect(
      getBearerIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toEqual({
      user: { id: "user-1", email: "", name: "", image: null, isAdmin: false },
      chapters: [],
    });
  });

  it("drops malformed chapter entries but preserves valid ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          sub: "user-1",
          email: "a@b.c",
          name: "A",
          [IS_ADMIN_CLAIM]: true,
          [CHAPTERS_CLAIM]: [
            { chapterId: 10, chapterSlug: "tokyo", role: "organizer" },
            { chapterId: "not-a-number", chapterSlug: "osaka", role: "member" },
            { chapterId: 20, chapterSlug: "kyoto", role: "not-a-role" },
            { chapterId: 30, chapterSlug: "nagoya", role: "member" },
            "not-an-object",
            null,
          ],
        }),
      ),
    );
    await expect(
      getBearerIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toEqual({
      user: { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: true },
      chapters: [
        { chapterId: 10, chapterSlug: "tokyo", role: "organizer" },
        { chapterId: 30, chapterSlug: "nagoya", role: "member" },
      ],
    });
  });
});

describe("getCliIdentity", () => {
  it("returns null when the Authorization header is missing or not Bearer-prefixed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getCliIdentity(requestWithAuth(), "https://accounts.example")).resolves.toBe(null);
    await expect(
      getCliIdentity(requestWithAuth("Basic abc"), "https://accounts.example"),
    ).resolves.toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the bearer token to the CLI identity endpoint, not userinfo", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://accounts.example/api/cli/v1/identity");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t");
      return jsonResponse({
        user: { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: false },
        chapters: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toEqual({
      user: { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: false },
      chapters: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null when the response is non-OK, whatever the body says", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            user: { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: false },
            chapters: [],
          },
          401,
        ),
      ),
    );
    await expect(
      getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toBe(null);
  });

  it("returns null when the body is not JSON or not an object", async () => {
    for (const body of ["not json", "null"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status: 200 })),
      );
      await expect(
        getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
      ).resolves.toBe(null);
    }
  });

  it("returns the full user shape including image and isAdmin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          user: {
            id: "user-1",
            email: "organizer@example.com",
            name: "Organizer",
            image: "https://example.com/avatar.png",
            isAdmin: true,
          },
          chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "organizer" }],
        }),
      ),
    );
    await expect(
      getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toEqual({
      user: {
        id: "user-1",
        email: "organizer@example.com",
        name: "Organizer",
        image: "https://example.com/avatar.png",
        isAdmin: true,
      },
      chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "organizer" }],
    });
  });

  it("rejects the whole response on a malformed field instead of dropping just that entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          user: { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: false },
          chapters: [
            { chapterId: 10, chapterSlug: "tokyo", role: "organizer" },
            { chapterId: "not-a-number", chapterSlug: "osaka", role: "member" },
          ],
        }),
      ),
    );
    await expect(
      getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toBe(null);
  });

  it("rejects a response with any one required field missing or mistyped", async () => {
    const user = { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: false };
    const bodies = [
      { user: null, chapters: [] },
      { user: { ...user, id: "" }, chapters: [] },
      { user: { ...user, id: 1 }, chapters: [] },
      { user: { ...user, email: undefined }, chapters: [] },
      { user: { ...user, name: undefined }, chapters: [] },
      { user: { ...user, image: undefined }, chapters: [] },
      { user: { ...user, isAdmin: "true" }, chapters: [] },
      { user, chapters: "tokyo" },
      { user, chapters: [null] },
    ];
    for (const body of bodies) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(body)),
      );
      await expect(
        getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
      ).resolves.toBe(null);
    }
  });
});
