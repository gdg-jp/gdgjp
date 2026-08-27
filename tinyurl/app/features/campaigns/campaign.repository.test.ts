import { describe, expect, it } from "vitest";
import {
  createCampaign,
  listCampaignChannelsPage,
  listCampaignsForCallerPage,
  normalizeCampaignCode,
  parseIdCursor,
  toCampaign,
} from "./campaign.repository";

describe("createCampaign", () => {
  it("creates the default その他 channel after creating the Campaign", async () => {
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
            return {
              id: 7,
              name: "DevFest 2026",
              code: "df26",
              default_destination_url: null,
              owner_user_id: "user_abc",
              created_at: 1700000000,
              updated_at: 1700000000,
              archived_at: null,
            };
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database;

    await createCampaign(db, {
      name: "DevFest 2026",
      code: "df26",
      ownerUserId: "user_abc",
      chapterIds: [42],
    });

    const defaultChannel = prepared.find((call) => call.sql.includes("'その他', 'other'"));
    expect(defaultChannel?.bindings).toEqual([7]);
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

describe("parseIdCursor", () => {
  it("parses a positive integer string", () => {
    expect(parseIdCursor("12")).toBe(12);
  });

  it.each(["0", "-1", "abc", "1.5", ""])("rejects an invalid cursor: %s", (cursor) => {
    expect(parseIdCursor(cursor)).toBeUndefined();
  });
});

describe("listCampaignsForCallerPage", () => {
  it("short-circuits without a query when a non-admin has no chapters", async () => {
    const db = {
      prepare() {
        throw new Error("should not query D1");
      },
    } as unknown as D1Database;

    await expect(
      listCampaignsForCallerPage(db, { isSuperAdmin: false, chapterIds: [] }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("scopes the query to the caller's chapters for a non-admin", async () => {
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

    await listCampaignsForCallerPage(
      db,
      { isSuperAdmin: false, chapterIds: [42, 84] },
      {
        limit: 10,
      },
    );

    expect(sql).toContain("JOIN campaign_chapters cc ON cc.campaign_id = c.id");
    expect(sql).toContain("cc.chapter_id IN (?, ?)");
    expect(bindings).toEqual([0, 42, 84, 11]);
  });

  it("does not scope by chapter for a super-admin", async () => {
    let sql = "";
    const db = {
      prepare(query: string) {
        sql = query;
        return {
          bind() {
            return this;
          },
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;

    await listCampaignsForCallerPage(db, { isSuperAdmin: true, chapterIds: [] });

    expect(sql).not.toContain("campaign_chapters cc");
  });

  it("returns a nextCursor when more rows exist than the limit", async () => {
    const rows = [
      {
        id: 1,
        name: "A",
        code: "a",
        default_destination_url: null,
        owner_user_id: "user_abc",
        created_at: 1,
        updated_at: 1,
        archived_at: null,
        channel_count: 0,
        link_count: 0,
      },
      {
        id: 2,
        name: "B",
        code: "b",
        default_destination_url: null,
        owner_user_id: "user_abc",
        created_at: 1,
        updated_at: 1,
        archived_at: null,
        channel_count: 0,
        link_count: 0,
      },
    ];
    const db = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async all() {
            return { results: rows };
          },
        };
      },
    } as unknown as D1Database;

    const page = await listCampaignsForCallerPage(
      db,
      { isSuperAdmin: true, chapterIds: [] },
      { limit: 1 },
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("1");
  });
});

describe("listCampaignChannelsPage", () => {
  it("filters by campaign id and applies the cursor as an id lower bound", async () => {
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

    await listCampaignChannelsPage(db, 7, { cursor: 3, limit: 5 });

    expect(sql).toContain("campaign_id = ?");
    expect(sql).toContain("id > ?");
    expect(bindings).toEqual([7, 0, 3, 6]);
  });
});
