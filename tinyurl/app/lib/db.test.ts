import { describe, expect, it } from "vitest";
import {
  archiveLink,
  assignLinksToChannel,
  copyFolderPermissionsToLink,
  createCampaign,
  getFolderAccessRole,
  isFolderAvailableForLinkOwner,
  listAccessibleRootFoldersWithCounts,
  listAssignableLinksForCampaign,
  listLatestCommentsForCampaign,
  listLinksAccessibleByEmail,
  listLinksInFolderAccessible,
  normalizeCampaignCode,
  restoreLink,
  toCampaign,
  toLink,
  updateLink,
} from "./db";

describe("domain-aware aliased link queries", () => {
  it("qualifies simple columns without prefixing the hostname subquery", async () => {
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

    await listLinksAccessibleByEmail(db, "member@example.com", 42);

    expect(sql).toContain("l.id, l.domain_id");
    expect(sql).toContain("d.id = l.domain_id");
    expect(sql).not.toContain("l.(SELECT");
  });
});

describe("updateLink domain", () => {
  it("updates the domain and chapter ownership in one statement", async () => {
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
          async first() {
            return null;
          },
        };
      },
    } as unknown as D1Database;

    await updateLink(db, "link_1", { domainId: 3, ownerChapterId: 42 });

    expect(sql).toContain("domain_id = ?");
    expect(sql).toContain("owner_chapter_id = ?");
    expect(bindings).toEqual([3, 42, "link_1"]);
  });
});

describe("folder ownership", () => {
  it("matches a folder against the link owner's user identity", async () => {
    let bindings: unknown[] = [];
    const db = {
      prepare() {
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
          async first() {
            return { id: 8 };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      isFolderAvailableForLinkOwner(db, {
        id: 8,
        ownerUserId: "user_abc",
        ownerChapterId: 42,
      }),
    ).resolves.toBe(true);
    expect(bindings).toEqual([8, "user_abc"]);
  });
});

describe("folder permissions", () => {
  const viewer = {
    userId: "user_editor",
    email: "editor@example.com",
    chapterIds: [42, 84],
  };

  it("uses user and every chapter membership when checking a folder role", async () => {
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
          async first() {
            return { role: "editor" };
          },
        };
      },
    } as unknown as D1Database;

    await expect(getFolderAccessRole(db, 8, viewer)).resolves.toBe("editor");
    expect(sql).toContain("folder_permissions fp");
    expect(sql).toContain("fp.role = 'editor'");
    expect(bindings).toEqual([
      "user_editor",
      "editor@example.com",
      '["42","84"]',
      "editor@example.com",
      '["42","84"]',
      8,
    ]);
  });

  it("treats an existing folder as editable for a super admin", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return {
              id: 8,
              name: "Shared",
              owner_user_id: "owner",
              parent_folder_id: null,
              created_at: 1,
              updated_at: 1,
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(getFolderAccessRole(db, 8, { ...viewer, isSuperAdmin: true })).resolves.toBe(
      "editor",
    );
  });

  it("surfaces directly shared children at the root when their parent is inaccessible", async () => {
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

    await listAccessibleRootFoldersWithCounts(db, viewer);

    expect(sql).toContain("f.parent_folder_id IS NULL");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("FROM folders parent");
    expect(sql).toContain("FROM link_permissions lp");
    expect(sql).toContain("FROM folder_permissions child_permission");
    expect(bindings).toEqual([
      "user_editor",
      '["42","84"]',
      "editor@example.com",
      '["42","84"]',
      "user_editor",
      "editor@example.com",
      '["42","84"]',
      "user_editor",
      "editor@example.com",
      '["42","84"]',
      "user_editor",
      "editor@example.com",
      '["42","84"]',
    ]);
  });

  it("lets super admins see every root folder without ACL bindings", async () => {
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

    await listAccessibleRootFoldersWithCounts(db, { ...viewer, isSuperAdmin: true });

    expect(sql).toContain("WHERE 1 = 1 AND f.parent_folder_id IS NULL");
    expect(sql).not.toContain("folder_permissions fp");
    expect(sql).not.toContain("link_permissions lp");
    expect(bindings).toEqual([]);
  });

  it("filters a folder's links through their own ACLs", async () => {
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

    await listLinksInFolderAccessible(db, { ...viewer, folderId: 8 });

    expect(sql).toContain("l.owner_user_id = ?");
    expect(sql).toContain("l.owner_chapter_id IN");
    expect(sql).toContain("l.visibility = 'public'");
    expect(sql).toContain("FROM link_permissions lp");
    expect(bindings).toEqual([
      8,
      0,
      "user_editor",
      '["42","84"]',
      "editor@example.com",
      '["42","84"]',
    ]);
  });

  it("copies folder permissions to a new link without overwriting explicit permissions", async () => {
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
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    await copyFolderPermissionsToLink(db, 8, "link_1");

    expect(sql).toContain("SELECT ?, principal_type, principal_id, role FROM folder_permissions");
    expect(sql).toContain("ON CONFLICT(link_id, principal_type, principal_id) DO NOTHING");
    expect(bindings).toEqual(["link_1", 8]);
  });
});

describe("archiveLink", () => {
  it("archives an active link without deleting it", async () => {
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
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    await archiveLink(db, "link_active");

    expect(sql).toContain("archived_at = unixepoch()");
    expect(sql).toContain("updated_at = unixepoch()");
    expect(sql).toContain("archived_at IS NULL");
    expect(sql).toContain("deleted_at IS NULL");
    expect(bindings).toEqual(["link_active"]);
  });
});

describe("restoreLink", () => {
  it("restores an archived link without changing deleted links", async () => {
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
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    await restoreLink(db, "link_archived");

    expect(sql).toContain("archived_at = NULL");
    expect(sql).toContain("updated_at = unixepoch()");
    expect(sql).toContain("archived_at IS NOT NULL");
    expect(sql).toContain("deleted_at IS NULL");
    expect(bindings).toEqual(["link_archived"]);
  });
});

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
    folder_id: 9,
    visibility: "private" as const,
    created_at: 1700000000,
    updated_at: 1700001000,
    archived_at: null,
    deleted_at: null,
  };

  it("maps all columns to camelCase", () => {
    const link = toLink(row);
    expect(link).toEqual({
      id: "link_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      domainId: 1,
      domainHostname: "gdgs.jp",
      slug: "test-slug",
      destinationUrl: "https://example.com",
      title: "Example",
      description: "A test link",
      ogImageUrl: "https://example.com/og.png",
      ownerUserId: "user_abc",
      ownerChapterId: 42,
      campaignChannelId: 7,
      folderId: 9,
      visibility: "private",
      createdAt: 1700000000,
      updatedAt: 1700001000,
      archivedAt: null,
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
      folder_id: null,
      archived_at: null,
      deleted_at: null,
    });
    expect(link.title).toBeNull();
    expect(link.description).toBeNull();
    expect(link.ogImageUrl).toBeNull();
    expect(link.ownerChapterId).toBeNull();
    expect(link.campaignChannelId).toBeNull();
    expect(link.folderId).toBeNull();
    expect(link.archivedAt).toBeNull();
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
