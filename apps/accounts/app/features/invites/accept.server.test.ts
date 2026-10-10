import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const getInviteByToken = vi.fn();
const joinMembershipViaInvite = vi.fn();
const bustChaptersWithCountsCache = vi.fn();
const getFixedT = vi.fn(async () => (key: string) => key);

vi.mock("~/features/auth/auth.server", () => ({ getSessionUser }));
vi.mock("./repository.server", () => ({ getInviteByToken }));
vi.mock("~/features/memberships/mutations.server", () => ({ joinMembershipViaInvite }));
vi.mock("~/features/chapters/repository.server", () => ({ bustChaptersWithCountsCache }));
vi.mock("~/lib/i18n/i18n.server", () => ({ i18n: { getFixedT } }));

const { loadInviteAcceptance } = await import("./accept.server");

const now = () => Math.floor(Date.now() / 1000);
const chapters = [
  { id: 1, slug: "gdg-tokyo", name: "GDG Tokyo" },
  { id: 2, slug: "gdg-osaka", name: "GDG Osaka" },
];

function args(token = "tok") {
  return {
    request: new Request(`https://accounts.test/invite/${token}`),
    params: { token },
    context: { cloudflare: { env: { DB: {} }, ctx: {} } },
  } as never;
}

describe("invite acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInviteByToken.mockResolvedValue({
      id: "i1",
      expiresAt: now() + 3600,
      revokedAt: null,
      chapters,
    });
    joinMembershipViaInvite.mockResolvedValue("joined");
  });

  it("reports unknown, expired and revoked links without requiring sign-in", async () => {
    getInviteByToken.mockResolvedValueOnce(null);
    await expect(loadInviteAcceptance(args())).resolves.toMatchObject({ state: "invalid" });
    getInviteByToken.mockResolvedValueOnce({ expiresAt: now() - 1, revokedAt: null, chapters });
    await expect(loadInviteAcceptance(args())).resolves.toMatchObject({ state: "expired" });
    getInviteByToken.mockResolvedValueOnce({ expiresAt: now() + 60, revokedAt: 1, chapters });
    await expect(loadInviteAcceptance(args())).resolves.toMatchObject({ state: "revoked" });
    expect(getSessionUser).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors to sign in and back to the invite", async () => {
    getSessionUser.mockResolvedValue(null);
    const thrown = await loadInviteAcceptance(args("abc")).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe(
      `/signin?return_to=${encodeURIComponent("/invite/abc")}`,
    );
    expect(joinMembershipViaInvite).not.toHaveBeenCalled();
  });

  it("joins every linked chapter for a signed-in user", async () => {
    getSessionUser.mockResolvedValue({ id: "u1" });
    joinMembershipViaInvite.mockResolvedValueOnce("joined").mockResolvedValueOnce("already_member");
    const result = await loadInviteAcceptance(args());
    expect(result).toMatchObject({
      state: "joined",
      chapters: [
        { id: 1, joined: true },
        { id: 2, joined: false },
      ],
    });
    expect(joinMembershipViaInvite).toHaveBeenCalledWith({}, "u1", 1);
    expect(joinMembershipViaInvite).toHaveBeenCalledWith({}, "u1", 2);
    expect(bustChaptersWithCountsCache).toHaveBeenCalledOnce();
  });
});
