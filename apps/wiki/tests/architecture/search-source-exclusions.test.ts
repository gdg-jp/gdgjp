import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Raw sources never enter pages FTS. The keyword /search loader is pinned to pages-only
 * tables so a future change that joins `sources` fails the suite. (AI search reads the
 * knowledge index, whose raw layer is audience-filtered: knowledge-search-callers.test.ts.)
 */
describe("search excludes raw sources", () => {
  it("keyword /search loader only queries pages_fts_trigram and pages", () => {
    const source = readFileSync(
      new URL("../../app/features/knowledge/wiki-search.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/FROM pages_fts_trigram/);
    expect(source).toMatch(/schema\.pages/);
    expect(source).not.toMatch(/source_documents|schema\.sources/);
  });
});
