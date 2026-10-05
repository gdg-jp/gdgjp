import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_RETRIEVAL_LIMITS,
  mergeRrfRankings,
} from "~/features/ai-search/knowledge-retriever.server";

describe("mergeRrfRankings", () => {
  it("rewards pages found by both vector and FTS without expanding either result set", () => {
    const rankings = mergeRrfRankings([
      { source: "vector", pageIds: ["vector-only", "shared", "shared", "tail"] },
      { source: "fts", pageIds: ["fts-only", "shared"] },
    ]);

    expect(rankings.map((item) => item.pageId)).toEqual([
      "shared",
      "fts-only",
      "vector-only",
      "tail",
    ]);
    expect(rankings[0]).toMatchObject({
      sources: new Set(["vector", "fts"]),
      score: 1 / 62 + 1 / 62,
    });
  });

  it("has deterministic ordering for tied ranks", () => {
    expect(
      mergeRrfRankings([{ source: "fts", pageIds: ["z-page", "a-page"] }], 0).map(
        (item) => item.pageId,
      ),
    ).toEqual(["z-page", "a-page"]);
  });

  it("prioritizes an explicitly referenced page without bypassing later authorization", () => {
    const rankings = mergeRrfRankings([
      { source: "explicit", pageIds: ["direct"] },
      { source: "vector", pageIds: ["discovered"] },
      { source: "fts", pageIds: ["discovered"] },
    ]);
    expect(rankings[0]).toMatchObject({ pageId: "direct", sources: new Set(["explicit"]) });
  });

  it("documents fixed retrieval ceilings", () => {
    expect(KNOWLEDGE_RETRIEVAL_LIMITS).toMatchObject({
      vectorChunks: 50,
      ftsPages: 50,
      pages: 12,
      chunksPerPage: 2,
    });
  });
});
