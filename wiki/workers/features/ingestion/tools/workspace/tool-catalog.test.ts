import { describe, expect, it } from "vitest";
import { createWorkspaceToolCatalog } from "./tool-catalog";
import type { MountedWorkspace } from "./workspace";

describe("createWorkspaceToolCatalog", () => {
  it("reuses identical requests within one model run", async () => {
    let reads = 0;
    const workspace = {
      ls: async (path: string) => {
        reads += 1;
        return {
          data: { path, entries: [], nextCursor: null },
          truncated: false,
        };
      },
    } as unknown as MountedWorkspace;
    const catalog = createWorkspaceToolCatalog(workspace);
    const execute = catalog.ls.execute as unknown as (input: {
      path: string;
    }) => Promise<unknown>;

    await Promise.all([execute({ path: "/" }), execute({ path: "/" })]);

    expect(reads).toBe(1);
  });
});
