import { describe, expect, it } from "vitest";
import { resolveCampaignScope, shouldReloadCampaign } from "./campaign-navigation";

const channels = [
  { id: 1, links: [{ id: "link-a" }] },
  { id: 2, links: [{ id: "link-b" }] },
];

describe("resolveCampaignScope", () => {
  it("resolves a channel and its link from the cached campaign tree", () => {
    const params = new URLSearchParams({ channelId: "2", linkId: "link-b" });

    expect(resolveCampaignScope(channels, params)).toEqual({
      selectedChannelId: 2,
      selectedLinkId: "link-b",
    });
  });

  it("rejects a link outside the selected channel", () => {
    const params = new URLSearchParams({ channelId: "2", linkId: "link-a" });

    expect(resolveCampaignScope(channels, params)).toEqual({
      selectedChannelId: 2,
      selectedLinkId: null,
    });
  });
});

describe("shouldReloadCampaign", () => {
  it("does not reload when only the presentation view changes", () => {
    const current = new URL("https://url.gdgs.jp/campaigns/1");
    const next = new URL("https://url.gdgs.jp/campaigns/1?view=analytics");

    expect(shouldReloadCampaign(current, next, true)).toBe(false);
    expect(shouldReloadCampaign(next, current, true)).toBe(false);
  });

  it("reloads when an analytics filter changes", () => {
    const current = new URL("https://url.gdgs.jp/campaigns/1?view=analytics&period=7d");
    const next = new URL("https://url.gdgs.jp/campaigns/1?view=analytics&period=30d");

    expect(shouldReloadCampaign(current, next, true)).toBe(true);
  });

  it("preserves action revalidation when the URL is unchanged", () => {
    const current = new URL("https://url.gdgs.jp/campaigns/1?view=analytics");

    expect(shouldReloadCampaign(current, current, true)).toBe(true);
  });

  it("preserves the router default for a different campaign", () => {
    const current = new URL("https://url.gdgs.jp/campaigns/1");
    const next = new URL("https://url.gdgs.jp/campaigns/2?view=analytics");

    expect(shouldReloadCampaign(current, next, true)).toBe(true);
  });
});
