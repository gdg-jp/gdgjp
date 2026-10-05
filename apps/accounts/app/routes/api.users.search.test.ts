import { describe, expect, it, vi } from "vitest";
import { loader } from "./api.users.search";

describe("Accounts user search API", () => {
  it("returns matching users for a current SNS OAuth token", async () => {
    const first = vi.fn().mockResolvedValue({ userId: "organizer" });
    const all = vi.fn().mockResolvedValue({
      results: [{ id: "user-1", name: "Example User", email: "user@example.com", image: null }],
    });
    const prepare = vi
      .fn()
      .mockReturnValueOnce({ bind: vi.fn().mockReturnValue({ first }) })
      .mockReturnValueOnce({ bind: vi.fn().mockReturnValue({ all }) });

    const response = await loader({
      request: new Request("https://accounts.example/api/users/search?q=example", {
        headers: { Authorization: "Bearer access-token" },
      }),
      context: { cloudflare: { env: { DB: { prepare }, SNS_CLIENT_ID: "sns" } } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: [{ id: "user-1", name: "Example User", email: "user@example.com", image: null }],
    });
    expect(prepare.mock.results[0]?.value.bind.mock.calls[0]?.[0]).toBe(
      "Pxa-1wifRlPl7yG_0oJNfzqq7MelmOfonFgOFgapzFI",
    );
    expect(prepare.mock.calls[1]?.[0]).toContain('FROM "user"');
  });

  it("does not expose users without a current SNS OAuth token", async () => {
    const prepare = vi.fn();
    const response = await loader({
      request: new Request("https://accounts.example/api/users/search?q=example"),
      context: { cloudflare: { env: { DB: { prepare } } } },
    } as never);

    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
});
