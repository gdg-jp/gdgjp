import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const canAccessSourceMock = vi.fn();
const unarchiveSourceMock = vi.fn();

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
  canAccessSource: (...args: unknown[]) => canAccessSourceMock(...args),
  unarchiveSource: (...args: unknown[]) => unarchiveSourceMock(...args),
}));

import { action } from "./api.sources.$id.unarchive";

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
