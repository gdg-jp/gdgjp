import { describe, expect, it, vi } from "vitest";
import { archivePageAndDescendants } from "./archive.server";

describe("archivePageAndDescendants", () => {
  it("archives the complete descendant tree in one statement", async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as unknown as Env;
    const db = {} as Parameters<typeof archivePageAndDescendants>[1];

    await archivePageAndDescendants(env, db, "parent");

    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0][0]).toContain("WITH RECURSIVE descendants");
    expect(prepare.mock.calls[0][0]).toContain("UPDATE pages SET status = 'archived'");
    expect(bind).toHaveBeenCalledWith("parent");
    expect(run).toHaveBeenCalledOnce();
  });
});
