import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveWorkspaceMock = vi.fn();
const createInlineSourceMock = vi.fn();

vi.mock("~/lib/agent-workspace.server", () => ({
  resolveAgentWorkspace: (...args: unknown[]) => resolveWorkspaceMock(...args),
  agentUnauthorized: () => Response.json({ error: "invalid_token" }, { status: 401 }),
}));
vi.mock("~/lib/sources.server", () => ({
  createInlineSource: (...args: unknown[]) => createInlineSourceMock(...args),
}));

import { action } from "./sources-inline";

const identity = {
  user: { id: "user-a", isAdmin: false },
  chapters: [{ chapterId: "chapter-1", role: "member" }],
};

function args(body: unknown, method = "POST") {
  const request = new Request("http://localhost/api/agent/sources/inline", {
    method,
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return {
    request,
    context: { cloudflare: { env: { tag: "env" } } } as never,
    params: {},
    unstable_pattern: "/api/agent/sources/inline",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  resolveWorkspaceMock.mockReset().mockResolvedValue({ identity });
  createInlineSourceMock.mockReset();
});

describe("POST /api/agent/sources/inline", () => {
  it("rejects non-POST and invalid bearer credentials", async () => {
    await expect(action(args({}, "GET"))).resolves.toMatchObject({ status: 405 });
    resolveWorkspaceMock.mockResolvedValue(null);
    const response = await action(args({ title: "x", content: "body", visibility: "member" }));
    expect(response.status).toBe(401);
    expect(createInlineSourceMock).not.toHaveBeenCalled();
  });

  it("passes the inline payload through and returns the source id", async () => {
    createInlineSourceMock.mockResolvedValue({
      ok: true,
      source: {
        id: "src-1",
        kind: "conversation",
        url: "gdg-memory://session-1",
        title: "Log",
        chapterId: "chapter-1",
        visibility: "chapter-member",
        status: "ready",
        refreshPolicy: "manual",
        createdAt: new Date("2026-08-19T00:00:00Z"),
      },
    });
    const response = await action(
      args({
        title: "Log",
        content: "# Conversation",
        visibility: "chapter-member",
        chapter: "chapter-1",
        externalId: "session-1",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: "src-1",
      kind: "conversation",
      chapterId: "chapter-1",
      title: "Log",
    });
    expect(createInlineSourceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        content: "# Conversation",
        externalId: "session-1",
        user: identity.user,
        chapters: identity.chapters,
      }),
    );
  });
});
