import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const batchMock = vi.fn();

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
  getAccessIdentity: vi.fn(async () => ({
    user: null,
    chapters: [],
    chapterIds: [],
    claimsAvailable: true,
  })),
  requireUser: vi.fn().mockResolvedValue({ id: "user-1", isAdmin: true }),
}));

import { action } from "./reorder";

function requestArgs(pageType: string | null) {
  prepareMock.mockImplementation((sql: string) => {
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn().mockResolvedValue({
        id: "page-1",
        parent_id: null,
        author_id: "user-1",
        origin: "agent",
        page_type: pageType,
        status: "published",
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      sql,
    };
    return statement;
  });
  const request = new Request("http://localhost/api/pages/reorder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageId: "page-1", newParentId: null, insertAfterId: null }),
  });
  return {
    request,
    context: {
      cloudflare: { env: { DB: { prepare: prepareMock, batch: batchMock } } },
    } as never,
    params: {},
    unstable_pattern: "/api/pages/reorder",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  prepareMock.mockReset();
  batchMock.mockReset().mockResolvedValue([]);
});

describe("page reorder action", () => {
  it.each(["wiki-index", "wiki-log"])(
    "rejects protected page type %s before batching",
    async (pageType) => {
      const response = await action(requestArgs(pageType));

      expect(response.status).toBe(403);
      expect(prepareMock).toHaveBeenCalledTimes(1);
      expect(batchMock).not.toHaveBeenCalled();
    },
  );

  it("retains reorder behavior for ordinary pages", async () => {
    const response = await action(requestArgs("event"));

    expect(response.status).toBe(200);
    expect(batchMock).toHaveBeenCalledOnce();
  });
});
