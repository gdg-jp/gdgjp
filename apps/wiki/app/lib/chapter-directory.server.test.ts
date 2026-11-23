import { describe, expect, it, vi } from "vitest";
import { loadChapterDirectory } from "./chapter-directory.server";

function accounts(response: Response) {
  return { fetch: vi.fn().mockResolvedValue(response) };
}

describe("loadChapterDirectory", () => {
  it("parses the directory through the Accounts service binding", async () => {
    const binding = accounts(
      Response.json({
        chapters: [
          { id: "1", slug: "tokyo", name: "GDG Tokyo", kind: "gdg" },
          { id: "bad", slug: "x", name: "X", kind: "other" },
        ],
      }),
    );

    const chapters = await loadChapterDirectory({
      ACCOUNTS_URL: "https://accounts.example",
      ACCOUNTS: binding,
    });

    expect(chapters).toEqual([{ id: "1", slug: "tokyo", name: "GDG Tokyo", kind: "gdg" }]);
    expect(binding.fetch).toHaveBeenCalledWith("https://accounts.example/api/chapters/directory", {
      headers: { Accept: "application/json" },
    });
  });

  it("forwards the search query", async () => {
    const binding = accounts(Response.json({ chapters: [] }));

    await loadChapterDirectory(
      { ACCOUNTS_URL: "https://accounts.example", ACCOUNTS: binding },
      "osa",
    );

    expect(binding.fetch).toHaveBeenCalledWith(
      "https://accounts.example/api/chapters/directory?q=osa",
      { headers: { Accept: "application/json" } },
    );
  });

  it("rejects non-OK responses", async () => {
    await expect(
      loadChapterDirectory({
        ACCOUNTS_URL: "https://accounts.example",
        ACCOUNTS: accounts(new Response("nope", { status: 503 })),
      }),
    ).rejects.toThrow(/503/);
  });
});
