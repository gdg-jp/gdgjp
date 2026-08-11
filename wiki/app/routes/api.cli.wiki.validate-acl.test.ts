import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allResults: [] as unknown[][],
  getResults: [] as unknown[],
  prepareCalls: [] as string[],
  identity: {
    user: {
      id: "oidc-subject-1",
      email: "admin@example.com",
      name: "Admin",
      image: null,
      isAdmin: true as boolean,
    },
    chapters: [{ chapterId: "tokyo", role: "organizer" }] as Array<{
      chapterId: string;
      role: string;
    }>,
  },
}));

vi.mock("~/lib/cli-identity.server", () => ({
  getCliIdentity: vi.fn().mockImplementation(async () => mocks.identity),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          all: async () => mocks.allResults.shift() ?? [],
          get: async () => mocks.getResults.shift(),
        }),
      }),
    }),
  })),
}));

import { getCliIdentity } from "~/lib/cli-identity.server";
import { action } from "./api.cli.wiki.validate-acl";

function makeContext() {
  return {
    cloudflare: {
      env: {
        DB: {
          prepare: (sql: string) => {
            mocks.prepareCalls.push(sql);
            return {
              bind: () => ({
                run: async () => ({ success: true }),
                all: async () => ({ results: [] }),
                first: async () => null,
              }),
            };
          },
          batch: async () => [],
        },
      },
    },
  } as never;
}

function post(body: unknown) {
  return action({
    request: new Request("https://wiki.example/api/cli/wiki/validate-acl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context: makeContext(),
    params: {},
  } as never);
}

describe("POST /api/cli/wiki/validate-acl", () => {
  beforeEach(() => {
    mocks.allResults = [];
    mocks.getResults = [];
    mocks.prepareCalls = [];
    mocks.identity.user.isAdmin = true;
    vi.mocked(getCliIdentity).mockResolvedValue(mocks.identity as never);
  });

  it("returns 401 without identity", async () => {
    vi.mocked(getCliIdentity).mockResolvedValueOnce(null);
    const response = await post({ pages: [], readSourceIds: [] });
    expect(response.status).toBe(401);
  });

  it("matches /sync page-level acl_required for an untagged cited source", async () => {
    // stored page lookup (empty — new page)
    mocks.allResults = [
      [],
      // validatePageAclForSync cited-source lookup
      [
        {
          id: "org-src",
          visibility: "organizer",
          chapterId: null,
          status: "ready",
          addedBy: "owner",
        },
      ],
      // validateReadSourcesTagged source lookup
      [
        {
          id: "org-src",
          visibility: "organizer",
          chapterId: null,
          status: "ready",
        },
      ],
    ];
    const response = await post({
      lang: "ja",
      pages: [
        {
          slug: "venues-umeda",
          title: "Umeda",
          summary: "summary",
          content: "plain body",
          tags: [],
          visibility: "member",
          access: [],
          sources: [{ sourceId: "org-src" }],
        },
      ],
      readSourceIds: ["org-src"],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ error: "acl_required", sourceId: "org-src" }),
      ]),
    });
    expect(mocks.prepareCalls).toEqual([]);
  });

  it("returns acl_untagged_read_source when a confidential read is never tagged", async () => {
    mocks.allResults = [
      [], // stored pages
      // validatePageAclForSync — no cited sources / no spans → no query, but
      // empty cited still may skip. Then run-level lookup:
      [
        {
          id: "org-src",
          visibility: "organizer",
          chapterId: null,
          status: "ready",
        },
      ],
    ];
    const response = await post({
      lang: "ja",
      pages: [
        {
          slug: "a",
          title: "A",
          summary: "s",
          content: "no span",
          tags: [],
          visibility: "member",
          access: [],
          sources: [],
        },
        {
          slug: "b",
          title: "B",
          summary: "s",
          content: "also no span",
          tags: [],
          visibility: "member",
          access: [],
          sources: [],
        },
      ],
      readSourceIds: ["org-src"],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      findings: [
        expect.objectContaining({
          error: "acl_untagged_read_source",
          sourceId: "org-src",
        }),
      ],
    });
    expect(mocks.prepareCalls).toEqual([]);
  });

  it("accepts when one of several pages tags the read source", async () => {
    // No page ids → no stored-page lookup. Page a has no spans/cites.
    // Page b span lookup, then run-level lookup.
    mocks.allResults = [
      [
        {
          id: "org-src",
          addedBy: "owner",
          chapterId: null,
          visibility: "organizer",
          status: "ready",
        },
      ],
      [
        {
          id: "org-src",
          visibility: "organizer",
          chapterId: null,
          status: "ready",
        },
      ],
    ];
    const response = await post({
      lang: "ja",
      pages: [
        {
          slug: "a",
          title: "A",
          summary: "s",
          content: "untagged",
          tags: [],
          visibility: "member",
          access: [],
          sources: [],
        },
        {
          slug: "b",
          title: "B",
          summary: "s",
          content: 'tagged <acl src="org-src">secret</acl>',
          tags: [],
          visibility: "member",
          access: [],
          sources: [],
        },
      ],
      readSourceIds: ["org-src"],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.prepareCalls).toEqual([]);
  });
});
