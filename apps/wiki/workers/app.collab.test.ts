import { beforeEach, describe, expect, it, vi } from "vitest";

const pageAclClearance = vi.fn(async (..._args: unknown[]) => true);

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: async () => ({
            id: "page-1",
            authorId: "author",
            visibility: "public",
            generalRole: "editor",
            contentJa: 'public <acl src="secret-source">redacted</acl>',
            contentEn: "",
            origin: "human",
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("../app/features/auth/auth.server", () => ({
  createAuth: () => ({
    getSessionUser: async () => ({
      id: "editor-1",
      email: "editor@example.com",
      name: "Editor",
      image: null,
      isAdmin: false,
    }),
    getFreshClaims: async () => ({ chapters: [] }),
  }),
}));
vi.mock("../app/features/spaces/access.server", () => ({
  getSpaceBySlug: async () => ({ id: "gdg-jp", slug: "gdg-jp" }),
  resolveSpaceAccess: async () => new Map([["gdg-jp", "editor"]]),
}));
vi.mock("../app/features/pages/access.server", () => ({
  getEffectivePagePermissions: async () => ({ canView: true, canEdit: true }),
}));
vi.mock("../app/features/pages/acl-spans.server", () => ({
  pageAclClearance: (...args: unknown[]) => pageAclClearance(...args),
}));
vi.mock("./decommissioned", () => ({
  WikiGenerationAgent: class {},
  WikiGenerationPhaseWorkflow: class {},
}));
vi.mock("./collab-durable-object", () => ({ CollabDurableObject: class {} }));
vi.mock("./source-import-durable-object", () => ({ SourceImportDurableObject: class {} }));
vi.mock("./staging-snapshot", () => ({ StagingSnapshot: class {} }));

const { default: worker } = await import("./app");

const doFetch = vi.fn(async () => new Response("upgraded", { status: 200 }));

function connect() {
  const env = {
    DB: {},
    COLLAB_DO: { idFromName: (name: string) => name, get: () => ({ fetch: doFetch }) },
  } as unknown as Env;
  const request = new Request("https://wiki.example/ws/collab/gdg-jp/secret-page", {
    headers: { Upgrade: "websocket" },
  });
  return worker.fetch?.(
    request as Parameters<NonNullable<typeof worker.fetch>>[0],
    env,
    {} as ExecutionContext,
  );
}

beforeEach(() => {
  pageAclClearance.mockClear();
  doFetch.mockClear();
});

describe("collab websocket ACL clearance", () => {
  it("rejects an editor who cannot read every ACL span before reaching the Durable Object", async () => {
    pageAclClearance.mockResolvedValueOnce(false);
    const response = await connect();
    expect(response?.status).toBe(403);
    expect(pageAclClearance).toHaveBeenCalledWith(
      expect.anything(),
      ['public <acl src="secret-source">redacted</acl>', ""],
      expect.objectContaining({ id: "editor-1" }),
      [],
    );
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("forwards to the Durable Object when the caller clears every span", async () => {
    const response = await connect();
    expect(response?.status).toBe(200);
    expect(doFetch).toHaveBeenCalledOnce();
  });
});
