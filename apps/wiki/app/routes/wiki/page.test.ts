import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/utils.server", () => ({
  getAccessIdentity: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(),
}));

// Outer layer: the default space resolves for every caller; identity comes from the
// mocked getAccessIdentity so each case still controls the inner ACL inputs.
vi.mock("~/features/spaces/access.server", async () => {
  const { getAccessIdentity } = await import("~/features/auth/utils.server");
  return {
    requireSpace: vi.fn(async (request: Request, env: Env) => ({
      space: { id: "gdg-jp", slug: "gdg-jp", name: "GDG Japan", kind: "shared" },
      role: "editor",
      identity: await getAccessIdentity(request, env),
      access: new Map([["gdg-jp", "editor"]]),
    })),
  };
});

vi.mock("~/features/spaces/viewer.server", () => ({
  rememberLastSpace: vi.fn(async () => undefined),
}));

vi.mock("~/features/pages/access.server", () => ({
  getEffectivePagePermissions: vi.fn(),
}));

vi.mock("~/features/pages/wiki-page-path.server", () => ({
  getWikiCanonicalSlugPath: vi.fn(),
  // No ancestry rows: the loader falls back to getWikiCanonicalSlugPath, which these tests drive.
  getWikiAncestry: vi.fn(async () => new Map()),
}));

vi.mock("~/features/pages/archive.server", () => ({
  archivePageAndDescendants: vi.fn(),
}));

import { getAccessIdentity } from "~/features/auth/utils.server";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { getWikiCanonicalSlugPath } from "~/features/pages/wiki-page-path.server";
import { getDb } from "~/lib/db.server";
import { loader } from "./page";

const mockContext = {
  cloudflare: {
    env: {} as Env,
    ctx: { waitUntil: vi.fn() },
  },
} as Parameters<typeof loader>[0]["context"];

function fluentDb(result: unknown): ReturnType<typeof getDb> {
  function make(): unknown {
    return new Proxy(
      {
        all: () => Promise.resolve(Array.isArray(result) ? result : []),
        get: () => Promise.resolve(result),
        run: () => Promise.resolve(undefined),
        insert: () => make(),
        values: () => make(),
        onConflictDoUpdate: () => make(),
      },
      {
        get(target, key) {
          if (key in target) return target[key as keyof typeof target];
          if (key === "then") return undefined;
          return () => make();
        },
      },
    );
  }
  return make() as ReturnType<typeof getDb>;
}

const publishedPage = {
  id: "p1",
  titleJa: "子ページ",
  titleEn: "Child",
  slug: "child",
  status: "published",
  contentJa: "# hi",
  contentEn: "# hi",
  translationStatusJa: "human",
  translationStatusEn: "human",
  summaryJa: "",
  summaryEn: "",
  pageType: null,
  visibility: "public",
  generalRole: "viewer",
  chapterId: null,
  authorId: "u1",
  lastEditedBy: "u1",
  updatedAt: new Date(),
};

function identity(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "u1", isAdmin: false, name: "Alice", email: "a@example.com" },
    chapters: [],
    claimsAvailable: true,
    ...overrides,
  };
}

async function runLoader(path: string, splat: string) {
  const request = new Request(`http://localhost${path}`);
  return loader({
    request,
    context: mockContext,
    params: { space: "gdg-jp", "*": splat },
    unstable_pattern: "/s/:space/wiki/*",
    unstable_url: new URL(request.url),
  });
}

describe("wiki.$ loader path handling", () => {
  it("renders on an exact multi-segment match", async () => {
    vi.mocked(getAccessIdentity).mockResolvedValueOnce(identity() as never);
    vi.mocked(getDb).mockReturnValue(fluentDb(publishedPage));
    vi.mocked(getEffectivePagePermissions).mockResolvedValueOnce({
      canView: true,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);
    vi.mocked(getWikiCanonicalSlugPath).mockResolvedValueOnce(["parent", "child"]);

    const result = await runLoader("/s/gdg-jp/wiki/parent/child", "parent/child");
    expect(result.page.slug).toBe("child");
    expect(result.content).toBeInstanceOf(Promise);
    expect(result.pageMeta).toBeInstanceOf(Promise);
    expect(result.comments).toBeInstanceOf(Promise);
    const content = await result.content;
    expect(content.contentJa).toBe("# hi");
    const pageMeta = await result.pageMeta;
    expect(pageMeta.tags).toEqual([]);
    const comments = await result.comments;
    expect(Array.isArray(comments)).toBe(true);
  });

  it("301-redirects a flat slug to the canonical path, preserving ?lang=", async () => {
    vi.mocked(getAccessIdentity).mockResolvedValueOnce(identity() as never);
    vi.mocked(getDb).mockReturnValue(fluentDb(publishedPage));
    vi.mocked(getEffectivePagePermissions).mockResolvedValueOnce({
      canView: true,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);
    vi.mocked(getWikiCanonicalSlugPath).mockResolvedValueOnce(["parent", "child"]);

    try {
      await runLoader("/s/gdg-jp/wiki/child?lang=en", "child");
      expect.unreachable("expected redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      const res = response as Response;
      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("/s/gdg-jp/wiki/parent/child?lang=en");
    }
  });

  it("404s when an intermediate segment is wrong", async () => {
    vi.mocked(getAccessIdentity).mockResolvedValueOnce(identity() as never);
    vi.mocked(getDb).mockReturnValue(fluentDb(publishedPage));
    vi.mocked(getEffectivePagePermissions).mockResolvedValueOnce({
      canView: true,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);
    vi.mocked(getWikiCanonicalSlugPath).mockResolvedValueOnce(["parent", "child"]);

    try {
      await runLoader("/s/gdg-jp/wiki/wrong/child", "wrong/child");
      expect.unreachable("expected 404");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(404);
    }
  });

  it("renders a root-level page at its flat URL without redirecting", async () => {
    const rootPage = { ...publishedPage, slug: "about", id: "p-root" };
    vi.mocked(getAccessIdentity).mockResolvedValueOnce(identity() as never);
    vi.mocked(getDb).mockReturnValue(fluentDb(rootPage));
    vi.mocked(getEffectivePagePermissions).mockResolvedValueOnce({
      canView: true,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);
    vi.mocked(getWikiCanonicalSlugPath).mockResolvedValueOnce(["about"]);

    const result = await runLoader("/s/gdg-jp/wiki/about", "about");
    expect(result.page.slug).toBe("about");
  });

  it("sends signed-out callers to sign in, regardless of path correctness, without resolving the path", async () => {
    vi.mocked(getWikiCanonicalSlugPath).mockClear();
    vi.mocked(getAccessIdentity).mockResolvedValue(
      identity({ user: null, claimsAvailable: true }) as never,
    );
    vi.mocked(getDb).mockReturnValue(fluentDb({ ...publishedPage, visibility: "restricted" }));
    vi.mocked(getEffectivePagePermissions).mockResolvedValue({
      canView: false,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);

    for (const splat of ["parent/child", "wrong/child", "child"]) {
      try {
        await runLoader(`/wiki/${splat}`, splat);
        expect.unreachable("expected a sign-in redirect");
      } catch (response) {
        expect(response).toBeInstanceOf(Response);
        expect((response as Response).status).toBe(302);
        expect((response as Response).headers.get("location")).toBe(
          `/signin?return_to=${encodeURIComponent(`/wiki/${splat}`)}`,
        );
      }
    }
    expect(getWikiCanonicalSlugPath).not.toHaveBeenCalled();
  });

  it("returns the same opaque 404 to signed-in callers without access, regardless of path correctness", async () => {
    vi.mocked(getWikiCanonicalSlugPath).mockClear();
    vi.mocked(getAccessIdentity).mockResolvedValue(
      identity({ user: { id: "member", isAdmin: false }, claimsAvailable: true }) as never,
    );
    vi.mocked(getDb).mockReturnValue(fluentDb({ ...publishedPage, visibility: "restricted" }));
    vi.mocked(getEffectivePagePermissions).mockResolvedValue({
      canView: false,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);

    for (const splat of ["parent/child", "wrong/child", "child"]) {
      try {
        await runLoader(`/wiki/${splat}`, splat);
        expect.unreachable("expected 404");
      } catch (response) {
        expect(response).toBeInstanceOf(Response);
        expect((response as Response).status).toBe(404);
      }
    }
    expect(getWikiCanonicalSlugPath).not.toHaveBeenCalled();
  });

  it("returns 503 for restricted pages when a signed-in reader's claims are unavailable", async () => {
    vi.mocked(getWikiCanonicalSlugPath).mockClear();
    vi.mocked(getAccessIdentity).mockResolvedValueOnce(
      identity({ user: { id: "member", isAdmin: false }, claimsAvailable: false }) as never,
    );
    vi.mocked(getDb).mockReturnValue(fluentDb({ ...publishedPage, visibility: "restricted" }));
    vi.mocked(getEffectivePagePermissions).mockResolvedValueOnce({
      canView: false,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);

    try {
      await runLoader("/s/gdg-jp/wiki/parent/child", "parent/child");
      expect.unreachable("expected 503");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(503);
    }
    expect(getWikiCanonicalSlugPath).not.toHaveBeenCalled();
  });
});
