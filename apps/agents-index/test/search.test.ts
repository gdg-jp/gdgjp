import { describe, expect, it } from "vitest";

import { searchIndex } from "../src/search.ts";

describe("searchIndex", () => {
  it("keeps scanning after 500 inaccessible candidates", async () => {
    const inaccessible = Array.from({ length: 500 }, (_, id) => ({
      id,
      path: `raw/no-${id}`,
      startLine: 1,
      endLine: 1,
      text: "x",
      distance: 0,
      subject: { visibility: "organizer", chapterId: null },
      aclSourceIds: [],
    }));
    const accessible = {
      id: 501,
      path: "raw/yes",
      startLine: 3,
      endLine: 3,
      text: "x",
      distance: 0,
      subject: { visibility: "member", chapterId: null },
      aclSourceIds: [],
    };
    const candidates = [...inaccessible, accessible];
    const store = {
      search: (_embedding: Float32Array, offset: number, limit: number) =>
        candidates.slice(offset, offset + limit),
    };
    const result = await searchIndex({
      store: store as never,
      embedder: { embed: async () => new Float32Array(384) },
      sourceMetadata: new Map(),
      principal: {
        classes: [{ chapterId: "tokyo", role: "member" }],
        channelAudience: { kind: "member" },
      },
      query: "anything",
      pathPrefix: "raw/yes",
    });
    expect(result).toEqual([{ path: "raw/yes", startLine: 3, endLine: 3, score: 1 }]);
  });
});
