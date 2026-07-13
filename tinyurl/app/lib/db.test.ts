import { describe, expect, it } from "vitest";
import { normalizeCampaignCode, toCampaign, toLink } from "./db";

describe("toLink", () => {
  const row = {
    id: "link_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "test-slug",
    destination_url: "https://example.com",
    title: "Example",
    description: "A test link",
    og_image_url: "https://example.com/og.png",
    owner_user_id: "user_abc",
    owner_chapter_id: 42,
    campaign_channel_id: 7,
    visibility: "private" as const,
    created_at: 1700000000,
    updated_at: 1700001000,
    deleted_at: null,
  };

  it("maps all columns to camelCase", () => {
    const link = toLink(row);
    expect(link).toEqual({
      id: "link_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "test-slug",
      destinationUrl: "https://example.com",
      title: "Example",
      description: "A test link",
      ogImageUrl: "https://example.com/og.png",
      ownerUserId: "user_abc",
      ownerChapterId: 42,
      campaignChannelId: 7,
      visibility: "private",
      createdAt: 1700000000,
      updatedAt: 1700001000,
      deletedAt: null,
    });
  });

  it("passes through nulls for optional fields", () => {
    const link = toLink({
      ...row,
      title: null,
      description: null,
      og_image_url: null,
      owner_chapter_id: null,
      campaign_channel_id: null,
      deleted_at: null,
    });
    expect(link.title).toBeNull();
    expect(link.description).toBeNull();
    expect(link.ogImageUrl).toBeNull();
    expect(link.ownerChapterId).toBeNull();
    expect(link.campaignChannelId).toBeNull();
    expect(link.deletedAt).toBeNull();
  });
});

describe("normalizeCampaignCode", () => {
  it("trims and lowercases valid codes", () => {
    expect(normalizeCampaignCode(" DF26_X ")).toBe("df26_x");
  });

  it.each(["", "-df26", "tokyo?", "東京", "a".repeat(33)])(
    "rejects an invalid campaign code: %s",
    (code) => {
      expect(() => normalizeCampaignCode(code)).toThrow(RangeError);
    },
  );
});

describe("toCampaign", () => {
  it("maps the default destination URL and channel-era campaign fields", () => {
    expect(
      toCampaign({
        id: 3,
        name: "DevFest 2026",
        code: "df26",
        default_destination_url: "https://example.com/devfest",
        owner_user_id: "user_abc",
        created_at: 1700000000,
        updated_at: 1700001000,
        archived_at: null,
      }),
    ).toEqual({
      id: 3,
      name: "DevFest 2026",
      code: "df26",
      defaultDestinationUrl: "https://example.com/devfest",
      ownerUserId: "user_abc",
      chapterIds: [],
      createdAt: 1700000000,
      updatedAt: 1700001000,
      archivedAt: null,
    });
  });
});
