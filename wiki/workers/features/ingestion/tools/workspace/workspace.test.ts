import { describe, expect, it } from "vitest";
import type { AdapterResult, ListResult, ReadResult, WorkspaceAdapter } from "./contracts";
import {
  WikiWorkspaceAdapter,
  type WikiWorkspacePage,
  type WikiWorkspaceStore,
} from "./wiki-adapter";
import { MountedWorkspace, createMountedWorkspace } from "./workspace";

function page(
  overrides: Partial<WikiWorkspacePage> & Pick<WikiWorkspacePage, "id" | "slug">,
): WikiWorkspacePage {
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

function wikiFixture(): { adapter: WikiWorkspaceAdapter; reads: string[] } {
  const root = page({ id: "root", slug: "about-gdg", titleJa: "GDGについて" });
  const child = page({
    id: "child",
    slug: "about-gdgoc-osaka",
    parentId: root.id,
    titleJa: "GDGOC Osakaについて",
  });
  const hidden = page({ id: "private", slug: "private", visibility: "restricted" });
  const pages = [root, child, hidden];
  const reads: string[] = [];
  const body = (value: WikiWorkspacePage) => ({
    ...value,
    contentJa: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: `${value.slug} 本文 needle` }] },
      ],
    }),
    contentEn: "",
    tags: [],
  });
  const store: WikiWorkspaceStore = {
    getRootPage: async (slug) => {
      reads.push(`root:${slug}`);
      return pages.find((value) => value.parentId === null && value.slug === slug) ?? null;
    },
    getChildPage: async (parentId, slug) => {
      reads.push(`child:${parentId}:${slug}`);
      return pages.find((value) => value.parentId === parentId && value.slug === slug) ?? null;
    },
    getPageById: async (id) => pages.find((value) => value.id === id) ?? null,
    getPageBody: async (id) => {
      reads.push(`body:${id}`);
      const value = pages.find((candidate) => candidate.id === id);
      return value ? body(value) : null;
    },
    listChildren: async (parentId, { limit, offset }) =>
      pages.filter((value) => value.parentId === parentId).slice(offset, offset + limit),
    findPages: async (query, { limit, offset }) =>
      pages
        .filter((value) => `${value.slug} ${value.titleJa}`.includes(query))
        .slice(offset, offset + limit),
    searchPageBodies: async (query, { limit, offset }) =>
      pages
        .filter((value) => value.slug.includes(query) || query === "needle")
        .slice(offset, offset + limit)
        .map(body),
    canView: async (value) => value.id !== hidden.id,
  };
  return { adapter: new WikiWorkspaceAdapter(store), reads };
}

class EchoAdapter implements WorkspaceAdapter {
  async ls(path: string): Promise<AdapterResult<ListResult>> {
    return {
      data: {
        path,
        entries: [
          {
            name: "item",
            path: path ? `${path}/item` : "item",
            readable: true,
            hasChildren: false,
          },
        ],
        nextCursor: null,
      },
      truncated: false,
    };
  }

  async cat(path: string): Promise<AdapterResult<ReadResult>> {
    return { data: { path, content: `content:${path}`, nextCursor: null }, truncated: false };
  }
}

describe("MountedWorkspace", () => {
  it("exposes the standard mounts plus arbitrary future adapter mounts", async () => {
    const { adapter } = wikiFixture();
    const workspace = createMountedWorkspace({
      wiki: adapter,
      additionalMounts: [{ mount: "/google-forms", adapter: new EchoAdapter() }],
    });

    const listing = await workspace.ls("/");
    expect(listing.data.entries.map((entry) => entry.path)).toEqual([
      "/google-docs",
      "/google-forms",
      "/websites",
      "/wiki",
    ]);
    expect((await workspace.cat("/google-forms/registration")).data).toEqual({
      path: "/google-forms/registration",
      content: "content:registration",
      nextCursor: null,
    });
  });

  it("routes only absolute paths and records compact evidence provenance", async () => {
    const { adapter } = wikiFixture();
    const workspace = createMountedWorkspace({ wiki: adapter });

    await expect(workspace.ls("wiki")).rejects.toThrow("absolute");
    await expect(workspace.cat("/wiki/../private")).rejects.toThrow("traversal");
    await workspace.cat("/wiki/about-gdg");

    expect(workspace.manifest()).toMatchObject({
      version: 2,
      references: [{ path: "/wiki/about-gdg" }],
      tools: [expect.objectContaining({ tool: "cat", path: "/wiki/about-gdg" })],
    });
  });

  it("allows a mounted workspace with only non-default adapters", async () => {
    const workspace = new MountedWorkspace([{ mount: "/custom", adapter: new EchoAdapter() }]);
    expect((await workspace.ls("/")).data.entries).toEqual([
      expect.objectContaining({ path: "/custom", readable: false, hasChildren: true }),
    ]);
  });
});

describe("WikiWorkspaceAdapter", () => {
  it("maps a D1 parent hierarchy to readable nodes without index files", async () => {
    const { adapter, reads } = wikiFixture();
    const workspace = createMountedWorkspace({ wiki: adapter });

    const root = await workspace.ls("/wiki");
    expect(root.data.entries).toEqual([
      expect.objectContaining({
        path: "/wiki/about-gdg",
        readable: true,
        hasChildren: "unknown",
      }),
    ]);
    const pageWithChildren = await workspace.cat("/wiki/about-gdg");
    const child = await workspace.cat("/wiki/about-gdg/about-gdgoc-osaka");

    expect(pageWithChildren.data.content).toContain("about-gdg 本文 needle");
    expect(child.data.content).toContain("about-gdgoc-osaka 本文 needle");
    expect(pageWithChildren.data.path).not.toContain("index");
    expect(reads).toEqual(expect.arrayContaining(["body:root", "body:child"]));
  });

  it("keeps inaccessible pages out of listings, direct reads, and search", async () => {
    const { adapter } = wikiFixture();
    const workspace = createMountedWorkspace({ wiki: adapter });

    expect((await workspace.ls("/wiki")).data.entries.map((entry) => entry.name)).toEqual([
      "about-gdg",
    ]);
    await expect(workspace.cat("/wiki/private")).rejects.toThrow("not found");
    expect((await workspace.search("private", { path: "/wiki" })).data.matches).toEqual([]);
  });

  it("uses local read truncation and a cursor rather than a shared token budget", async () => {
    const { adapter } = wikiFixture();
    const workspace = createMountedWorkspace({ wiki: adapter });
    const first = await workspace.cat("/wiki/about-gdg", { maxChars: 8 });

    expect(first.truncated).toBe(true);
    expect(first.data.nextCursor).toBeTruthy();
    const second = await workspace.cat("/wiki/about-gdg", {
      maxChars: 8,
      cursor: first.data.nextCursor ?? undefined,
    });
    expect(second.data.content).not.toBe(first.data.content);
    expect(second.manifest).not.toHaveProperty("budget");
  });
});
