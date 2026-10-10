import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const listMembershipsForUser = vi.fn();
const createInvite = vi.fn();
const getInviteById = vi.fn();
const listActiveInvitesForChapters = vi.fn();
const revokeInvite = vi.fn();
const getFixedT = vi.fn(async () => (key: string) => key);

vi.mock("~/features/auth/auth.server", () => ({ requireUser }));
vi.mock("~/features/memberships/repository.server", () => ({ listMembershipsForUser }));
vi.mock("./repository.server", () => ({
  createInvite,
  getInviteById,
  listActiveInvitesForChapters,
  revokeInvite,
}));
vi.mock("~/lib/i18n/i18n.server", () => ({ i18n: { getFixedT } }));

const { actOnInvites, loadInvites } = await import("./invites.server");

function membership(chapterId: number, role: "organizer" | "member") {
  return {
    userId: "u1",
    chapterId,
    role,
    status: "active",
    chapter: { id: chapterId, slug: `gdg-${chapterId}`, name: `GDG ${chapterId}` },
  };
}

function args(
  form?: Record<string, string | string[]>,
  url = "https://accounts.test/chapters/invites",
) {
  let request = new Request(url);
  if (form) {
    const body = new FormData();
    for (const [key, value] of Object.entries(form)) {
      for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
    }
    request = new Request(url, { method: "POST", body });
  }
  return {
    request,
    params: {},
    context: {
      cloudflare: { env: { DB: {}, APP_URL: "https://accounts.test" }, ctx: {} },
    },
  } as never;
}

describe("invite management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u1", email: "u@example.com", name: "U", isAdmin: false });
    listMembershipsForUser.mockResolvedValue([membership(1, "organizer"), membership(2, "member")]);
    listActiveInvitesForChapters.mockResolvedValue([]);
  });

  it("forbids users who organize no chapter, even super-admins", async () => {
    requireUser.mockResolvedValue({ id: "u1", email: "a@example.com", name: "A", isAdmin: true });
    listMembershipsForUser.mockResolvedValue([membership(2, "member")]);
    await expect(loadInvites(args())).rejects.toMatchObject({ status: 403 });
  });

  it("offers only organized chapters and honours the preselected slug", async () => {
    const data = await loadInvites(
      args(undefined, "https://accounts.test/chapters/invites?chapter=gdg-1"),
    );
    expect(data.chapters).toEqual([{ id: 1, slug: "gdg-1", name: "GDG 1" }]);
    expect(data.preselectedChapterId).toBe(1);
    expect(listActiveInvitesForChapters).toHaveBeenCalledWith({}, [1], expect.any(Number));
  });

  it("rejects invites that include a chapter the user does not organize", async () => {
    const result = await actOnInvites(
      args({ intent: "create", chapterId: ["1", "2"], expiresInDays: "7" }),
    );
    expect(result).toEqual({ error: "invites.errors.notOrganizer" });
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("rejects invites without an allowed expiry", async () => {
    const result = await actOnInvites(
      args({ intent: "create", chapterId: "1", expiresInDays: "0" }),
    );
    expect(result).toEqual({ error: "invites.errors.invalidExpiry" });
  });

  it("creates an expiring invite and returns its URL", async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await actOnInvites(
      args({ intent: "create", chapterId: ["1", "1"], expiresInDays: "7" }),
    );
    expect(result).toMatchObject({ ok: true, intent: "create" });
    const input = createInvite.mock.calls[0]?.[1];
    expect(input.chapterIds).toEqual([1]);
    expect(input.createdBy).toBe("u1");
    expect(input.expiresAt).toBeGreaterThanOrEqual(before + 7 * 86400);
    expect((result as { url: string }).url).toBe(`https://accounts.test/invite/${input.token}`);
  });

  it("revokes only invites linked to an organized chapter", async () => {
    getInviteById.mockResolvedValue({
      id: "i1",
      chapters: [{ id: 2, slug: "gdg-2", name: "GDG 2" }],
    });
    await expect(actOnInvites(args({ intent: "revoke", inviteId: "i1" }))).resolves.toEqual({
      error: "invites.errors.notOrganizer",
    });
    expect(revokeInvite).not.toHaveBeenCalled();

    getInviteById.mockResolvedValue({
      id: "i1",
      chapters: [{ id: 1, slug: "gdg-1", name: "GDG 1" }],
    });
    await expect(actOnInvites(args({ intent: "revoke", inviteId: "i1" }))).resolves.toEqual({
      ok: true,
      intent: "revoke",
    });
    expect(revokeInvite).toHaveBeenCalledWith({}, "i1");
  });
});
