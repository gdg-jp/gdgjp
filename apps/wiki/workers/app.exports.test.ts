import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
  WorkflowEntrypoint: class {},
}));

const worker = await import("./app");
const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

function arrayValues(key: string): string[] {
  return [...wrangler.matchAll(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, "gm"))].flatMap(
    ([, body]) => [...(body ?? "").matchAll(/"([^"]+)"/g)].map(([, name]) => name ?? ""),
  );
}

describe("worker entry exports", () => {
  it("exports a class for every Durable Object and Workflow class_name in wrangler.toml", () => {
    const declared = [...wrangler.matchAll(/class_name\s*=\s*"([^"]+)"/g)].map(([, name]) => name);
    expect(declared).toEqual(
      expect.arrayContaining(["WikiGenerationAgent", "WikiGenerationPhaseWorkflow"]),
    );
    const exports = worker as unknown as Record<string, unknown>;
    for (const name of declared) {
      expect(typeof exports[name ?? ""], name).toBe("function");
    }
  });

  it("keeps the decommissioned generation classes out of deleted_classes", () => {
    expect(arrayValues("new_sqlite_classes")).toContain("WikiGenerationAgent");
    expect(arrayValues("deleted_classes")).not.toContain("WikiGenerationAgent");
  });
});
