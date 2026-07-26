import { describe, expect, it, vi } from "vitest";
import { loader } from "./api.cli.identity";

describe("CLI identity API", () => {
  it("returns the scoped CLI user and their active chapter memberships", async () => {
    const tokenFirst = vi.fn().mockResolvedValue({
      id: "user-1",
      email: "member@example.com",
      name: "Member",
      image: null,
      isAdmin: 1,
      scopes: '["openid","https://gdgs.jp/scopes/cli"]',
    });
    const chaptersAll = vi.fn().mockResolvedValue({
      results: [{ chapterId: 7, chapterSlug: "tokyo", role: "organizer" }],
    });
    const prepare = vi
      .fn()
      .mockReturnValueOnce({ bind: vi.fn().mockReturnValue({ first: tokenFirst }) })
      .mockReturnValueOnce({ bind: vi.fn().mockReturnValue({ all: chaptersAll }) });

    const response = await loader({
      request: new Request("https://accounts.example/api/cli/identity", {
        headers: { Authorization: "Bearer access-token" },
      }),
      context: { cloudflare: { env: { DB: { prepare } } } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        email: "member@example.com",
        name: "Member",
        image: null,
        isAdmin: true,
      },
      chapters: [{ chapterId: 7, chapterSlug: "tokyo", role: "organizer" }],
    });
    expect(prepare.mock.calls[0]?.[0]).toContain('JOIN "user"');
    expect(prepare.mock.calls[1]?.[0]).toContain("m.status = 'active'");
  });

  it("rejects missing, invalid, and unscoped access tokens", async () => {
    const response = await loader({
      request: new Request("https://accounts.example/api/cli/identity"),
      context: { cloudflare: { env: { DB: { prepare: vi.fn() } } } },
    } as never);
    expect(response.status).toBe(401);

    const first = vi.fn().mockResolvedValue({
      id: "user-1",
      email: "member@example.com",
      name: "Member",
      image: null,
      isAdmin: 0,
      scopes: '["openid"]',
    });
    const unscoped = await loader({
      request: new Request("https://accounts.example/api/cli/identity", {
        headers: { Authorization: "Bearer access-token" },
      }),
      context: {
        cloudflare: {
          env: {
            DB: { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ first }) }) },
          },
        },
      },
    } as never);
    expect(unscoped.status).toBe(401);

    const unknown = await loader({
      request: new Request("https://accounts.example/api/cli/identity", {
        headers: { Authorization: "Bearer expired-or-unknown-token" },
      }),
      context: {
        cloudflare: {
          env: {
            DB: {
              prepare: vi.fn().mockReturnValue({
                bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(null) }),
              }),
            },
          },
        },
      },
    } as never);
    expect(unknown.status).toBe(401);
  });
});
