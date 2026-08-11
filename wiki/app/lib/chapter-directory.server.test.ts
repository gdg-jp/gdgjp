import { afterEach, describe, expect, it, vi } from "vitest";
import { loadChapterDirectory } from "./chapter-directory.server";

describe("loadChapterDirectory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the accounts directory payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          chapters: [
            { id: "1", slug: "tokyo", name: "GDG Tokyo", kind: "gdg" },
            { id: "bad", slug: "x", name: "X", kind: "other" },
          ],
        }),
      ),
    );

    const chapters = await loadChapterDirectory({
      ACCOUNTS_URL: "https://accounts.example",
    } as Env);

    expect(chapters).toEqual([{ id: "1", slug: "tokyo", name: "GDG Tokyo", kind: "gdg" }]);
    expect(fetch).toHaveBeenCalledWith(
      new URL("/api/chapters/directory", "https://accounts.example"),
      { headers: { Accept: "application/json" } },
    );
  });

  it("forwards the search query", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ chapters: [] })));

    await loadChapterDirectory({ ACCOUNTS_URL: "https://accounts.example" } as Env, "osa");

    expect(fetch).toHaveBeenCalledWith(
      new URL("/api/chapters/directory?q=osa", "https://accounts.example"),
      { headers: { Accept: "application/json" } },
    );
  });

  it("rejects non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));

    await expect(
      loadChapterDirectory({ ACCOUNTS_URL: "https://accounts.example" } as Env),
    ).rejects.toThrow(/503/);
  });
});
