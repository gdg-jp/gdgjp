import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLinkWithExtras,
  parseCreateLinkInput,
  parseUpdateLinkPatch,
  updateLinkWithExtras,
} from "./link.service";
import type { CreateLinkInput } from "./link.types";

type Row = Record<string, unknown>;

function dnsResponse(addresses: Array<{ data: string; type: number }>) {
  return Response.json({ Answer: addresses });
}

function stubPublicDns() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      return url.searchParams.get("type") === "A"
        ? dnsResponse([{ data: "8.8.8.8", type: 1 }])
        : dnsResponse([]);
    }),
  );
}

function fakeLinksDb(
  domains: Row[],
  options: { channels?: Row[]; campaigns?: Row[]; campaignChapters?: Row[] } = {},
): D1Database {
  const links: Row[] = [];

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const exec = (): Row[] => {
      if (sql.includes("FROM domains WHERE id = ?")) {
        const [id] = bound;
        const row = domains.find((d) => d.id === id);
        return row ? [row] : [];
      }
      if (sql.includes("FROM campaign_channels WHERE id = ?")) {
        const [id] = bound;
        const row = options.channels?.find((channel) => channel.id === id);
        return row ? [row] : [];
      }
      if (sql.includes("FROM campaigns WHERE id = ?")) {
        const [id] = bound;
        const row = options.campaigns?.find((campaign) => campaign.id === id);
        return row ? [row] : [];
      }
      if (sql.includes("FROM campaign_chapters")) {
        const [campaignId] = bound;
        return (options.campaignChapters ?? []).filter(
          (campaignChapter) => campaignChapter.campaign_id === campaignId,
        );
      }
      if (sql.startsWith("INSERT INTO links")) {
        const [
          id,
          domainId,
          slug,
          destinationUrl,
          title,
          description,
          ogImageUrl,
          ownerUserId,
          ownerChapterId,
          campaignChannelId,
          folderId,
          visibility,
        ] = bound;
        if (links.some((l) => l.domain_id === domainId && l.slug === slug)) {
          throw new Error("UNIQUE constraint failed: links.domain_id, links.slug");
        }
        const row: Row = {
          id,
          domain_id: domainId,
          slug,
          destination_url: destinationUrl,
          title,
          description,
          og_image_url: ogImageUrl,
          owner_user_id: ownerUserId,
          owner_chapter_id: ownerChapterId,
          campaign_channel_id: campaignChannelId,
          folder_id: folderId,
          visibility,
          created_at: 0,
          updated_at: 0,
          archived_at: null,
          deleted_at: null,
        };
        links.push(row);
        return [row];
      }
      if (sql.startsWith("INSERT INTO link_permissions")) {
        return [
          {
            id: 1,
            link_id: bound[0],
            principal_type: bound[1],
            principal_id: bound[2],
            role: bound[3],
            created_at: 0,
          },
        ];
      }
      throw new Error(`Unhandled SQL in fake links db: ${sql}`);
    };
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        const result = exec();
        return (result[0] as T) ?? null;
      },
      async all<T>() {
        return { results: exec() as T[] };
      },
      async run() {
        exec();
        return { meta: { changes: 1 } };
      },
    };
  }

  return { prepare } as unknown as D1Database;
}

const activeDomain: Row = {
  id: 1,
  hostname: "gdgs.jp",
  kind: "system",
  mode: "short-only",
  upstream_origin: null,
  owner_chapter_id: null,
  status: "active",
  provider_domain_id: null,
  verification_records: "[]",
  provider_error: null,
  created_by_user_id: null,
  created_at: 0,
  updated_at: 0,
  checked_at: null,
  deleted_at: null,
};

const user: AuthUser = {
  id: "u_1",
  email: "member@example.com",
  name: "Member",
  image: null,
  isAdmin: false,
};
const chapter: UserChapter = { chapterId: 1, chapterSlug: "tokyo", role: "member" };

function baseInput(overrides: Partial<CreateLinkInput> = {}): CreateLinkInput {
  return {
    domainId: 1,
    slug: "",
    destinationUrl: "https://example.com/page",
    visibility: "private",
    ...overrides,
  };
}

describe("createLinkWithExtras", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects an invalid share before touching the database further", async () => {
    const deps = { db: fakeLinksDb([activeDomain]) };
    const result = await createLinkWithExtras(
      deps,
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      baseInput({
        slug: "shared-link",
        shares: [{ principalType: "user", principalId: "not-an-email", role: "viewer" }],
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      error: "Invalid sharing email address.",
    });
  });

  it("rejects a slug that is already taken", async () => {
    stubPublicDns();
    const deps = { db: fakeLinksDb([activeDomain]) };
    const actor = { user, chapters: [chapter], selectedChapterId: chapter.chapterId };

    const first = await createLinkWithExtras(deps, actor, baseInput({ slug: "unique-slug" }));
    expect(first.ok).toBe(true);

    const second = await createLinkWithExtras(deps, actor, baseInput({ slug: "unique-slug" }));
    expect(second).toMatchObject({
      ok: false,
      code: "conflict",
      error: 'The slug "unique-slug" is already taken.',
    });
  });

  it("creates a link with an explicit slug", async () => {
    stubPublicDns();
    const deps = { db: fakeLinksDb([activeDomain]) };
    const result = await createLinkWithExtras(
      deps,
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      baseInput({
        slug: "my-link",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.link.slug).toBe("my-link");
      expect(result.link.ownerUserId).toBe(user.id);
    }
  });

  it("requires a campaign chapter when a chapterless super-admin cannot select one", async () => {
    const superAdmin: AuthUser = { ...user, id: "u_admin", isAdmin: true };
    const result = await createLinkWithExtras(
      {
        db: fakeLinksDb([activeDomain], {
          channels: [
            {
              id: 10,
              campaign_id: 20,
              name: "Social",
              code: "social",
              sort_order: 0,
              archived_at: null,
            },
          ],
          campaigns: [
            {
              id: 20,
              name: "Campaign",
              code: "campaign",
              default_destination_url: null,
              owner_user_id: "u_owner",
              created_at: 0,
              updated_at: 0,
              archived_at: null,
            },
          ],
          campaignChapters: [
            { campaign_id: 20, chapter_id: 7 },
            { campaign_id: 20, chapter_id: 8 },
          ],
        }),
      },
      { user: superAdmin, chapters: [], selectedChapterId: null },
      baseInput({ campaignChannelId: 10, slug: "campaign-link" }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      error: "A campaign chapter must be selected for this link.",
    });
  });

  it.each([
    ["title", 1],
    ["description", 1],
    ["ogImageUrl", 1],
    ["comment", 1],
    ["tagIds", [1, "2"]],
    ["newTagNames", ["valid", ""]],
    ["campaignChannelId", "1"],
    ["folderId", 0],
    ["shares", [{ principalType: "user", principalId: 1, role: "viewer" }]],
  ])("rejects malformed optional POST %s", (field, value) => {
    expect(parseCreateLinkInput({ ...baseInput({ slug: "valid" }), [field]: value })).toMatchObject(
      {
        ok: false,
        code: "invalid_input",
      },
    );
  });
});

describe("updateLinkWithExtras", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeUpdateDb(existing: Row): D1Database {
    const rows = [existing];
    function prepare(sql: string) {
      let bound: unknown[] = [];
      const exec = (): Row[] => {
        if (sql.startsWith("UPDATE links SET")) {
          const id = bound[bound.length - 1];
          const row = rows.find((r) => r.id === id);
          return row ? [row] : [];
        }
        throw new Error(`Unhandled SQL: ${sql}`);
      };
      return {
        bind(...values: unknown[]) {
          bound = values;
          return this;
        },
        async first<T>() {
          const result = exec();
          return (result[0] as T) ?? null;
        },
      };
    }
    return { prepare } as unknown as D1Database;
  }

  const existingLink: Row = {
    id: "link_existing",
    domain_id: 1,
    domain_hostname: "gdgs.jp",
    slug: "existing",
    destination_url: "https://example.com",
    title: null,
    description: null,
    og_image_url: null,
    owner_user_id: user.id,
    owner_chapter_id: null,
    campaign_channel_id: null,
    folder_id: null,
    visibility: "private",
    created_at: 0,
    updated_at: 0,
    archived_at: null,
    deleted_at: null,
  };

  it("rejects a destination URL that resolves to a private address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        return url.searchParams.get("type") === "A"
          ? dnsResponse([{ data: "192.168.1.10", type: 1 }])
          : dnsResponse([]);
      }),
    );
    const deps = { db: fakeUpdateDb(existingLink) };
    const result = await updateLinkWithExtras(
      deps,
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      "link_existing",
      { destinationUrl: "https://internal.example" },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      error: "Destination URL must not resolve to a private or loopback address.",
    });
  });

  it("rejects an invalid slug format", async () => {
    const deps = { db: fakeUpdateDb(existingLink) };
    const result = await updateLinkWithExtras(
      deps,
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      "link_existing",
      { slug: "not a valid slug!" },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("atomically replaces shares when PATCH supplies them", async () => {
    const batches: D1PreparedStatement[][] = [];
    const preparedSql: string[] = [];
    const db = {
      prepare(sql: string) {
        preparedSql.push(sql);
        let bound: unknown[] = [];
        return {
          bind(...values: unknown[]) {
            bound = values;
            return this;
          },
          async first<T>() {
            if (sql.startsWith("UPDATE links SET") || sql.includes("FROM links WHERE id = ?")) {
              return existingLink as T;
            }
            throw new Error(`Unhandled SQL: ${sql}`);
          },
          get bound() {
            return bound;
          },
        };
      },
      async batch(statements: D1PreparedStatement[]) {
        batches.push(statements);
        return [];
      },
    } as unknown as D1Database;

    const result = await updateLinkWithExtras(
      { db },
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      "link_existing",
      {
        shares: [
          { principalType: "user", principalId: "viewer@example.com", role: "viewer" },
          { principalType: "chapter", principalId: "42", role: "editor" },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(preparedSql).toEqual([
      expect.stringContaining("FROM links WHERE id = ?"),
      "DELETE FROM link_permissions WHERE link_id = ?",
      expect.stringContaining("INSERT INTO link_permissions"),
      expect.stringContaining("INSERT INTO link_permissions"),
    ]);
  });

  it("rejects duplicate PATCH shares before updating the link", async () => {
    const result = await updateLinkWithExtras(
      { db: fakeUpdateDb(existingLink) },
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      "link_existing",
      {
        shares: [
          { principalType: "user", principalId: "viewer@example.com", role: "viewer" },
          { principalType: "user", principalId: "viewer@example.com", role: "editor" },
        ],
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      error: "Duplicate sharing principal.",
    });
  });

  it("rejects an overlong comment before updating the link", async () => {
    const db = {
      prepare() {
        throw new Error("repoUpdateLink must not run");
      },
    } as unknown as D1Database;
    const result = await updateLinkWithExtras(
      { db },
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      "link_existing",
      { title: "would otherwise update", comment: "x".repeat(2001) },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      error: "Comment is too long (max 2000 chars).",
    });
  });

  it("rejects malformed PATCH fields before any link update", async () => {
    const db = {
      prepare() {
        throw new Error("repoUpdateLink must not run");
      },
    } as unknown as D1Database;
    const result = await updateLinkWithExtras(
      { db },
      { user, chapters: [chapter], selectedChapterId: chapter.chapterId },
      "link_existing",
      { title: "would otherwise update", tagIds: [1, "2"] } as unknown,
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it.each([
    ["title", 1],
    ["description", 1],
    ["ogImageUrl", 1],
    ["comment", 1],
    ["tagIds", [1, "2"]],
    ["newTagNames", ["valid", ""]],
    ["campaignChannelId", "1"],
    ["folderId", 0],
    ["shares", [{ principalType: "user", principalId: 1, role: "viewer" }]],
    ["chapterId", 1],
  ])("rejects malformed or create-only PATCH %s", (field, value) => {
    expect(parseUpdateLinkPatch({ [field]: value })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });
});
