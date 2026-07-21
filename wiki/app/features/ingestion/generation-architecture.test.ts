import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generation architecture", () => {
  it("uses bounded filesystem tools and never imports semantic search bindings", () => {
    const generation = readFileSync(new URL("./generation.server.ts", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("./wiki-workspace.server.ts", import.meta.url), "utf8");
    for (const name of ["pwd", "cd", "ls", "cat", "find", "grep"]) {
      expect(generation).toContain(`${name}: tool(`);
    }
    expect(`${generation}\n${workspace}`).not.toMatch(/VECTORIZE|knowledgeRetriever|embedding/i);
    expect(generation).toContain("stepCountIs(20)");
    expect(workspace).toContain("maxToolOutputTokens");
    expect(workspace).not.toMatch(/select\(\)\.from\(schema\.pages\)\.all/);
  });
});
