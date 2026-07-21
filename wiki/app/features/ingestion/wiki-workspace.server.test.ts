import { describe, expect, it } from "vitest";
import {
  WikiWorkspace,
  type WikiWorkspaceStore,
  type WorkspacePage,
  normaliseWorkspacePath,
} from "./wiki-workspace.server";

function page(
  overrides: Partial<WorkspacePage> & Pick<WorkspacePage, "id" | "slug">,
): WorkspacePage {
  return {
    titleJa: "題名",
    titleEn: "Title",
    summaryJa: "要約",
    summaryEn: "Summary",
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

function storeFixture(): { store: WikiWorkspaceStore; reads: string[] } {
  const root = page({ id: "root", slug: "guide" });
  const child = page({ id: "child", slug: "setup", parentId: "root", titleJa: "セットアップ" });
  const hidden = page({ id: "hidden", slug: "private", visibility: "restricted" });
  const all = [root, child, hidden];
  const reads: string[] = [];
  const withBody = (value: WorkspacePage) => ({
    ...value,
    contentJa: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: `本文 ${value.slug} needle` }] },
      ],
    }),
    contentEn: "",
    tags: ["event"],
  });
  return {
    reads,
    store: {
      getRootPage: async (slug) => {
        reads.push(`root:${slug}`);
        return all.find((value) => value.parentId === null && value.slug === slug) ?? null;
      },
      getChildPage: async (parentId, slug) => {
        reads.push(`child:${parentId}:${slug}`);
        return all.find((value) => value.parentId === parentId && value.slug === slug) ?? null;
      },
      getPageById: async (id) => {
        reads.push(`id:${id}`);
        return all.find((value) => value.id === id) ?? null;
      },
      getPageBody: async (id) => {
        reads.push(`body:${id}`);
        const value = all.find((candidate) => candidate.id === id);
        return value ? withBody(value) : null;
      },
      listChildren: async (parentId, { limit, offset }) => {
        reads.push(`list:${parentId ?? "root"}:${limit}:${offset}`);
        return all.filter((value) => value.parentId === parentId).slice(offset, offset + limit);
      },
      findPublicPages: async (query, { limit, offset }) => {
        reads.push(`find:${query}:${limit}:${offset}`);
        return all
          .filter((value) => value.visibility === "public" && value.slug.includes(query))
          .slice(offset, offset + limit);
      },
      grepPublicPages: async (query, { limit, offset }) => {
        reads.push(`grep:${query}:${limit}:${offset}`);
        return all
          .filter((value) => value.visibility === "public" && value.slug.includes(query))
          .slice(offset, offset + limit)
          .map(withBody);
      },
      canView: async (value) => value.id !== "hidden",
    },
  };
}

describe("normaliseWorkspacePath", () => {
  it("resolves a relative path but rejects traversal and platform separators", () => {
    expect(normaliseWorkspacePath("index.ja.md", "/wiki/guide")).toBe("/wiki/guide/index.ja.md");
    expect(() => normaliseWorkspacePath("../private", "/wiki/guide")).toThrow("traversal");
    expect(() => normaliseWorkspacePath("/wiki\\private")).toThrow("Invalid");
  });
});

describe("WikiWorkspace", () => {
  it("uses bounded lazy reads and exposes hierarchical bilingual page files", async () => {
    const { store, reads } = storeFixture();
    const workspace = new WikiWorkspace(
      store,
      [{ name: "input.md", load: async () => "source text" }],
      600,
    );

    expect((await workspace.ls("/")).data.entries.map((entry) => entry.path)).toEqual([
      "/sources",
      "/wiki",
    ]);
    await workspace.cd("/wiki/guide/setup");
    const result = await workspace.cat("index.en.md", { startLine: 1, endLine: 20 });

    expect(result.data.content).toContain('id: "child"');
    expect(result.data.content).toContain("本文 setup needle");
    expect(reads).toContain("body:child");
    expect(result.manifest.references).toEqual([
      expect.objectContaining({ path: "/wiki/guide/setup/index.en.md", lineStart: 1 }),
    ]);
  });

  it("does not enumerate restricted pages but permits only authorized exact paths", async () => {
    const { store } = storeFixture();
    const workspace = new WikiWorkspace(store);

    const listing = await workspace.ls("/wiki");
    expect(listing.data.entries.map((entry) => entry.name)).toEqual(["guide"]);
    await expect(workspace.cat("/wiki/private/index.ja.md")).rejects.toThrow("not found");
  });

  it("bounds directory pages, file ranges, find/grep results, and records budget traces", async () => {
    const { store } = storeFixture();
    const workspace = new WikiWorkspace(store, [], 300);

    const listing = await workspace.ls("/wiki", { limit: 1 });
    expect(listing.data.nextCursor).toBeTruthy();
    const cat = await workspace.cat("/wiki/guide/index.ja.md", { startLine: 1, endLine: 9_999 });
    expect(cat.data.lineEnd - cat.data.lineStart).toBeLessThan(400);
    const find = await workspace.find("guide");
    const grep = await workspace.grep("setup");

    expect(find.data).toHaveLength(1);
    expect(grep.data).toHaveLength(2);
    expect(grep.manifest.budget.consumedTokens).toBeLessThanOrEqual(300);
    expect(grep.manifest.tools.map((trace) => trace.tool)).toEqual(["ls", "cat", "find", "grep"]);
  });

  it("keeps a ten-thousand-page wiki out of context until a bounded tool selects paths", async () => {
    const pages = Array.from({ length: 10_000 }, (_, index) =>
      page({ id: `p${index}`, slug: `page-${index}`, titleJa: `ページ ${index}` }),
    );
    const calls: Array<{ limit: number; offset: number }> = [];
    const store: WikiWorkspaceStore = {
      getRootPage: async () => null,
      getChildPage: async () => null,
      getPageById: async () => null,
      getPageBody: async () => {
        throw new Error("page bodies must remain lazy");
      },
      listChildren: async (_parent, options) => {
        calls.push(options);
        return pages.slice(options.offset, options.offset + options.limit);
      },
      findPublicPages: async (_query, options) =>
        pages.slice(options.offset, options.offset + options.limit),
      grepPublicPages: async () => [],
      canView: async () => true,
    };
    const workspace = new WikiWorkspace(store);
    const listing = await workspace.ls("/wiki");

    expect(listing.data.entries).toHaveLength(25);
    expect(listing.data.nextCursor).toBeTruthy();
    expect(calls).toEqual([{ limit: 26, offset: 0 }]);
    expect(workspace.manifest().budget.consumedTokens).toBeLessThan(2_000);
  });
});
