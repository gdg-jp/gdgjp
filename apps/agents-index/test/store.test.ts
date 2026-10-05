import { describe, expect, it } from "vitest";

import { IndexStore } from "../src/indexer/store.ts";

describe("IndexStore", () => {
  it("persists an embedding and returns its distance", () => {
    const store = new IndexStore(":memory:");
    store.replacePath("raw/example.md", [
      {
        path: "raw/example.md",
        startLine: 1,
        endLine: 1,
        text: "懇親会 費用",
        subject: { visibility: "member", chapterId: null },
        aclSourceIds: [],
        embedding: new Float32Array(384),
      },
    ]);
    expect(store.search(new Float32Array(384), 0, 10)).toMatchObject([
      { path: "raw/example.md", distance: 0 },
    ]);
    store.close();
  });
});
