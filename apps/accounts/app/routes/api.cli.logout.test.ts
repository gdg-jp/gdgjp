import { describe, expect, it, vi } from "vitest";
import { action } from "./api.cli.logout";

describe("CLI logout API", () => {
  it("revokes the refresh-token family for a scoped gdg-cli access token", async () => {
    const first = vi.fn().mockResolvedValue({
      refreshId: "refresh-1",
      scopes: '["openid","https://gdgs.jp/scopes/cli"]',
    });
    const run = vi.fn().mockResolvedValue({});
    const prepare = vi
      .fn()
      .mockReturnValueOnce({ bind: vi.fn().mockReturnValue({ first }) })
      .mockReturnValueOnce({ bind: vi.fn().mockReturnValue({ run }) });
    const response = await action({
      request: new Request("https://accounts.example/api/cli/logout", {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
      }),
      context: { cloudflare: { env: { DB: { prepare } } } },
    } as never);
    expect(response.status).toBe(204);
    expect(prepare.mock.calls[1]?.[0]).toContain("DELETE FROM oauthRefreshToken");
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects tokens without the CLI scope", async () => {
    const first = vi.fn().mockResolvedValue({ refreshId: "refresh-1", scopes: '["openid"]' });
    const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ first }) });
    const response = await action({
      request: new Request("https://accounts.example/api/cli/logout", {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
      }),
      context: { cloudflare: { env: { DB: { prepare } } } },
    } as never);
    expect(response.status).toBe(401);
  });
});
