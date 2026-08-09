import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent API architecture", () => {
  it("does not use Vectorize, embeddings, RAG, or text generation", () => {
    const root = new URL("./", import.meta.url);
    const sources = [
      "api.agent.ls.ts",
      "api.agent.cat.ts",
      "api.agent.search.ts",
      "api.agent.sources.ts",
      "../lib/agent-workspace.server.ts",
    ].map((name) => readFileSync(new URL(name, root), "utf8"));

    expect(sources.join("\n")).not.toMatch(
      /VECTORIZE|knowledgeRetriever|embedding|createWikiModel|performRagSearch/i,
    );
  });
});
