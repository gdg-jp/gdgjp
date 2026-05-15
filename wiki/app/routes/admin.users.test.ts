import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth-utils.server", () => ({
  requireRole: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(),
}));

import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { action, loader } from "./admin.users";

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

describe("admin.users loader", () => {
  it("returns users and currentUserId", async () => {
    const mockUsers = [
      {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        image: null,
        role: "admin",
        chapterId: null,
        createdAt: new Date(),
      },
    ];
    vi.mocked(requireRole).mockResolvedValueOnce({ id: "u1" } as ReturnType<
      typeof requireRole
    > extends Promise<infer T>
      ? T
      : never);
    vi.mocked(getDb).mockReturnValueOnce(fluentDb(mockUsers));

    const request = new Request("http://localhost/admin/users");
    const result = await loader({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/users",
      unstable_url: new URL(request.url),
    });

    expect(result.users).toEqual(mockUsers);
    expect(result.currentUserId).toBe("u1");
  });
});

// ---------------------------------------------------------------------------
// action tests
// ---------------------------------------------------------------------------

describe("admin.users action", () => {
  it("blocks self-demotion", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireRole
    > extends Promise<infer T>
      ? T
      : never);

    const form = new FormData();
    form.set("intent", "updateRole");
    form.set("userId", "admin1"); // same as current user
    form.set("role", "member");

    const request = new Request("http://localhost/admin/users", { method: "POST", body: form });
    const result = await action({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/users",
      unstable_url: new URL(request.url),
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("admin.users.error_own_role");
  });

  it("rejects invalid roles", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireRole
    > extends Promise<infer T>
      ? T
      : never);

    const form = new FormData();
    form.set("intent", "updateRole");
    form.set("userId", "other-user");
    form.set("role", "superuser"); // not in ROLES

    const request = new Request("http://localhost/admin/users", { method: "POST", body: form });
    const result = await action({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/users",
      unstable_url: new URL(request.url),
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("admin.users.error_invalid_role");
  });

  it("returns empty object on successful role update", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ id: "admin1" } as ReturnType<
      typeof requireRole
    > extends Promise<infer T>
      ? T
      : never);
    vi.mocked(getDb).mockReturnValueOnce(fluentDb(undefined));

    const form = new FormData();
    form.set("intent", "updateRole");
    form.set("userId", "other-user");
    form.set("role", "lead");

    const request = new Request("http://localhost/admin/users", { method: "POST", body: form });
    const result = await action({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin/users",
      unstable_url: new URL(request.url),
    });

    expect(result).toEqual({});
  });
});
