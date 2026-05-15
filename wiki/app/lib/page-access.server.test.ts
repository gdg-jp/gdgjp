import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageRole } from "./page-access.server";
import { canUserGrantRole } from "./page-access.server";

// ---------------------------------------------------------------------------
// canUserGrantRole — pure function, no DB needed
// ---------------------------------------------------------------------------

describe("canUserGrantRole", () => {
  describe("admin system role", () => {
    it("can grant any role", () => {
      expect(canUserGrantRole(null, true, "owner")).toBe(true);
      expect(canUserGrantRole(null, true, "editor")).toBe(true);
      expect(canUserGrantRole(null, true, "viewer")).toBe(true);
    });
  });

  describe("owner page role", () => {
    it("can grant any role", () => {
      expect(canUserGrantRole("owner", false, "owner")).toBe(true);
      expect(canUserGrantRole("owner", false, "editor")).toBe(true);
      expect(canUserGrantRole("owner", false, "viewer")).toBe(true);
    });
  });

  describe("editor page role", () => {
    it("can grant editor and viewer but not owner", () => {
      expect(canUserGrantRole("editor", false, "editor")).toBe(true);
      expect(canUserGrantRole("editor", false, "viewer")).toBe(true);
      expect(canUserGrantRole("editor", false, "owner")).toBe(false);
    });
  });

  describe("viewer page role", () => {
    it("cannot grant any role", () => {
      expect(canUserGrantRole("viewer", false, "viewer")).toBe(false);
      expect(canUserGrantRole("viewer", false, "editor")).toBe(false);
      expect(canUserGrantRole("viewer", false, "owner")).toBe(false);
    });
  });

  describe("null page role (no access)", () => {
    it("cannot grant any role", () => {
      expect(canUserGrantRole(null, false, "viewer")).toBe(false);
      expect(canUserGrantRole(null, false, "viewer")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// getUserPageRole — requires DB mock
// ---------------------------------------------------------------------------

// We test the logic indirectly via the exported function with a minimal mock.
// The DB mock simulates Drizzle's chained query API.

function makeDbMock(accessRows: { id: string; pageRole: PageRole; userId: string | null }[]) {
  const selectFn = vi.fn();
  const getFn = vi.fn();
  const updateFn = vi.fn();
  const setFn = vi.fn();
  const whereFn = vi.fn();
  const fromFn = vi.fn();

  // Update chain
  updateFn.mockReturnValue({ set: setFn });
  setFn.mockReturnValue({ where: whereFn });
  whereFn.mockResolvedValue(undefined);

  // Select chain — returns rows sequentially
  let callCount = 0;
  getFn.mockImplementation(() => {
    const row = accessRows[callCount++] ?? undefined;
    return Promise.resolve(row);
  });
  whereFn.mockReturnValueOnce({ get: getFn });
  whereFn.mockReturnValueOnce({ get: getFn });
  fromFn.mockReturnValue({ where: whereFn });
  selectFn.mockReturnValue({ from: fromFn });

  return { select: selectFn, update: updateFn };
}

describe("getUserPageRole", () => {
  it("resolves by userId when found", async () => {
    const { getUserPageRole } = await import("./page-access.server");
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ id: "a1", pageRole: "editor" }),
          }),
        }),
      }),
      update: vi.fn(),
    };
    const result = await getUserPageRole(db as never, "page1", "user1", "user@example.com");
    expect(result).toBe("editor");
  });

  it("falls back to email when userId row not found", async () => {
    const { getUserPageRole } = await import("./page-access.server");
    let callCount = 0;
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve(undefined); // no userId row
              return Promise.resolve({ id: "a2", pageRole: "viewer" }); // email row
            }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const result = await getUserPageRole(db as never, "page1", "user1", "user@example.com");
    expect(result).toBe("viewer");
  });

  it("returns null when no row found by userId or email", async () => {
    const { getUserPageRole } = await import("./page-access.server");
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
      update: vi.fn(),
    };
    const result = await getUserPageRole(db as never, "page1", "user1", "user@example.com");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// removePageAccess — last_owner guard
// ---------------------------------------------------------------------------

describe("removePageAccess", () => {
  it("returns last_owner error when removing sole owner", async () => {
    const { removePageAccess } = await import("./page-access.server");
    let callCount = 0;
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve({ pageRole: "owner" });
              return Promise.resolve(undefined);
            }),
            all: vi.fn().mockResolvedValue([{ id: "a1" }]), // only 1 owner
          }),
        }),
      }),
      delete: vi.fn(),
    };
    const result = await removePageAccess(db as never, "a1", "page1");
    expect(result).toEqual({ ok: false, error: "last_owner" });
  });

  it("allows removal when multiple owners exist", async () => {
    const { removePageAccess } = await import("./page-access.server");
    let callCount = 0;
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve({ pageRole: "owner" });
              return Promise.resolve(undefined);
            }),
            all: vi.fn().mockResolvedValue([{ id: "a1" }, { id: "a2" }]), // 2 owners
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const result = await removePageAccess(db as never, "a1", "page1");
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// canUserManageAccess — admin always true; owner/editor true; viewer false
// ---------------------------------------------------------------------------

describe("canUserManageAccess", () => {
  it("returns true for admin regardless of page role", async () => {
    const { canUserManageAccess } = await import("./page-access.server");
    const db = { select: vi.fn(), update: vi.fn() };
    const result = await canUserManageAccess(db as never, "page1", {
      id: "u1",
      isAdmin: true,
      email: "admin@example.com",
    });
    expect(result).toBe(true);
  });

  it("returns true for owner page role", async () => {
    const { canUserManageAccess } = await import("./page-access.server");
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ id: "a1", pageRole: "owner" }),
          }),
        }),
      }),
      update: vi.fn(),
    };
    const result = await canUserManageAccess(db as never, "page1", {
      id: "u1",
      isAdmin: false,
      email: "user@example.com",
    });
    expect(result).toBe(true);
  });

  it("returns false for viewer page role", async () => {
    const { canUserManageAccess } = await import("./page-access.server");
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ id: "a1", pageRole: "viewer" }),
          }),
        }),
      }),
      update: vi.fn(),
    };
    const result = await canUserManageAccess(db as never, "page1", {
      id: "u1",
      isAdmin: false,
      email: "user@example.com",
    });
    expect(result).toBe(false);
  });
});
