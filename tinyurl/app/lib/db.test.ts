import { describe, expect, it } from "vitest";
import {
  assignLinksToChannel,
  listAssignableLinksForCampaign,
  listLatestCommentsForCampaign,
  normalizeCampaignCode,
  toCampaign,
  toLink,
} from "./db";

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

describe("listLatestCommentsForCampaign", () => {
  it("loads the latest comment for each link in one query", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(query: string) {
        sql = query;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async all() {
            return {
              results: [
                {
                  id: 4,
                  link_id: "link_a",
                  author_user_id: "user_a",
                  body: "Campaign announcement",
                  created_at: 1700001000,
                },
              ],
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(listLatestCommentsForCampaign(db, 7)).resolves.toEqual({
      link_a: {
        id: 4,
        linkId: "link_a",
        authorUserId: "user_a",
        body: "Campaign announcement",
        createdAt: 1700001000,
      },
    });
    expect(sql).toContain("ROW_NUMBER() OVER");
    expect(sql).toContain("PARTITION BY c.link_id ORDER BY c.created_at DESC, c.id DESC");
    expect(sql).toContain("JOIN campaign_channels channel");
    expect(sql).toContain("WHERE channel.campaign_id = ?");
    expect(bindings).toEqual([7]);
  });
});

describe("campaign link assignment permissions", () => {
  it("includes links shared to the user or their chapters as editor candidates", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(query: string) {
        sql = query;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;

    await listAssignableLinksForCampaign(db, {
      userId: "user_editor",
      email: "editor@example.com",
      chapterIds: [42, 84],
      campaignId: 7,
    });

    expect(sql).toContain("p.role = 'editor'");
    expect(sql).toContain("p.principal_type = 'user'");
    expect(sql).toContain("p.principal_type = 'chapter'");
    expect(bindings).toEqual(["user_editor", 7, "editor@example.com", '["42","84"]']);
  });

  it("rechecks editor sharing when assigning links", async () => {
    const prepared: { sql: string; bindings: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        const call = { sql, bindings: [] as unknown[] };
        prepared.push(call);
        return {
          bind(...values: unknown[]) {
            call.bindings = values;
            return this;
          },
          async first() {
            return { id: 9 };
          },
        };
      },
      async batch() {
        return [{ meta: { changes: 1 } }];
      },
    } as unknown as D1Database;

    const result = await assignLinksToChannel(db, {
      linkIds: ["link_shared"],
      channelId: 9,
      actorUserId: "user_editor",
      actorEmail: "editor@example.com",
      actorChapterId: 42,
      actorChapterIds: [42, 84],
    });

    const update = prepared.find((call) => call.sql.includes("UPDATE links"));
    expect(update?.sql).toContain("p.role = 'editor'");
    expect(update?.bindings).toEqual([
      9,
      42,
      "link_shared",
      "user_editor",
      9,
      "editor@example.com",
      '["42","84"]',
    ]);
    expect(result).toEqual({ assignedIds: ["link_shared"], rejectedIds: [] });
  });
});
