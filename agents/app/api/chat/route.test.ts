import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discordWebhook: vi.fn(),
  getAgentsChat: vi.fn(),
  registerAgentHandlers: vi.fn(),
  verifyWebhook: vi.fn(),
}));

vi.mock("@/lib/adapters", () => ({ getAgentsChat: mocks.getAgentsChat }));
vi.mock("@/lib/agent", () => ({ registerAgentHandlers: mocks.registerAgentHandlers }));
vi.mock("@/lib/redis", () => ({ getReplayStore: vi.fn() }));
vi.mock("@/lib/verify", () => ({ verifyWebhook: mocks.verifyWebhook }));

import { POST } from "./route";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentsChat.mockReturnValue({
      webhooks: { discord: mocks.discordWebhook },
    });
  });

  it("dispatches Gateway-forwarded Discord messages without HTTP interaction verification", async () => {
    mocks.discordWebhook.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await POST(
      new Request("https://agent.gdgs.jp/api/chat", {
        method: "POST",
        headers: { "x-discord-gateway-token": "bot-token" },
        body: '{"type":"GATEWAY_MESSAGE_CREATE"}',
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
    expect(mocks.getAgentsChat).toHaveBeenCalledWith("discord");
    expect(mocks.registerAgentHandlers).toHaveBeenCalledOnce();
    expect(mocks.discordWebhook).toHaveBeenCalledOnce();
    const [forwarded] = mocks.discordWebhook.mock.calls[0] as [Request];
    expect(forwarded.headers.get("x-discord-gateway-token")).toBe("bot-token");
    await expect(forwarded.text()).resolves.toBe('{"type":"GATEWAY_MESSAGE_CREATE"}');
  });
});
