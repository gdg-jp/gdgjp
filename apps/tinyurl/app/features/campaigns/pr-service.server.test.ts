import type { PrActor } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCampaign = vi.fn();
const listCampaigns = vi.fn();
const createLink = vi.fn();
const linkBySlug = vi.fn();
const permissionsFor = vi.fn();

vi.mock("./campaign.service", () => ({
  createCampaignForActor: (...args: unknown[]) => createCampaign(...args),
  listCampaignsForActor: (...args: unknown[]) => listCampaigns(...args),
  listCampaignChannelsForActor: vi.fn(),
  createCampaignChannelForActor: vi.fn(),
}));
vi.mock("./campaign-cli-analytics", () => ({ getCampaignAnalyticsForActor: vi.fn() }));
vi.mock("~/features/domains/domain.repository", () => ({
  getDomainByHostname: async () => ({ id: 7, hostname: "gdgs.jp" }),
}));
vi.mock("~/features/links/link-queries", () => ({
  getLinkBySlug: (...args: unknown[]) => linkBySlug(...args),
}));
vi.mock("~/features/links/link-permissions.repository", () => ({
  listPermissionsForLink: (...args: unknown[]) => permissionsFor(...args),
}));
vi.mock("~/features/links/link.service", () => ({
  createLinkWithExtras: (...args: unknown[]) => createLink(...args),
  updateLinkWithExtras: vi.fn(),
}));

const { prCreateLink, prEnsureCampaign, prFindLink } = await import("./pr-service.server");

const env = { DB: {}, SHORT_URL_BASE: "https://gdgs.jp" } as unknown as Env;
const actor: PrActor = {
  user: { id: "u1", email: "u@example.com", name: "u", image: null, isAdmin: false },
  chapters: [{ chapterId: 1, chapterSlug: "kwansai", role: "organizer" }],
};

beforeEach(() => {
  createCampaign.mockReset();
  listCampaigns.mockReset();
  createLink.mockReset();
  linkBySlug.mockReset();
  permissionsFor.mockReset();
  permissionsFor.mockResolvedValue([]);
});

describe("tinyurl PrService", () => {
  it("creates the campaign, or finds the existing one by code", async () => {
    createCampaign.mockResolvedValueOnce({ ok: true, campaign: { id: 3 } });
    expect(await prEnsureCampaign(env, { actor, chapterId: 1, code: "df", name: "DF" })).toEqual({
      ok: true,
      campaignId: 3,
      created: true,
    });
    createCampaign.mockResolvedValueOnce({ ok: false, code: "conflict", error: "taken" });
    listCampaigns.mockResolvedValueOnce({ items: [{ id: 4, code: "DF" }], nextCursor: null });
    expect(await prEnsureCampaign(env, { actor, chapterId: 1, code: "df", name: "DF" })).toEqual({
      ok: true,
      campaignId: 4,
      created: false,
    });
  });

  it("passes tinyurl's refusal through", async () => {
    createCampaign.mockResolvedValueOnce({ ok: false, code: "forbidden", error: "no" });
    expect(await prEnsureCampaign(env, { actor, chapterId: 9, code: "df", name: "DF" })).toEqual({
      ok: false,
      code: "forbidden",
      message: "no",
    });
  });

  it("creates private links on the system domain and keeps slug_taken as the code", async () => {
    createLink.mockResolvedValueOnce({ ok: true, link: { id: "l1", slug: "df-x-1" } });
    const base = {
      actor,
      chapterId: 1,
      slug: "df-x-1",
      destinationUrl: "https://e.x",
      campaignChannelId: 2,
    };
    expect(await prCreateLink(env, base)).toEqual({
      ok: true,
      link: { id: "l1", slug: "df-x-1", shortUrl: "https://gdgs.jp/df-x-1" },
    });
    expect(createLink.mock.calls[0][2]).toMatchObject({ domainId: 7, visibility: "private" });
    createLink.mockResolvedValueOnce({ ok: false, code: "slug_taken", error: "taken" });
    expect(await prCreateLink(env, base)).toMatchObject({ ok: false, code: "slug_taken" });
  });

  describe("findLink", () => {
    const link = (patch: Record<string, unknown> = {}) => ({
      id: "l1",
      slug: "df-x-7v2",
      destinationUrl: "https://e.x/b",
      ownerUserId: "someone",
      ownerChapterId: 1,
      campaignChannelId: 2,
      visibility: "private",
      ...patch,
    });
    const find = (chapterId = 1, who: PrActor = actor) =>
      prFindLink(env, { actor: who, chapterId, slug: "df-x-7v2" });

    it("returns the owner, channel and destination of a link the chapter owns", async () => {
      linkBySlug.mockResolvedValueOnce(link());
      expect(await find()).toEqual({
        ok: true,
        link: {
          id: "l1",
          slug: "df-x-7v2",
          shortUrl: "https://gdgs.jp/df-x-7v2",
          destinationUrl: "https://e.x/b",
          ownerUserId: "someone",
          ownerChapterId: 1,
          campaignChannelId: 2,
        },
      });
      expect(linkBySlug.mock.calls[0]?.slice(1)).toEqual(["df-x-7v2", "gdgs.jp"]);
    });

    it("gives a chapter the actor is not a member of no chapter access, only its own links", async () => {
      linkBySlug.mockResolvedValueOnce(link({ ownerChapterId: 9 }));
      expect(await find(9)).toMatchObject({ ok: false, code: "not_found" });
      linkBySlug.mockResolvedValueOnce(link({ ownerChapterId: 9 }));
      permissionsFor.mockResolvedValueOnce([
        { principalType: "chapter", principalId: "9", role: "editor" },
      ]);
      expect(await find(9)).toMatchObject({ ok: false, code: "not_found" });
      linkBySlug.mockResolvedValueOnce(link({ ownerChapterId: 9, ownerUserId: "u1" }));
      expect(await find(9)).toMatchObject({ ok: true });
    });

    it("hides a private link of another chapter and user, even from a member of that chapter asking for this one", async () => {
      const both: PrActor = {
        ...actor,
        chapters: [...actor.chapters, { chapterId: 2, chapterSlug: "other", role: "member" }],
      };
      linkBySlug.mockResolvedValue(link({ ownerChapterId: 2 }));
      expect(await find(1, both)).toMatchObject({ ok: false, code: "not_found" });
      expect(await find(1)).toMatchObject({ ok: false, code: "not_found" });
    });

    it("returns a link the actor owns or the chapter was granted, and nothing for a missing slug", async () => {
      linkBySlug.mockResolvedValueOnce(link({ ownerChapterId: null, ownerUserId: "u1" }));
      expect(await find()).toMatchObject({ ok: true });
      linkBySlug.mockResolvedValueOnce(link({ ownerChapterId: 5 }));
      permissionsFor.mockResolvedValueOnce([
        { principalType: "chapter", principalId: "1", role: "viewer" },
      ]);
      expect(await find()).toMatchObject({ ok: true });
      linkBySlug.mockResolvedValueOnce(null);
      expect(await find()).toMatchObject({ ok: false, code: "not_found" });
    });
  });
});
