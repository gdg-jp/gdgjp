import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth-utils.server", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(),
}));

import { requireAdmin } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { action, loader } from "./admin.pages";

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
  it("returns pages list", async () => {
    const mockPages = [
      {
        id: "p1",
        slug: "hello-world",
        titleJa: "ハローワールド",
        titleEn: "Hello World",
        status: "published",
        authorId: "u1",
        authorName: "Alice",
        createdAt: new Date(),
        updatedAt: new Date(),
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

    expect(result.pages).toEqual(mockPages);
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

  it("archivePage intent calls db.update with archived status", async () => {
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

    expect(updateSpy).toHaveBeenCalledOnce();
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(result).toEqual({});
  });

  it("restorePage intent calls db.update with draft status", async () => {
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
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
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
