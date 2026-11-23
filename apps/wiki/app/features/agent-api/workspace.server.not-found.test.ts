import { describe, expect, it } from "vitest";
import { mapWorkspaceError } from "./workspace.server";
import { WikiWorkspaceAdapter, type WikiWorkspacePage } from "./workspace/wiki-adapter";
import { createMountedWorkspace } from "./workspace/workspace";

const restricted: WikiWorkspacePage = {
  id: "secret",
  slug: "secret",
  titleJa: "Secret",
  titleEn: "Secret",
  summaryJa: "",
  summaryEn: "",
  parentId: null,
  status: "published",
  pageType: null,
  pageMetadata: null,
  visibility: "restricted",
  generalRole: "viewer",
  chapterId: null,
  authorId: "owner",
  updatedAt: new Date("2026-01-02T03:04:05.000Z"),
};

function workspace() {
  return createMountedWorkspace({
    wiki: new WikiWorkspaceAdapter({
      getRootPage: async (slug) => (slug === restricted.slug ? restricted : null),
      getChildPage: async () => null,
      getPageById: async (id) => (id === restricted.id ? restricted : null),
      getPageBody: async () => ({ ...restricted, contentJa: "body", contentEn: "", tags: [] }),
      listChildren: async () => [],
      findPages: async () => [],
      searchPageBodies: async () => [],
      canView: async (page) => page.visibility !== "restricted",
    }),
  });
}

async function responseFor(run: () => Promise<unknown>) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  const response = mapWorkspaceError(error);
  return { status: response.status, body: await response.json() };
}

describe("mapWorkspaceError existence oracle", () => {
  it.each([
    ["ls", (path: string) => workspace().ls(path)],
    ["cat", (path: string) => workspace().cat(path)],
    ["search", (path: string) => workspace().search("x", { path })],
  ] as const)(
    "maps a restricted page and a missing page to the same not_found on %s",
    async (_name, run) => {
      const hidden = await responseFor(() => run("/wiki/secret"));
      const missing = await responseFor(() => run("/wiki/missing"));
      expect(hidden).toEqual({ status: 404, body: { error: "not_found" } });
      expect(missing).toEqual(hidden);
    },
  );
});
