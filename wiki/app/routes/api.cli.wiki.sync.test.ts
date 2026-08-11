import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allResults: [] as unknown[][],
  getResults: [] as unknown[],
  canEdit: true,
  identity: {
    user: { id: "oidc-subject-1", email: "admin@example.com", isAdmin: true as boolean },
    chapters: [] as Array<{ chapterId: string; role: string }>,
  },
}));

vi.mock("~/lib/cli-identity.server", () => ({
  getCliIdentity: vi.fn().mockImplementation(async () => mocks.identity),
}));

vi.mock("~/lib/agents-md.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/lib/agents-md.server")>();
  return { ...original, getAgentInstructions: vi.fn() };
});

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

vi.mock("~/lib/page-access.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/lib/page-access.server")>();
  return {
    ...original,
    getEffectivePagePermissions: vi.fn(async () => ({
      canEdit: mocks.canEdit,
      canManageSharing: mocks.canEdit,
    })),
  };
});

vi.mock("~/lib/queue-processors.server", () => ({
  sendOrRunTranslation: vi.fn().mockResolvedValue(undefined),
}));

import { agentsHash, getAgentInstructions } from "~/lib/agents-md.server";
import { action, scheduleSyncPostCommit } from "./api.cli.wiki.sync";

type Prepared = { sql: string; values: unknown[]; bind: (...values: unknown[]) => Prepared };

function locale(content = "Body") {
  return {
    title: "Title",
    summary: "Summary",
    translationStatus: "human" as const,
    content,
  };
}

function page(id: string, slug: string, parentId: string | null) {
  return {
    id,
    slug,
    parentId,
    sortOrder: 0,
    en: locale(),
    meta: {
      pageType: null as string | null,
      pageMetadata: null as unknown,
      visibility: "restricted" as "restricted" | "unlisted" | "public" | "organizer" | "member",
      generalRole: "viewer" as "viewer" | "commenter" | "editor",
      chapterId: null as string | null,
      tags: [] as string[],
      access: [] as Array<{
        subjectType: "email" | "chapter";
        subjectKey: string;
        subjectLabel: string;
        role: "viewer" | "commenter" | "editor";
      }>,
      sources: [] as Array<{
        url?: string;
        title: string;
        sourceId?: string | null;
      }>,
      attachments: [] as Array<{ fileName: string; mimeType: string }>,
    },
  };
}

function storedPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    slug: "page",
    parentId: null,
    sortOrder: 0,
    origin: "agent",
    pageType: null,
    authorId: "oidc-subject-1",
    visibility: "member",
    generalRole: "viewer",
    chapterId: null,
    syncRevision: 1,
    titleJa: "タイトル",
    titleEn: "Title",
    summaryJa: "要約",
    summaryEn: "Summary",
    contentJa: "本文",
    contentEn: "Body",
    translationStatusJa: "human",
    translationStatusEn: "human",
    ...overrides,
  };
}

function actionArgs(
  operations: unknown[],
  options: {
    agentsMd?: { content: string; expectedContentHash: string };
    rejectBatch?: boolean;
    revisions?: Array<{ id: string; revision: number }>;
  } = {},
) {
  const waits: Promise<unknown>[] = [];
  const batch = vi.fn(async (statements: Prepared[]) => {
    if (options.rejectBatch) throw new Error("D1 batch failed");
    return statements.map((_, index) => ({
      results: index === statements.length - 1 ? (options.revisions ?? []) : [],
    }));
  });
  const env = {
    DB: {
      prepare(sql: string): Prepared {
        const statement: Prepared = {
          sql,
          values: [],
          bind(...values: unknown[]) {
            statement.values = values;
            return statement;
          },
        };
        return statement;
      },
      batch,
    },
    BUCKET: { delete: vi.fn().mockResolvedValue(undefined) },
    ENVIRONMENT: "production",
    TRANSLATION_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
  };
  const request = new Request("https://wiki.example/api/cli/wiki/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operations, agentsMd: options.agentsMd }),
  });
  return {
    args: {
      request,
      context: {
        cloudflare: {
          env,
          ctx: { waitUntil: (promise: Promise<unknown>) => waits.push(promise) },
        },
      } as never,
      params: {},
      unstable_pattern: "/api/cli/wiki/sync",
      unstable_url: new URL(request.url),
    },
    batch,
    waits,
  };
}

beforeEach(() => {
  mocks.allResults = [[], [], []];
  mocks.getResults = [];
  mocks.canEdit = true;
  mocks.identity = {
    user: { id: "oidc-subject-1", email: "admin@example.com", isAdmin: true },
    chapters: [],
  };
  vi.mocked(getAgentInstructions).mockResolvedValue({
    content: "existing instructions",
    contentHash: agentsHash("existing instructions"),
  });
});

describe("Wiki CLI sync action", () => {
  it("creates a client-ID parent and child in one D1 batch", async () => {
    const parent = page("parent-client-id", "parent", null);
    const child = page("child-client-id", "child", parent.id);
    const { args, batch } = actionArgs(
      [
        { kind: "upsert", page: parent },
        { kind: "upsert", page: child },
      ],
      {
        revisions: [
          { id: parent.id, revision: 1 },
          { id: child.id, revision: 1 },
        ],
      },
    );

    const response = await action(args);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pages: [
        { id: parent.id, revision: 1 },
        { id: child.id, revision: 1 },
      ],
    });
    expect(batch).toHaveBeenCalledOnce();
  });

  it("rejects a new child that appears before its new parent", async () => {
    const parent = page("parent-client-id", "parent", null);
    const child = page("child-client-id", "child", parent.id);
    const { args, batch } = actionArgs([
      { kind: "upsert", page: child },
      { kind: "upsert", page: parent },
    ]);

    const response = await action(args);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_parent_order" });
    expect(batch).not.toHaveBeenCalled();
  });

  it("preserves authorization checks for a stored parent", async () => {
    mocks.getResults = [
      {
        id: "stored-parent",
        origin: "agent",
        pageType: null,
        authorId: "another-user",
        visibility: "restricted",
        generalRole: "viewer",
        chapterId: null,
      },
    ];
    mocks.canEdit = false;
    const { args, batch } = actionArgs([
      { kind: "upsert", page: page("child-client-id", "child", "stored-parent") },
    ]);

    const response = await action(args);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "parent_forbidden" });
    expect(batch).not.toHaveBeenCalled();
  });

  it("does not collapse Wiki-app visibility to restricted on content update", async () => {
    mocks.allResults = [
      [storedPage({ id: "page-1", visibility: "member", contentJa: "旧本文", contentEn: "Body" })],
      [],
      [],
      // pageAclClearance
      [],
      // validatePageAclForSync
      [],
    ];
    const base = page("page-1", "page", null);
    const upsert = {
      ...base,
      ja: locale("新本文"),
      en: undefined,
      meta: {
        ...base.meta,
        visibility: "restricted" as const,
        generalRole: "viewer" as const,
        chapterId: null,
        access: [],
      },
    };
    const { args, batch } = actionArgs([{ kind: "upsert", page: upsert, expectedRevision: 1 }], {
      revisions: [{ id: "page-1", revision: 2 }],
    });

    const response = await action(args);

    expect(response.status).toBe(200);
    const statements = batch.mock.calls[0]?.[0] as Prepared[];
    const update = statements.find((statement) => statement.sql.startsWith("UPDATE pages SET"));
    expect(update?.sql).not.toContain("visibility=?");
    expect(statements.some((statement) => statement.sql.includes("DELETE FROM page_access"))).toBe(
      false,
    );
  });

  it("applies intentional non-default visibility changes on update", async () => {
    mocks.allResults = [
      [
        storedPage({
          id: "page-1",
          visibility: "restricted",
          contentJa: "旧本文",
          contentEn: "Body",
        }),
      ],
      [],
      [],
      [],
      [],
    ];
    const base = page("page-1", "page", null);
    const upsert = {
      ...base,
      ja: locale("新本文"),
      en: undefined,
      meta: {
        ...base.meta,
        visibility: "public" as const,
      },
    };
    const { args, batch } = actionArgs([{ kind: "upsert", page: upsert, expectedRevision: 1 }], {
      revisions: [{ id: "page-1", revision: 2 }],
    });

    const response = await action(args);

    expect(response.status).toBe(200);
    const statements = batch.mock.calls[0]?.[0] as Prepared[];
    const update = statements.find((statement) => statement.sql.includes("visibility=?"));
    expect(update?.values).toContain("public");
  });

  it("returns sync_failed from the single transaction without scheduling post-commit work", async () => {
    const { args, batch, waits } = actionArgs(
      [{ kind: "upsert", page: page("page-client-id", "page", null) }],
      { rejectBatch: true },
    );

    const response = await action(args);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "sync_failed" });
    expect(batch).toHaveBeenCalledOnce();
    expect(waits).toHaveLength(0);
  });

  it("uses the local user ID for an AGENTS.md update rather than the OIDC subject", async () => {
    const content = "updated instructions";
    mocks.getResults = [{ id: "local-user-id" }];
    const { args, batch } = actionArgs([], {
      agentsMd: { content, expectedContentHash: agentsHash("existing instructions") },
    });

    const response = await action(args);

    expect(response.status).toBe(200);
    const statements = batch.mock.calls[0]?.[0] as Prepared[];
    expect(statements[0]?.values).toEqual([
      content,
      agentsHash(content),
      "local-user-id",
      agentsHash("existing instructions"),
    ]);
  });

  it("rejects an AGENTS.md update when its admin has no matching local user", async () => {
    const { args, batch } = actionArgs([], {
      agentsMd: {
        content: "updated instructions",
        expectedContentHash: agentsHash("existing instructions"),
      },
    });

    const response = await action(args);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "agents_md_user_missing" });
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects upserts when the pusher cannot read every stored ACL span", async () => {
    mocks.identity = {
      user: { id: "member-1", email: "member@example.com", isAdmin: false },
      chapters: [{ chapterId: "tokyo", role: "member" }],
    };
    mocks.allResults = [
      [
        storedPage({
          id: "page-1",
          contentJa: 'visible <acl src="org-src">secret</acl>',
          contentEn: "Body",
        }),
      ],
      [],
      [],
      // pageAclClearance source lookup — missing/unreadable → deny for non-admin
      [],
    ];
    const upsert = page("page-1", "page", null);
    const { args, batch } = actionArgs([{ kind: "upsert", page: upsert, expectedRevision: 1 }]);

    const response = await action(args);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "redacted_page_not_editable",
      id: "page-1",
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects pushes that cite a confidential source without an ACL span", async () => {
    mocks.allResults = [
      [],
      [],
      [],
      // validatePageAclForSync cited-source lookup
      [
        {
          id: "org-src",
          visibility: "organizer",
          chapterId: null,
          status: "ready",
        },
      ],
    ];
    const upsert = {
      ...page("new-page", "new-page", null),
      meta: {
        ...page("new-page", "new-page", null).meta,
        visibility: "member" as const,
        sources: [{ url: "https://example.com", title: "Doc", sourceId: "org-src" }],
      },
    };
    const { args, batch } = actionArgs([{ kind: "upsert", page: upsert }]);

    const response = await action(args);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "acl_required",
      sourceId: "org-src",
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("keeps opposite-locale acl_source_ids on a ja-only partial upsert", async () => {
    const enSpan = '<acl src="en1">hidden</acl>';
    const enSource = {
      id: "en1",
      addedBy: "owner",
      chapterId: null,
      visibility: "member",
      status: "ready",
    };
    mocks.allResults = [
      [storedPage({ id: "page-1", contentJa: "旧本文", contentEn: enSpan })],
      [],
      [],
      // pageAclClearance
      [enSource],
      // validatePageAclForSync span sources
      [enSource],
    ];
    const base = page("page-1", "page", null);
    const upsert = {
      ...base,
      ja: locale("新本文"),
      en: undefined,
      meta: {
        ...base.meta,
        visibility: "member" as const,
      },
    };
    const { args, batch } = actionArgs([{ kind: "upsert", page: upsert, expectedRevision: 1 }], {
      revisions: [{ id: "page-1", revision: 2 }],
    });

    const response = await action(args);

    expect(response.status).toBe(200);
    const statements = batch.mock.calls[0]?.[0] as Prepared[];
    const update = statements.find((statement) => statement.sql.includes("acl_source_ids=?"));
    expect(update?.values).toContain(JSON.stringify(["en1"]));
  });
});

describe("scheduleSyncPostCommit", () => {
  it("settles rejected post-commit work without rejecting the request lifecycle", async () => {
    let scheduled: Promise<unknown> | undefined;
    const context = {
      waitUntil(promise: Promise<unknown>) {
        scheduled = promise;
      },
    } as ExecutionContext;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    scheduleSyncPostCommit(context, [Promise.resolve(), Promise.reject(new Error("queue down"))]);

    await expect(scheduled).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("queue down"));
    consoleError.mockRestore();
  });
});
