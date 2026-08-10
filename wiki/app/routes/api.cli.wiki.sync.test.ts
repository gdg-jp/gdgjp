import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allResults: [] as unknown[][],
  getResults: [] as unknown[],
  canEdit: true,
}));

vi.mock("~/lib/cli-identity.server", () => ({
  getCliIdentity: vi.fn().mockResolvedValue({
    user: { id: "oidc-subject-1", email: "admin@example.com", isAdmin: true },
    chapters: [],
  }),
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

function locale() {
  return {
    title: "Title",
    summary: "Summary",
    translationStatus: "human" as const,
    content: "Body",
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
      pageType: null,
      pageMetadata: null,
      visibility: "restricted" as const,
      generalRole: "viewer" as const,
      chapterId: null,
      tags: [],
      access: [],
      sources: [],
      attachments: [],
    },
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
