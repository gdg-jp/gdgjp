import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SYSTEM_INSTRUCTIONS } from "./agent";
import { createWikiSession, createWikiTools } from "./tools/wiki";

describe("answer path architecture", () => {
  it("exports exactly the four read/add-source tools — no write tools", () => {
    const tools = createWikiTools({
      accessToken: "t",
      wikiApiUrl: "https://wiki.gdgs.jp",
      session: createWikiSession(),
      chapters: [],
    });
    expect(Object.keys(tools).sort()).toEqual(
      ["wiki_add_source", "wiki_cat", "wiki_ls", "wiki_search"].sort(),
    );
  });

  it("does not put AGENTS.md sensitive-information rules in SYSTEM_INSTRUCTIONS", () => {
    expect(SYSTEM_INSTRUCTIONS).not.toContain("Personal email addresses, phone numbers");
    expect(SYSTEM_INSTRUCTIONS).not.toContain("## Sensitive information");
    expect(SYSTEM_INSTRUCTIONS).not.toContain("Credentials and API keys");
  });

  it("keeps wiki-write clients out of the tools module", () => {
    const wikiTools = readFileSync(new URL("./tools/wiki.ts", import.meta.url), "utf8");
    expect(wikiTools).not.toMatch(
      /postNote|postLogEntry|fetchFilingInstructions|\/api\/agent\/notes/,
    );
  });
});
