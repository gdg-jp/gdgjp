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
  createSource: vi.fn(),
  enqueueSourceRefresh: (...args: unknown[]) => enqueueSourceRefreshMock(...args),
}));

import { action } from "./page";

function requestArgs() {
  const form = new FormData();
  form.set("intent", "refresh");
  form.set("sourceId", "source-1");
  const request = new Request("http://localhost/sources", { method: "POST", body: form });
  return {
    request,
    context: { cloudflare: { env: {} } } as never,
    params: {},
    unstable_pattern: "/sources",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue({ id: "source-1", status: "ready", spaceId: "gdg-jp" });
  enqueueSourceRefreshMock.mockReset();
});

describe("sources refresh action", () => {
  it("surfaces the shared enqueue failure instead of leaving a pending source", async () => {
    enqueueSourceRefreshMock.mockResolvedValue({
      ok: false,
      error: "enqueue_failed",
      status: 503,
    });

    const result = await action(requestArgs());

    expect(result).toEqual({ ok: false, error: "enqueue_failed" });
    expect(enqueueSourceRefreshMock).toHaveBeenCalledWith(expect.any(Object), "source-1");
  });
});
