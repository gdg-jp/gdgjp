import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { InMemorySpanExporter, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { MockLanguageModelV3 } from "ai/test";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { maskTelemetryData } from "../telemetry/langfuse";
import { createWikiSession, createWikiTools } from "../wiki/tools";
import { SYSTEM_INSTRUCTIONS, runWikiAgent } from "./agent";

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
    const wikiTools = readFileSync(new URL("../wiki/tools.ts", import.meta.url), "utf8");
    expect(wikiTools).not.toMatch(
      /postNote|postLogEntry|fetchFilingInstructions|\/api\/agent\/notes/,
    );
  });

  it("does not mention accessToken in telemetry, langfuse, or scores sources", () => {
    const telemetry = readFileSync(new URL("../telemetry/telemetry.ts", import.meta.url), "utf8");
    const langfuse = readFileSync(new URL("../telemetry/langfuse.ts", import.meta.url), "utf8");
    const scores = readFileSync(new URL("../telemetry/scores.ts", import.meta.url), "utf8");
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

describe("feature dependency boundaries", () => {
  it("keeps domain services independent of transport and rejects local import cycles", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const files = ["features", "lib"].flatMap((directory) =>
      readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"),
        )
        .map((entry) => resolve(entry.parentPath, entry.name)),
    );
    const allowed: Record<string, readonly string[]> = {
      auth: ["auth", "chat"],
      chat: ["chat", "auth", "inquiry", "filing", "telemetry", "wiki"],
      connpass: ["connpass"],
      filing: ["filing", "auth", "inquiry", "telemetry", "wiki", "webhooks"],
      inquiry: ["inquiry", "auth", "wiki", "connpass", "telemetry"],
      telemetry: ["telemetry", "inquiry", "wiki", "webhooks"],
      webhooks: ["webhooks"],
      wiki: ["wiki"],
    };
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
      const imports: string[] = [];
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        const specifier = statement.moduleSpecifier;
        if (!specifier || !ts.isStringLiteral(specifier)) continue;
        const path = specifier.text;
        if (!path.startsWith(".") && !path.startsWith("@/")) continue;
        const target = path.startsWith("@/")
          ? resolve(root, path.slice(2))
          : resolve(dirname(file), path);
        const targetFile = target.endsWith(".ts") ? target : `${target}.ts`;
        const from = relative(root, file).split("/");
        const to = relative(root, target).split("/");
        expect(to[0], `${relative(root, file)} must not depend on routes`).not.toBe("app");
        if (from[0] === "lib")
          expect(to[0], "infrastructure cannot import features").not.toBe("features");
        if (from[0] === "features" && to[0] === "features") {
          expect(allowed[from[1]], `${from.join("/")} imports ${to.join("/")}`).toContain(to[1]);
          if (from[1] === "auth" && to[1] === "chat")
            expect(to.slice(2).join("/")).toBe("platform");
          if (from[1] === "telemetry" && to[1] === "inquiry") {
            expect(["citations", "outcome"]).toContain(to.slice(2).join("/"));
          }
        }
        if (files.includes(targetFile)) imports.push(targetFile);
      }
      graph.set(file, imports);
    }
    const visited = new Set<string>();
    function visit(file: string, chain: string[]) {
      expect(
        chain,
        `import cycle: ${[...chain, file].map((p) => relative(root, p)).join(" → ")}`,
      ).not.toContain(file);
      if (visited.has(file)) return;
      for (const dependency of graph.get(file) ?? []) visit(dependency, [...chain, file]);
      visited.add(file);
    }
    for (const file of files) visit(file, []);
  });
});
