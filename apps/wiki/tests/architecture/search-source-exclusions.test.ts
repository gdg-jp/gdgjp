import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Raw sources never enter keyword search. The /search loader is pinned to the `pages` table
 * (titles, summaries and bodies) so a future change that joins `sources` fails the suite. (AI
 * search reads the knowledge index, whose raw layer is audience-filtered:
 * knowledge-search-callers.test.ts.)
 */
describe("search excludes raw sources", () => {
  it("keyword /search loader only queries pages", () => {
    const source = readFileSync(
      new URL("../../app/features/knowledge/wiki-search.server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/schema\.pages/);
    expect(source).not.toMatch(/source_documents|schema\.sources|sourceDocuments/);
  });
});
