import type { PrActor } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCampaign = vi.fn();
const listCampaigns = vi.fn();
const createLink = vi.fn();

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
vi.mock("~/features/links/link.service", () => ({
  createLinkWithExtras: (...args: unknown[]) => createLink(...args),
  updateLinkWithExtras: vi.fn(),
}));

const { prCreateLink, prEnsureCampaign } = await import("./pr-service.server");

const env = { DB: {}, SHORT_URL_BASE: "https://gdgs.jp" } as unknown as Env;
const actor: PrActor = {
  user: { id: "u1", email: "u@example.com", name: "u", image: null, isAdmin: false },
  chapters: [{ chapterId: 1, chapterSlug: "kwansai", role: "organizer" }],
};

beforeEach(() => {
  createCampaign.mockReset();
  listCampaigns.mockReset();
  createLink.mockReset();
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
});
