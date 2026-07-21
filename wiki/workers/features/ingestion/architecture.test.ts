import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

describe("generation architecture", () => {
  function readTypeScriptTree(directory: URL): string {
    const path = directory.pathname;
    return readdirSync(path, { withFileTypes: true })
      .flatMap((entry) => {
        const child = join(path, entry.name);
        if (entry.isDirectory()) return readTypeScriptTree(new URL(`file://${child}/`));
        return extname(entry.name).startsWith(".ts") ? [readFileSync(child, "utf8")] : [];
      })
      .join("\n");
  }

  it("uses mounted absolute-path tools without a cumulative token budget", () => {
    const generation = readFileSync(
      new URL("model/ingestion-model-gateway.ts", import.meta.url),
      "utf8",
    );
    const toolCatalog = readFileSync(
      new URL("tools/workspace/tool-catalog.ts", import.meta.url),
      "utf8",
    );
    const modelAdapter = readFileSync(
      new URL("../../../app/features/ai/model/index.server.ts", import.meta.url),
      "utf8",
    );
    const workflow = readFileSync(
      new URL("../../workflows/wiki-generation-phase-workflow.ts", import.meta.url),
      "utf8",
    );
    const workspace = readFileSync(
      new URL("tools/workspace/workspace.ts", import.meta.url),
      "utf8",
    );
    for (const name of ["ls", "cat", "search"]) {
      expect(toolCatalog).toContain(`${name}: tool(`);
    }
    expect(toolCatalog).not.toMatch(/\b(?:pwd|cd|find|grep): tool\(/);
    expect(`${generation}\n${workspace}`).not.toMatch(/VECTORIZE|knowledgeRetriever|embedding/i);
    expect(generation).toContain("stepCountIs(GENERATION_EXPLORATION_STEP_LIMIT)");
    expect(generation).toContain("...exploration.response.messages");
    expect(generation).toContain("generateValidatedObject({");
    expect(modelAdapter).toContain("generateValidatedObject({");
    expect(generation).toContain("maxRetries: 0");
    expect(generation.match(/maxRetries: 0/g)).toHaveLength(2);
    expect(modelAdapter).toContain("maxRetries: request.maxRetries");
    expect(workflow).toContain('retries: { limit: 0, delay: "1 minute"');
    expect(workspace).toContain('mount: "/wiki"');
    expect(workspace).toContain('mount: "/google-docs"');
    expect(workspace).toContain('mount: "/websites"');
    expect(`${generation}\n${workspace}\n${toolCatalog}`).not.toMatch(
      /tokenBudget|maxToolOutputTokens/,
    );
    expect(workspace).not.toMatch(/select\(\)\.from\(schema\.pages\)\.all/);
  });

  it("keeps business layers independent from Agents SDK and infrastructure clients", () => {
    const featureRoot = new URL("./", import.meta.url);
    const orchestration = readTypeScriptTree(new URL("orchestration/", featureRoot));
    const model = readTypeScriptTree(new URL("model/", featureRoot));
    const tools = readTypeScriptTree(new URL("tools/", featureRoot));
    const persistence = readTypeScriptTree(new URL("persistence/", featureRoot));
    const workflow = readFileSync(
      new URL("../../workflows/wiki-generation-phase-workflow.ts", import.meta.url),
      "utf8",
    );

    expect(orchestration).not.toMatch(/from ["'](?:agents|ai|drizzle-orm)/);
    expect(orchestration).not.toMatch(/\b(?:Env|D1Database|R2Bucket)\b/);
    expect(`${model}\n${tools}\n${persistence}`).not.toMatch(/from ["']agents(?:\/[^"']*)?["']/);
    expect(workflow).not.toMatch(/drizzle|schema\.|\.prepare\(|JSON\.parse|generateText|prompt/i);
    expect(workflow).toContain("createIngestionApplication(this.env)");
    expect(workflow).toContain("broadcastToClients(realtimeEvent)");
  });
});
