import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const canAccessSourceMock = vi.fn();
const unarchiveSourceMock = vi.fn();

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
  canAccessSource: (...args: unknown[]) => canAccessSourceMock(...args),
  unarchiveSource: (...args: unknown[]) => unarchiveSourceMock(...args),
}));

import { action } from "./unarchive";

function args(method = "POST", id = "source-1") {
  const request = new Request(`http://localhost/api/sources/${id}/unarchive`, { method });
  return {
    request,
    context: { cloudflare: { env: {} } } as never,
    params: { id },
    unstable_pattern: "/api/sources/:id/unarchive",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue({ id: "source-1", status: "archived" });
  canAccessSourceMock.mockReset().mockReturnValue(true);
  unarchiveSourceMock.mockReset().mockResolvedValue({ ok: true });
});

describe("source unarchive action", () => {
  it("rejects non-POST requests", async () => {
    expect((await action(args("GET"))).status).toBe(405);
  });

  it("returns not found before mutating a missing source", async () => {
    getMock.mockResolvedValue(undefined);

    expect((await action(args())).status).toBe(404);
    expect(unarchiveSourceMock).not.toHaveBeenCalled();
  });

  it("restores an accessible archived source", async () => {
    const response = await action(args());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "source-1", status: "ready" });
    expect(unarchiveSourceMock).toHaveBeenCalledWith(expect.any(Object), "source-1");
  });
});
