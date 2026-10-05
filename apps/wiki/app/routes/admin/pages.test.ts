import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/utils.server", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(),
}));

vi.mock("~/features/pages/archive.server", () => ({
  archivePageAndDescendants: vi.fn(),
}));

import { requireAdmin } from "~/features/auth/utils.server";
import { archivePageAndDescendants } from "~/features/pages/archive.server";
import { getDb } from "~/lib/db.server";
import { action, loader } from "./pages";

const mockContext = { cloudflare: { env: {} as Env } } as Parameters<typeof loader>[0]["context"];

// ---------------------------------------------------------------------------
// Fluent DB mock helper
// ---------------------------------------------------------------------------

function fluentDb(result: unknown): ReturnType<typeof getDb> {
  function make(): unknown {
    return new Proxy(
      {
        all: () => Promise.resolve(result),
        get: () => Promise.resolve(result),
        batch: () => Promise.resolve([]),
      },
      {
        get(target, key) {
          if (key in target) return target[key as keyof typeof target];
          if (key === "then") return undefined;
          return () => make();
        },
      },
    );
  }
  return make() as ReturnType<typeof getDb>;
}

// ---------------------------------------------------------------------------
// loader tests
// ---------------------------------------------------------------------------

describe("admin.pages loader", () => {
  it("returns hierarchical pages list with computed depth, wikiPath, and childCount", async () => {
    const createdAt = new Date();
    const updatedAt = new Date();
    const mockPages = [
      {
        id: "p1",
        slug: "parent",
        titleJa: "親ページ",
        titleEn: "Parent Page",
        status: "published",
        visibility: "public",
        authorId: "u1",
        authorName: "Alice",
        createdAt,
        updatedAt,
        parentId: null,
        sortOrder: 0,
      },
      {
        id: "p2",
        slug: "child",
        titleJa: "子ページ",
        titleEn: "Child Page",
        status: "published",
        visibility: "public",
        authorId: "u1",
        authorName: "Alice",
        createdAt,
        updatedAt,
        parentId: "p1",
        sortOrder: 0,
      },
    ];
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireAdmin
    > extends Promise<infer T>
      ? T
      : never);
    vi.mocked(getDb).mockReturnValueOnce(fluentDb(mockPages));

    const request = new Request("http://localhost/admin/pages");
    const result = await loader({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/pages",
      unstable_url: new URL(request.url),
    });

    expect(await result.pages).toEqual([
      {
        ...mockPages[0],
        depth: 0,
        wikiPath: "/wiki/parent",
        childCount: 1,
      },
      {
        ...mockPages[1],
        depth: 1,
        wikiPath: "/wiki/parent/child",
        childCount: 0,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// action tests
// ---------------------------------------------------------------------------

describe("admin.pages action", () => {
  it("calls batch delete for deletePage intent", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireAdmin
    > extends Promise<infer T>
      ? T
      : never);

    const batchSpy = vi.fn().mockResolvedValue([]);
    function makeDbWithBatch(): ReturnType<typeof getDb> {
      const handler: ProxyHandler<object> = {
        get(_, key) {
          if (key === "batch") return batchSpy;
          if (key === "all") return () => Promise.resolve(undefined);
          if (key === "get") return () => Promise.resolve(undefined);
          if (key === "then") return undefined;
          return () => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler) as ReturnType<typeof getDb>;
    }
    vi.mocked(getDb).mockReturnValueOnce(makeDbWithBatch());

    const form = new FormData();
    form.set("intent", "deletePage");
    form.set("pageId", "page-123");

    const request = new Request("http://localhost/admin/pages", { method: "POST", body: form });
    const result = await action({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/pages",
      unstable_url: new URL(request.url),
    });

    expect(batchSpy).toHaveBeenCalledOnce();
    expect(result).toEqual({});
  });

  it("archivePage intent archives the page and its descendants", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireAdmin
    > extends Promise<infer T>
      ? T
      : never);

    vi.mocked(getDb).mockReturnValueOnce(fluentDb({}));

    const form = new FormData();
    form.set("intent", "archivePage");
    form.set("pageId", "page-123");

    const request = new Request("http://localhost/admin/pages", { method: "POST", body: form });
    const result = await action({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/pages",
      unstable_url: new URL(request.url),
    });

    expect(archivePageAndDescendants).toHaveBeenCalledWith(
      mockContext.cloudflare.env,
      expect.anything(),
      "page-123",
    );
    expect(result).toEqual({});
  });

  it("restorePage intent republishes the page", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireAdmin
    > extends Promise<infer T>
      ? T
      : never);

    const whereSpy = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
    const updateSpy = vi.fn().mockReturnValue({ set: setSpy });
    function makeDbWithUpdate(): ReturnType<typeof getDb> {
      const handler: ProxyHandler<object> = {
        get(_, key) {
          if (key === "update") return updateSpy;
          if (key === "then") return undefined;
          return () => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler) as ReturnType<typeof getDb>;
    }
    vi.mocked(getDb).mockReturnValueOnce(makeDbWithUpdate());

    const form = new FormData();
    form.set("intent", "restorePage");
    form.set("pageId", "page-123");

    const request = new Request("http://localhost/admin/pages", { method: "POST", body: form });
    const result = await action({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/pages",
      unstable_url: new URL(request.url),
    });

    expect(updateSpy).toHaveBeenCalledOnce();
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(result).toEqual({});
  });

  it("returns empty object for unknown intent", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireAdmin
    > extends Promise<infer T>
      ? T
      : never);

    const form = new FormData();
    form.set("intent", "unknown");

    const request = new Request("http://localhost/admin/pages", { method: "POST", body: form });
    const result = await action({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/pages",
      unstable_url: new URL(request.url),
    });

    expect(result).toEqual({});
  });
});
