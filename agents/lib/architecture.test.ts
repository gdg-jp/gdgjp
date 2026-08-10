import { readFileSync } from "node:fs";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { InMemorySpanExporter, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";

import { SYSTEM_INSTRUCTIONS, runWikiAgent } from "./agent";
import { maskTelemetryData } from "./langfuse";
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

  it("does not mention accessToken in telemetry, langfuse, or scores sources", () => {
    const telemetry = readFileSync(new URL("./telemetry.ts", import.meta.url), "utf8");
    const langfuse = readFileSync(new URL("./langfuse.ts", import.meta.url), "utf8");
    const scores = readFileSync(new URL("./scores.ts", import.meta.url), "utf8");
    expect(telemetry).not.toMatch(/accessToken/);
    expect(langfuse).not.toMatch(/accessToken/);
    expect(scores).not.toMatch(/accessToken/);
  });
});

describe("telemetry span leakage", () => {
  const SECRET = "secret-access-token-do-not-leak";
  let provider: NodeTracerProvider | undefined;
  let exporter: InMemorySpanExporter | undefined;

  afterEach(async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "";
    process.env.LANGFUSE_SECRET_KEY = "";
    if (provider) {
      await provider.shutdown();
      provider = undefined;
    }
    exporter = undefined;
  });

  it("never records the access token string in exported OTel span attributes", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";

    exporter = new InMemorySpanExporter();
    const processor = new LangfuseSpanProcessor({
      publicKey: "pk-test",
      secretKey: "sk-test",
      exportMode: "immediate",
      mask: maskTelemetryData,
      exporter,
    });
    provider = new NodeTracerProvider({
      spanProcessors: [processor],
    });
    provider.register();

    const model = new MockLanguageModelV3({
      doGenerate: async (): Promise<LanguageModelV3GenerateResult> => ({
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    await runWikiAgent({
      accessToken: SECRET,
      chapters: [{ chapterId: "1", chapterSlug: "osaka", role: "member" }],
      prompt: "hello",
      model,
      fetch: (async () => {
        throw new Error("wiki fetch should not run for a text-only mock turn");
      }) as unknown as typeof fetch,
      env: {
        WIKI_API_URL: "https://wiki.gdgs.jp",
        ACCOUNTS_URL: "https://accounts.gdgs.jp",
      },
    });

    const dump = JSON.stringify(
      exporter.getFinishedSpans().map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
      })),
    );
    expect(dump).not.toContain(SECRET);
  });
});
