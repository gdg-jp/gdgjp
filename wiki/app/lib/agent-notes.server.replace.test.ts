import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWorkspaceContext } from "~/lib/agent-workspace.server";

const getPageAccessListMock = vi.fn<(...args: unknown[]) => unknown>();
const getEffectivePagePermissionsMock = vi.fn<(...args: unknown[]) => unknown>();
const upsertCatalogEntryMock = vi.fn<(...args: unknown[]) => unknown>();
const sendOrRunTranslationMock = vi.fn<(...args: unknown[]) => unknown>();

/** Rows keyed by page id, mutated per test to drive resolveReplaceTarget. */
let pagesById: Record<string, Record<string, unknown>> = {};
/** Rows keyed by slug, used by the post-conflict lookup. */
let pagesBySlug: Record<string, Record<string, unknown>> = {};

vi.mock("~/lib/db.server", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (predicate: { id?: string; slug?: string }) => ({
          get: async () =>
            predicate.id !== undefined
              ? (pagesById[predicate.id] ?? undefined)
              : (pagesBySlug[predicate.slug ?? ""] ?? undefined),
        }),
      }),
    }),
  }),
}));

// drizzle `eq` is only used to build the predicate our fake `where` reads back.
vi.mock("drizzle-orm", () => ({
  eq: (column: { name: string }, value: string) => ({ [column.name]: value }),
}));

vi.mock("~/db/schema", () => ({
  pages: {
    id: { name: "id" },
    slug: { name: "slug" },
    parentId: { name: "parentId" },
  },
}));

vi.mock("~/lib/page-access.server", () => ({
  getPageAccessList: (...args: unknown[]) => getPageAccessListMock(...args),
  getEffectivePagePermissions: (...args: unknown[]) => getEffectivePagePermissionsMock(...args),
}));

vi.mock("~/lib/queue-processors.server", () => ({
  sendOrRunTranslation: (...args: unknown[]) => sendOrRunTranslationMock(...args),
}));

vi.mock("~/lib/wiki-catalog.server", () => ({
  upsertCatalogEntry: (...args: unknown[]) => upsertCatalogEntryMock(...args),
}));

vi.mock("~/lib/sources.server", () => ({
  canAssignChapter: () => true,
}));

/** Chapter every cited page resolves to; set per test. */
let citedChapterId: string | null = "A";

vi.mock("../../workers/features/ingestion/persistence/d1/wiki-read-repository", () => ({
  createD1WikiWorkspaceStore: () => ({
    getRootPage: async (slug: string) => ({
      id: `cited-${slug}`,
      slug,
      status: "published",
      chapterId: citedChapterId,
    }),
    getChildPage: async (_parentId: string, slug: string) => ({
      id: `cited-${slug}`,
      slug,
      status: "published",
      chapterId: citedChapterId,
    }),
    canView: async () => true,
  }),
}));

import { createOrReplaceAnswerNote } from "./agent-notes.server";

const NS_ANSWERS = "ns-answers";

function workspaceCtx(chapterIds: string[]): AgentWorkspaceContext {
  return {
    identity: {
      user: { id: "u1", email: "u@example.com", name: "U", image: null, isAdmin: false },
      chapters: chapterIds.map((chapterId, i) => ({
        chapterId: i,
        chapterSlug: chapterId,
        role: "member",
      })),
    },
    workspace: {} as never,
    chapterIds,
  } as AgentWorkspaceContext;
}

function env(runResult: { changes: number }) {
  const batch = vi.fn(async () => []);
  const run = vi.fn(async () => ({ meta: runResult }));
  return {
    env: {
      APP_URL: "https://wiki.gdgs.jp",
      DB: {
        prepare: () => ({ bind: () => ({ run }) }),
        batch,
      },
    } as never,
    batch,
    run,
  };
}

const body = {
  slug: "venue-picks",
  title: "Venue picks",
  summary: "Compare halls.",
  content: "c".repeat(200),
  citedPaths: ["/wiki/venues/a", "/wiki/venues/b"],
};

beforeEach(() => {
  pagesById = {};
  pagesBySlug = {};
  citedChapterId = "A";
  getPageAccessListMock.mockReset().mockResolvedValue([]);
  getEffectivePagePermissionsMock.mockReset().mockResolvedValue({ canView: true, canEdit: false });
  upsertCatalogEntryMock.mockReset().mockResolvedValue(undefined);
  sendOrRunTranslationMock.mockReset().mockResolvedValue(undefined);
});

describe("createOrReplaceAnswerNote — replacement never moves access scope", () => {
  it("refuses to relocate an answer to a different chapter", async () => {
    // The target belongs to chapter A; the citations resolve to chapter B.
    // Allowing this would move chapter_id to B while the page_versions row
    // inserted by the update still holds A's prior content, and history access
    // is evaluated against the page's CURRENT row.
    pagesById["ans-1"] = {
      id: "ans-1",
      parentId: NS_ANSWERS,
      pageType: "answer",
      origin: "agent",
      chapterId: "A",
      contentJa: "chapter A synthesis",
      contentEn: "chapter A synthesis",
      titleJa: "Old",
      titleEn: "Old",
    };
    citedChapterId = "B";
    const { env: e, batch } = env({ changes: 1 });

    const result = await createOrReplaceAnswerNote(e, {} as never, workspaceCtx(["A", "B"]), {
      ...body,
      replaceId: "ans-1",
      citedPaths: ["/wiki/venues/b1", "/wiki/venues/b2"],
    });

    expect(result).toMatchObject({ ok: false, error: "replace_scope_mismatch", status: 409 });
    expect(batch).not.toHaveBeenCalled();
  });

  it("refuses to replace a target carrying explicit page_access rows", async () => {
    pagesById["ans-1"] = {
      id: "ans-1",
      parentId: NS_ANSWERS,
      pageType: "answer",
      origin: "agent",
      chapterId: "A",
      contentJa: "x",
      contentEn: "x",
      titleJa: "Old",
      titleEn: "Old",
    };
    // Only the replace TARGET carries ACL rows — the cited pages are clean, so
    // computeAccessFloor passes and the target-specific check is what refuses.
    // Target ACL rows survive the UPDATE, carrying their grantees onto new content.
    getPageAccessListMock.mockImplementation(async (_db: unknown, pageId: unknown) =>
      pageId === "ans-1" ? [{ id: "acl-1" }] : [],
    );
    const { env: e, batch } = env({ changes: 1 });

    const result = await createOrReplaceAnswerNote(e, {} as never, workspaceCtx(["A"]), {
      ...body,
      replaceId: "ans-1",
    });

    expect(result).toMatchObject({ ok: false, error: "replace_target_shared", status: 409 });
    expect(batch).not.toHaveBeenCalled();
  });
});

describe("createOrReplaceAnswerNote — slug collision is decided by the database", () => {
  it("maps an insert conflict to 409 slug_exists instead of raising", async () => {
    // No pre-check row exists: this is the racing writer whose INSERT loses.
    pagesBySlug["venue-picks"] = {
      slug: "venue-picks",
      parentId: NS_ANSWERS,
    };
    const { env: e } = env({ changes: 0 });

    const result = await createOrReplaceAnswerNote(e, {} as never, workspaceCtx(["A"]), body);

    expect(result).toMatchObject({
      ok: false,
      error: "slug_exists",
      status: 409,
      path: "/wiki/answers/venue-picks",
    });
    expect(upsertCatalogEntryMock).not.toHaveBeenCalled();
    expect(sendOrRunTranslationMock).not.toHaveBeenCalled();
  });

  it("omits the answers path when the conflicting slug is outside the namespace", async () => {
    pagesBySlug["venue-picks"] = { slug: "venue-picks", parentId: "ns-venues" };
    const { env: e } = env({ changes: 0 });

    const result = await createOrReplaceAnswerNote(e, {} as never, workspaceCtx(["A"]), body);

    expect(result).toMatchObject({ ok: false, error: "slug_exists", status: 409 });
    expect(result).not.toHaveProperty("path");
  });
});
