import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const setMock = vi.fn();

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
    update: () => ({ set: setMock }),
  })),
}));

vi.mock("~/features/sources/sources.server", () => ({
  canAccessSource: vi.fn().mockReturnValue(true),
}));

import { action } from "./archive";

const source = { id: "source-1", status: "ready" };

function requestArgs() {
  const request = new Request("http://localhost/api/sources/source-1/archive", { method: "POST" });
  return {
    request,
    context: { cloudflare: { env: {} } } as never,
    params: { id: source.id },
    unstable_pattern: "/api/sources/:id/archive",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(source);
  setMock.mockReset().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
});

describe("source archive action", () => {
  it("revokes an in-flight fetch lease when archiving", async () => {
    const response = await action(requestArgs());

    expect(response.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived", fetchAttemptId: null }),
    );
  });
});
