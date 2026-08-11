import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth-utils.server", () => ({
  getAccessIdentity: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(),
}));

vi.mock("~/lib/page-access.server", () => ({
  getEffectivePagePermissions: vi.fn(),
}));

vi.mock("~/lib/wiki-page-path.server", () => ({
  getWikiCanonicalSlugPath: vi.fn(),
}));

vi.mock("~/lib/page-archive.server", () => ({
  archivePageAndDescendants: vi.fn(),
}));

import { getAccessIdentity } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import { getWikiCanonicalSlugPath } from "~/lib/wiki-page-path.server";
import { loader } from "./wiki.$";

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
    params: { "*": splat },
    unstable_pattern: "/wiki/*",
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

    const result = await runLoader("/wiki/parent/child", "parent/child");
    expect(result.page.slug).toBe("child");
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
      await runLoader("/wiki/child?lang=en", "child");
      expect.unreachable("expected redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      const res = response as Response;
      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("/wiki/parent/child?lang=en");
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
      await runLoader("/wiki/wrong/child", "wrong/child");
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

    const result = await runLoader("/wiki/about", "about");
    expect(result.page.slug).toBe("about");
  });

  it("returns the same opaque 404 for unauthorized callers regardless of path correctness", async () => {
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
        expect.unreachable("expected 404");
      } catch (response) {
        expect(response).toBeInstanceOf(Response);
        expect((response as Response).status).toBe(404);
      }
    }
    expect(getWikiCanonicalSlugPath).not.toHaveBeenCalled();
  });

  it("returns 503 for restricted pages when claims are unavailable", async () => {
    vi.mocked(getWikiCanonicalSlugPath).mockClear();
    vi.mocked(getAccessIdentity).mockResolvedValueOnce(
      identity({ user: null, claimsAvailable: false }) as never,
    );
    vi.mocked(getDb).mockReturnValue(fluentDb({ ...publishedPage, visibility: "restricted" }));
    vi.mocked(getEffectivePagePermissions).mockResolvedValueOnce({
      canView: false,
      canEdit: false,
      canComment: false,
      canManageSharing: false,
    } as never);

    try {
      await runLoader("/wiki/parent/child", "parent/child");
      expect.unreachable("expected 503");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(503);
    }
    expect(getWikiCanonicalSlugPath).not.toHaveBeenCalled();
  });
});
