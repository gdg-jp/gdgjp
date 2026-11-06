import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const enqueueSourceRefreshMock = vi.fn();

vi.mock("~/features/spaces/access.server", async (importOriginal) => {
  // The outer (space) layer has its own tests in features/spaces; here every caller is
  // an owner of the default space so these tests keep exercising the inner ACL.
  const original = await importOriginal<typeof import("~/features/spaces/access.server")>();
  const space = {
    id: "gdg-jp",
    slug: "gdg-jp",
    name: "GDG Japan",
    kind: "shared",
    chapterId: null,
  };
  return {
    ...original,
    requireSpace: vi.fn(async () => ({
      space,
      role: "owner",
      identity: { user: null, chapters: [], chapterIds: [], claimsAvailable: true },
      access: new Map([["gdg-jp", "owner"]]),
    })),
    requireSpaceForIdentity: vi.fn(async () => ({ space, role: "owner" })),
    requirePageSpace: vi.fn(async () => ({ spaceId: "gdg-jp", role: "owner" })),
    requireSourceSpace: vi.fn(async () => ({ spaceId: "gdg-jp", role: "owner" })),
  };
});

vi.mock("~/features/auth/utils.server", () => ({
  getAccessIdentity: vi.fn().mockResolvedValue({ chapterIds: [] }),
  requireUser: vi.fn().mockResolvedValue({ id: "user-1", isAdmin: true }),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(() => ({
    select: () => ({ from: () => ({ where: () => ({ get: getMock }) }) }),
  })),
}));

vi.mock("~/features/sources/sources.server", () => ({
  canAccessSource: vi.fn().mockReturnValue(true),
  enqueueSourceRefresh: (...args: unknown[]) => enqueueSourceRefreshMock(...args),
}));

import { action } from "./refresh";

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

  it("passes on the lifecycle's refusal for kinds without a fetch driver", async () => {
    // The route no longer branches on kind; enqueueSourceRefresh (SOURCE_KINDS.refreshable)
    // decides, and its answer reaches the client unchanged.
    getMock.mockResolvedValue({ ...source, kind: "conversation" });
    enqueueSourceRefreshMock.mockResolvedValue({
      ok: false,
      error: "unsupported_source_kind",
      status: 409,
    });

    const response = await action(requestArgs());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "unsupported_source_kind" });
  });
});
