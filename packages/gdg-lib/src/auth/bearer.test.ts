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

  it("returns null when userinfo responds non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "invalid_token" }, 401)),
    );
    await expect(
      getBearerIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toBe(null);
  });

  it("returns null when sub is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ email: "a@b.c" })),
    );
    await expect(
      getBearerIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toBe(null);
  });

  it("normalizes claims and defaults missing optional strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        expect(String(url)).toBe("https://accounts.example/api/auth/oauth2/userinfo");
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
            "not-an-object",
          ],
        }),
      ),
    );
    await expect(
      getBearerIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toEqual({
      user: { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: true },
      chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "organizer" }],
    });
  });
});

describe("getCliIdentity", () => {
  it("returns null when the Authorization header is missing or not Bearer-prefixed", async () => {
    await expect(getCliIdentity(requestWithAuth(), "https://accounts.example")).resolves.toBe(null);
  });

  it("calls the CLI identity endpoint, not userinfo", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://accounts.example/api/cli/v1/identity");
      return jsonResponse({
        user: { id: "user-1", email: "a@b.c", name: "A", image: null, isAdmin: false },
        chapters: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null when the response is non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "invalid_token" }, 401)),
    );
    await expect(
      getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toBe(null);
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

  it("rejects a response missing required user fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          user: { id: "user-1", email: "a@b.c" },
          chapters: [],
        }),
      ),
    );
    await expect(
      getCliIdentity(requestWithAuth("Bearer t"), "https://accounts.example"),
    ).resolves.toBe(null);
  });
});
