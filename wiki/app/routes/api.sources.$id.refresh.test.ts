import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const enqueueSourceRefreshMock = vi.fn();

vi.mock("~/lib/auth-utils.server", () => ({
  getAccessIdentity: vi.fn().mockResolvedValue({ chapterIds: [] }),
  requireUser: vi.fn().mockResolvedValue({ id: "user-1", isAdmin: true }),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(() => ({
    select: () => ({ from: () => ({ where: () => ({ get: getMock }) }) }),
  })),
}));

vi.mock("~/lib/sources.server", () => ({
  canAccessSource: vi.fn().mockReturnValue(true),
  enqueueSourceRefresh: (...args: unknown[]) => enqueueSourceRefreshMock(...args),
}));

import { action } from "./api.sources.$id.refresh";

const source = { id: "source-1", kind: "website", status: "ready" };

function requestArgs() {
  const request = new Request("http://localhost/api/sources/source-1/refresh", { method: "POST" });
  return {
    request,
    context: { cloudflare: { env: {} } } as never,
    params: { id: source.id },
    unstable_pattern: "/api/sources/:id/refresh",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(source);
  enqueueSourceRefreshMock.mockReset().mockResolvedValue({ ok: true });
});

describe("source refresh action", () => {
  it("revokes an in-flight fetch lease before queueing a refresh", async () => {
    const response = await action(requestArgs());

    expect(response.status).toBe(202);
    expect(enqueueSourceRefreshMock).toHaveBeenCalledWith(expect.any(Object), source.id);
  });

  it("leaves an actionable, lease-free error when queueing fails", async () => {
    enqueueSourceRefreshMock.mockResolvedValue({
      ok: false,
      error: "enqueue_failed",
      status: 503,
    });

    const response = await action(requestArgs());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "enqueue_failed" });
    expect(enqueueSourceRefreshMock).toHaveBeenCalledWith(expect.any(Object), source.id);
  });

  it("rejects conversation sources before queueing", async () => {
    getMock.mockResolvedValue({ ...source, kind: "conversation" });

    const response = await action(requestArgs());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "unsupported_source_kind" });
    expect(enqueueSourceRefreshMock).not.toHaveBeenCalled();
  });
});
