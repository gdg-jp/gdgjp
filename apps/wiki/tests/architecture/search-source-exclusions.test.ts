import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
