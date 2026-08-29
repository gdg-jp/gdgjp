import type { BearerIdentity } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_LIMITS } from "../../workers/features/ingestion/tools/workspace/contracts";
import { encodeOffsetCursor } from "../../workers/features/ingestion/tools/workspace/paths";
import type {
  WikiWorkspacePage,
  WikiWorkspaceStore,
  WorkspaceActor,
} from "../../workers/features/ingestion/tools/workspace/wiki-adapter";

const getBearerIdentityMock = vi.fn<(...args: unknown[]) => unknown>();
const createStoreMock = vi.fn<(...args: unknown[]) => unknown>();
const getDbMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ tag: "db" }));

vi.mock("@gdgjp/gdg-lib", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gdgjp/gdg-lib")>();
  return {
    ...original,
    getBearerIdentity: (...args: unknown[]) => getBearerIdentityMock(...args),
  };
});

vi.mock("~/lib/db.server", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

vi.mock("../../workers/features/ingestion/persistence/d1/wiki-read-repository", () => ({
  createD1WikiWorkspaceStore: (...args: unknown[]) => createStoreMock(...args),
}));

import { loader as catLoader } from "../../app/routes/api.agent.cat";
import { loader as lsLoader } from "../../app/routes/api.agent.ls";
import { loader as searchLoader } from "../../app/routes/api.agent.search";

function identity(overrides?: Partial<BearerIdentity["user"]> & { id?: string }): BearerIdentity {
  return {
    user: {
      id: overrides?.id ?? "user-a",
      email: "a@example.com",
      name: "A",
      image: null,
      isAdmin: false,
      ...overrides,
    },
    chapters: [{ chapterId: 1, chapterSlug: "osaka", role: "member" }],
  };
}

function page(
  overrides: Partial<WikiWorkspacePage> & Pick<WikiWorkspacePage, "id" | "slug">,
): WikiWorkspacePage {
  return {
    titleJa: overrides.slug,
    titleEn: overrides.slug,
    summaryJa: "",
    summaryEn: "",
    parentId: null,
    status: "published",
    pageType: null,
    pageMetadata: null,
    visibility: "public",
    generalRole: "viewer",
    chapterId: null,
    authorId: "owner",
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    ...overrides,
  };
}

type FakeStore = WikiWorkspaceStore & { reads: string[] };

function createFakeStore(actor: WorkspaceActor, pages: WikiWorkspacePage[]): FakeStore {
  const reads: string[] = [];
  const body = (value: WikiWorkspacePage) => ({
    ...value,
    contentJa: `${value.slug} body content`,
    contentEn: "",
    tags: [] as string[],
  });
  const canViewPage = async (value: WikiWorkspacePage) => {
    if (value.visibility !== "restricted") return true;
    return actor.userId === "user-allowed";
  };
  const store: FakeStore = {
    reads,
    getRootPage: async (slug) => {
      reads.push(`root:${slug}`);
      return pages.find((value) => value.parentId === null && value.slug === slug) ?? null;
    },
    getChildPage: async (parentId, slug) => {
      reads.push(`child:${parentId}:${slug}`);
      return pages.find((value) => value.parentId === parentId && value.slug === slug) ?? null;
    },
    getPageById: async (id) => {
      reads.push(`byId:${id}`);
      return pages.find((value) => value.id === id) ?? null;
    },
    getPageBody: async (id) => {
      reads.push(`body:${id}`);
      const value = pages.find((candidate) => candidate.id === id);
      return value ? body(value) : null;
    },
    listChildren: async (parentId, { limit, offset }) => {
      reads.push(`list:${parentId ?? "root"}:${limit}:${offset}`);
      return pages.filter((value) => value.parentId === parentId).slice(offset, offset + limit);
    },
    findPages: async (query, { limit, offset }) => {
      reads.push(`find:${query}`);
      return pages
        .filter((value) => `${value.slug} ${value.titleJa}`.includes(query))
        .slice(offset, offset + limit);
    },
    searchPageBodies: async (query, { limit, offset }) => {
      reads.push(`bodies:${query}`);
      return pages
        .filter((value) => `${value.slug} body`.includes(query))
        .slice(offset, offset + limit)
        .map(body);
    },
    canView: canViewPage,
  };
  return store;
}

const venues = page({ id: "venues", slug: "venues", titleJa: "Venues" });
const umeda = page({
  id: "umeda",
  slug: "umeda-hall",
  parentId: venues.id,
  titleJa: "Umeda Hall",
  summaryJa: "大阪の会場",
});
const restricted = page({
  id: "secret",
  slug: "secret-playbook",
  visibility: "restricted",
  titleJa: "Secret",
});
const indexPage = page({ id: "index", slug: "index", titleJa: "Index" });
const basePages = [venues, umeda, restricted, indexPage];

function loaderArgs(path: string, search = "") {
  const request = new Request(`http://localhost${path}${search}`, {
    headers: { authorization: "Bearer test-token" },
  });
  return {
    request,
    context: { cloudflare: { env: {} } } as never,
    params: {},
    unstable_pattern: path,
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getBearerIdentityMock.mockReset();
  createStoreMock.mockReset();
  getDbMock.mockClear();
  getBearerIdentityMock.mockResolvedValue(identity());
  createStoreMock.mockImplementation((...args: unknown[]) =>
    createFakeStore(args[1] as WorkspaceActor, basePages),
  );
});

describe("GET /api/agent/ls", () => {
  it("returns 401 invalid_token without calling the store", async () => {
    getBearerIdentityMock.mockResolvedValue(null);
    const response = await lsLoader(loaderArgs("/api/agent/ls", "?path=/wiki"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(createStoreMock).not.toHaveBeenCalled();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("omits restricted pages the caller cannot view", async () => {
    const response = await lsLoader(loaderArgs("/api/agent/ls", "?path=/wiki"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<{ name: string }>;
      manifest?: unknown;
    };
    expect(body.entries.map((entry) => entry.name).sort()).toEqual(["index", "venues"]);
    expect(body).not.toHaveProperty("manifest");
  });

  it("paginates the default root path and rejects malformed cursors", async () => {
    const first = await lsLoader(loaderArgs("/api/agent/ls", "?limit=1"));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      entries: Array<{ path: string }>;
      nextCursor: string | null;
    };
    expect(firstBody.entries).toEqual([expect.objectContaining({ path: "/google-docs" })]);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await lsLoader(
      loaderArgs(
        "/api/agent/ls",
        `?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      ),
    );
    expect(second.status).toBe(200);
    expect((await second.json()) as object).toMatchObject({
      entries: [expect.objectContaining({ path: "/websites" })],
    });

    const malformed = await lsLoader(loaderArgs("/api/agent/ls", "?cursor=not-a-cursor"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_cursor" });
  });

  it("returns different listings for callers with different permissions", async () => {
    getBearerIdentityMock.mockResolvedValueOnce(identity({ id: "user-a" }));
    const denied = await lsLoader(loaderArgs("/api/agent/ls", "?path=/wiki"));
    getBearerIdentityMock.mockResolvedValueOnce(identity({ id: "user-allowed" }));
    const allowed = await lsLoader(loaderArgs("/api/agent/ls", "?path=/wiki"));

    const deniedNames = ((await denied.json()) as { entries: Array<{ name: string }> }).entries.map(
      (entry) => entry.name,
    );
    const allowedNames = (
      (await allowed.json()) as { entries: Array<{ name: string }> }
    ).entries.map((entry) => entry.name);

    expect(deniedNames).not.toContain("secret-playbook");
    expect(allowedNames).toContain("secret-playbook");
    expect(createStoreMock).toHaveBeenCalledTimes(2);
  });

  it("clamps limit above WORKSPACE_LIMITS.maxDirectoryEntries", async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      page({ id: `p${index}`, slug: `page-${index}` }),
    );
    createStoreMock.mockImplementation((...args: unknown[]) =>
      createFakeStore(args[1] as WorkspaceActor, many),
    );

    const response = await lsLoader(
      loaderArgs("/api/agent/ls", `?path=/wiki&limit=${WORKSPACE_LIMITS.maxDirectoryEntries + 20}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(WORKSPACE_LIMITS.maxDirectoryEntries);

    const store = createStoreMock.mock.results[0]?.value as FakeStore;
    expect(
      store.reads.some((read) => read.includes(`:${WORKSPACE_LIMITS.maxDirectoryEntries + 1}:`)),
    ).toBe(true);
  });

  it("rejects path traversal with 400 and issues no store query", async () => {
    const response = await lsLoader(loaderArgs("/api/agent/ls", "?path=/wiki/../etc/passwd"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_path" });
    expect(createStoreMock).toHaveBeenCalled();
    const store = createStoreMock.mock.results[0]?.value as FakeStore;
    expect(store.reads).toEqual([]);
  });

  it("rejects an over-deep path with 400", async () => {
    const deep = `/wiki/${Array.from({ length: WORKSPACE_LIMITS.maxPathDepth }, (_, i) => `s${i}`).join("/")}/extra`;
    const response = await lsLoader(
      loaderArgs("/api/agent/ls", `?path=${encodeURIComponent(deep)}`),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_path" });
    const store = createStoreMock.mock.results[0]?.value as FakeStore;
    expect(store.reads).toEqual([]);
  });

  it("rejects a non-absolute path with 400", async () => {
    const response = await lsLoader(loaderArgs("/api/agent/ls", "?path=wiki"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_path" });
  });
});

describe("GET /api/agent/cat", () => {
  it("returns 401 invalid_token without calling the store", async () => {
    getBearerIdentityMock.mockResolvedValue(null);
    const response = await catLoader(loaderArgs("/api/agent/cat", "?path=/wiki/index"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(createStoreMock).not.toHaveBeenCalled();
  });

  it("returns 404 — not 403 — for a restricted page the caller cannot view", async () => {
    const response = await catLoader(loaderArgs("/api/agent/cat", "?path=/wiki/secret-playbook"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("resolves a namespaced page by parent hierarchy", async () => {
    const response = await catLoader(loaderArgs("/api/agent/cat", "?path=/wiki/venues/umeda-hall"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string; content: string; manifest?: unknown };
    expect(body.path).toBe("/wiki/venues/umeda-hall");
    expect(body.content).toContain("umeda-hall");
    expect(body).not.toHaveProperty("manifest");
  });

  it("returns 400 path_required when path is missing", async () => {
    const response = await catLoader(loaderArgs("/api/agent/cat"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "path_required" });
  });

  it("returns 400 invalid_cursor when the cursor is past the end of the page", async () => {
    const cursor = encodeOffsetCursor(10_000);
    const response = await catLoader(
      loaderArgs("/api/agent/cat", `?path=/wiki/index&cursor=${encodeURIComponent(cursor)}`),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("rejects leading double-slash style absolute paths that fail normalisation", async () => {
    // Backslash / NUL are rejected by the normaliser (raw `//` is collapsed).
    const response = await catLoader(loaderArgs("/api/agent/cat", "?path=/wiki\\secret"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_path" });
  });
});

describe("GET /api/agent/search", () => {
  it("returns 401 invalid_token without calling the store", async () => {
    getBearerIdentityMock.mockResolvedValue(null);
    const response = await searchLoader(loaderArgs("/api/agent/search", "?q=umeda"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(createStoreMock).not.toHaveBeenCalled();
  });

  it("does not return restricted pages the caller cannot view", async () => {
    const response = await searchLoader(loaderArgs("/api/agent/search", "?q=Secret"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      matches: Array<{ path: string }>;
      manifest?: unknown;
    };
    expect(body.matches).toEqual([]);
    expect(body).not.toHaveProperty("manifest");
  });

  it("returns matches with paths cat accepts", async () => {
    const response = await searchLoader(loaderArgs("/api/agent/search", "?q=umeda"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { matches: Array<{ path: string; title: string }> };
    expect(body.matches.some((match) => match.path === "/wiki/venues/umeda-hall")).toBe(true);

    const cat = await catLoader(
      loaderArgs("/api/agent/cat", `?path=${encodeURIComponent("/wiki/venues/umeda-hall")}`),
    );
    expect(cat.status).toBe(200);
  });

  it("round-trips the advertised cursor to the next search page", async () => {
    const pages = [
      page({ id: "first", slug: "event-first", titleJa: "Event First" }),
      page({ id: "second", slug: "event-second", titleJa: "Event Second" }),
      page({ id: "third", slug: "event-third", titleJa: "Event Third" }),
    ];
    createStoreMock.mockImplementation((...args: unknown[]) =>
      createFakeStore(args[1] as WorkspaceActor, pages),
    );

    const first = await searchLoader(loaderArgs("/api/agent/search", "?q=event&limit=1"));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      matches: Array<{ path: string }>;
      nextCursor: string | null;
    };
    expect(firstBody.matches).toHaveLength(1);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await searchLoader(
      loaderArgs(
        "/api/agent/search",
        `?q=event&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      ),
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { matches: Array<{ path: string }> };
    expect(secondBody.matches).toHaveLength(1);
    expect(secondBody.matches[0]?.path).not.toBe(firstBody.matches[0]?.path);
  });

  it("returns 400 query_required when q is missing", async () => {
    const response = await searchLoader(loaderArgs("/api/agent/search"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "query_required" });
  });

  it("clamps an over-long query before searching", async () => {
    const q = "x".repeat(WORKSPACE_LIMITS.maxQueryLength + 40);
    const response = await searchLoader(
      loaderArgs("/api/agent/search", `?q=${encodeURIComponent(q)}`),
    );
    expect(response.status).toBe(200);
    const store = createStoreMock.mock.results[0]?.value as FakeStore;
    const findRead = store.reads.find((read) => read.startsWith("find:"));
    expect(findRead?.slice("find:".length).length).toBe(WORKSPACE_LIMITS.maxQueryLength);
  });
});
