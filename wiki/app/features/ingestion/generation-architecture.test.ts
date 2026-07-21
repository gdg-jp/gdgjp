import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generation architecture", () => {
  it("uses bounded filesystem tools and never imports semantic search bindings", () => {
    const generation = readFileSync(new URL("./generation.server.ts", import.meta.url), "utf8");
    const modelAdapter = readFileSync(
      new URL("../ai/model/index.server.ts", import.meta.url),
      "utf8",
    );
    const workflow = readFileSync(
      new URL("../../../workers/generation-workflow.ts", import.meta.url),
      "utf8",
    );
    const workspace = readFileSync(new URL("./wiki-workspace.server.ts", import.meta.url), "utf8");
    for (const name of ["pwd", "cd", "ls", "cat", "find", "grep"]) {
      expect(generation).toContain(`${name}: tool(`);
    }
    expect(`${generation}\n${workspace}`).not.toMatch(/VECTORIZE|knowledgeRetriever|embedding/i);
    expect(generation).toContain("stepCountIs(GENERATION_EXPLORATION_STEP_LIMIT)");
    expect(generation).toContain("prepareExplorationStep(stepNumber)");
    expect(generation).toContain("...exploration.response.messages");
    expect(generation).toContain("generateValidatedObject({");
    expect(modelAdapter).toContain("generateValidatedObject({");
    expect(generation).toContain("maxRetries: 0");
    expect(generation.match(/maxRetries: 0/g)).toHaveLength(4);
    expect(modelAdapter).toContain("maxRetries: request.maxRetries");
    expect(workflow).toContain('retries: { limit: 0, delay: "1 minute"');
    expect(workspace).toContain("maxToolOutputTokens");
    expect(workspace).not.toMatch(/select\(\)\.from\(schema\.pages\)\.all/);
  });
});
