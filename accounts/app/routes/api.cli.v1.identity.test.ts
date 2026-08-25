import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthClientsMock = vi.hoisted(() => ({ requireCliTokenUser: vi.fn() }));
vi.mock("~/lib/oauth-clients.server", () => ({
  requireCliTokenUser: oauthClientsMock.requireCliTokenUser,
}));

const dbMock = vi.hoisted(() => ({
  getUserById: vi.fn(),
  listActiveChaptersForUser: vi.fn(),
}));
vi.mock("~/lib/db", () => ({
  getUserById: dbMock.getUserById,
  listActiveChaptersForUser: dbMock.listActiveChaptersForUser,
}));

import { loader } from "./api.cli.v1.identity";

function loaderArgs(authorization?: string) {
  const headers = authorization ? { Authorization: authorization } : undefined;
  return {
    request: new Request("https://accounts.example/api/cli/v1/identity", { headers }),
    context: { cloudflare: { env: { DB: {} } } },
  } as never;
}

describe("GET /api/cli/v1/identity", () => {
  beforeEach(() => {
    oauthClientsMock.requireCliTokenUser.mockReset();
    dbMock.getUserById.mockReset();
    dbMock.listActiveChaptersForUser.mockReset();
  });

  it("returns the user's image and isAdmin from the user table row for a valid gdg-cli token", async () => {
    oauthClientsMock.requireCliTokenUser.mockResolvedValue({ id: "user-1" });
    dbMock.getUserById.mockResolvedValue({
      id: "user-1",
      email: "organizer@example.com",
      name: "Organizer",
      image: "https://example.com/avatar.png",
      isAdmin: true,
    });
    dbMock.listActiveChaptersForUser.mockResolvedValue([
      { chapterId: 10, chapterSlug: "tokyo", role: "organizer" },
    ]);

    const response = await loader(loaderArgs("Bearer valid-cli-token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
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

  it("rejects a token that lacks the CLI scope", async () => {
    oauthClientsMock.requireCliTokenUser.mockRejectedValue(new Response("Unauthorized"));

    const response = await loader(loaderArgs("Bearer no-cli-scope-token"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
    expect(dbMock.getUserById).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header", async () => {
    oauthClientsMock.requireCliTokenUser.mockRejectedValue(new Response("Unauthorized"));

    const response = await loader(loaderArgs());

    expect(response.status).toBe(401);
    expect(oauthClientsMock.requireCliTokenUser).toHaveBeenCalledWith(expect.anything(), "");
  });

  it("returns 401 instead of 500 when the token's user row is missing", async () => {
    oauthClientsMock.requireCliTokenUser.mockResolvedValue({ id: "ghost-user" });
    dbMock.getUserById.mockResolvedValue(null);

    const response = await loader(loaderArgs("Bearer valid-cli-token"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
    expect(dbMock.listActiveChaptersForUser).not.toHaveBeenCalled();
  });
});
