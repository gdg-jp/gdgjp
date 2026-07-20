import { beforeEach, describe, expect, it, vi } from "vitest";

const listChapters = vi.fn();
vi.mock("~/lib/db", () => ({ listChapters }));

describe("GET /api/chapters/directory", () => {
  beforeEach(() => {
    listChapters.mockResolvedValue([
      { id: 2, slug: "tokyo", name: "GDG Tokyo", kind: "gdg", createdAt: 1 },
      { id: 1, slug: "kyoto", name: "GDGoC Kyoto", kind: "gdgoc", createdAt: 1 },
    ]);
  });

  it("returns only stable chapter metadata with cache headers", async () => {
    const { loader } = await import("./api.chapters.directory");
    const response = await loader({
      context: { cloudflare: { env: { DB: {} } } },
      request: new Request("https://accounts.example/api/chapters/directory"),
    } as never);

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");
    await expect(response.json()).resolves.toEqual({
      chapters: [
        { id: "2", slug: "tokyo", name: "GDG Tokyo", kind: "gdg" },
        { id: "1", slug: "kyoto", name: "GDGoC Kyoto", kind: "gdgoc" },
      ],
    });
  });

  it("filters by name and slug", async () => {
    const { loader } = await import("./api.chapters.directory");
    const response = await loader({
      context: { cloudflare: { env: { DB: {} } } },
      request: new Request("https://accounts.example/api/chapters/directory?q=KYOTO"),
    } as never);
    await expect(response.json()).resolves.toEqual({
      chapters: [{ id: "1", slug: "kyoto", name: "GDGoC Kyoto", kind: "gdgoc" }],
    });
  });
});
