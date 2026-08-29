import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_RETRIEVAL_LIMITS } from "~/features/ai-search/knowledge-retriever.server";

/**
 * Raw sources must never enter Vectorize or pages FTS. These regressions pin the
 * search surfaces to pages-only tables so a future change that joins `sources`
 * would fail the suite.
 */
describe("search excludes raw sources", () => {
  it("AI knowledge retriever FTS only queries pages_fts", () => {
    const source = readFileSync(
      new URL("../../app/features/ai-search/knowledge-retriever.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/FROM pages_fts/);
    expect(source).not.toMatch(/source_documents|FROM sources\b/);
    expect(KNOWLEDGE_RETRIEVAL_LIMITS.ftsPages).toBeGreaterThan(0);
  });

  it("keyword /search loader only queries pages_fts_trigram and pages", () => {
    const source = readFileSync(new URL("../../app/routes/search.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/FROM pages_fts_trigram/);
    expect(source).toMatch(/schema\.pages/);
    expect(source).not.toMatch(/source_documents|schema\.sources/);
  });
});
