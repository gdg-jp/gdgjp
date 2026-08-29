import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/ai-search/embedding.server", () => ({
  deletePageEmbeddings: vi.fn(),
}));

import { deletePageEmbeddings } from "~/features/ai-search/embedding.server";
import { archivePageAndDescendants } from "./archive.server";

describe("archivePageAndDescendants", () => {
  it("archives the complete descendant tree and removes each page's embeddings", async () => {
    const all = vi.fn().mockResolvedValue({ results: [{ id: "parent" }, { id: "child" }] });
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ all, run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as unknown as Env;
    const db = {} as Parameters<typeof archivePageAndDescendants>[1];

    await archivePageAndDescendants(env, db, "parent");

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1][0]).toContain("WITH RECURSIVE descendants");
    expect(prepare.mock.calls[1][0]).toContain("UPDATE pages SET status = 'archived'");
    expect(bind).toHaveBeenCalledWith("parent");
    expect(run).toHaveBeenCalledOnce();
    expect(deletePageEmbeddings).toHaveBeenCalledTimes(2);
    expect(deletePageEmbeddings).toHaveBeenCalledWith(env, db, "parent");
    expect(deletePageEmbeddings).toHaveBeenCalledWith(env, db, "child");
  });
});
