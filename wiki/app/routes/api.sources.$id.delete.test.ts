import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const canAccessSourceMock = vi.fn();
const deleteArchivedSourceMock = vi.fn();

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
  deleteArchivedSource: (...args: unknown[]) => deleteArchivedSourceMock(...args),
}));

import { action } from "./api.sources.$id.delete";

function args(method = "POST", id = "source-1") {
  const request = new Request(`http://localhost/api/sources/${id}/delete`, { method });
  return {
    request,
    context: { cloudflare: { env: {} } } as never,
    params: { id },
    unstable_pattern: "/api/sources/:id/delete",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue({ id: "source-1", status: "archived" });
  canAccessSourceMock.mockReset().mockReturnValue(true);
  deleteArchivedSourceMock.mockReset().mockResolvedValue({ ok: true });
});

describe("source delete action", () => {
  it("rejects non-POST requests", async () => {
    expect((await action(args("GET"))).status).toBe(405);
  });

  it("rejects readers without source access", async () => {
    canAccessSourceMock.mockReturnValue(false);

    expect((await action(args())).status).toBe(403);
    expect(deleteArchivedSourceMock).not.toHaveBeenCalled();
  });

  it("returns the lifecycle conflict for a non-archived source", async () => {
    deleteArchivedSourceMock.mockResolvedValue({ ok: false, error: "not_archived", status: 409 });

    const response = await action(args());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "not_archived" });
  });

  it("deletes an accessible archived source", async () => {
    const response = await action(args());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "source-1", deleted: true });
  });
});
