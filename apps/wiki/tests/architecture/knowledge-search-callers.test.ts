import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `searchSpaces` trusts its `spaceIds` / `audienceKeys`. The only caller allowed is
 * `searchForReader`, which derives audiences from `readableAudienceKeys` and re-checks
 * every hit with the page ACL / canAccessSource. Anything else calling the port directly
 * could pass a wider audience set than the reader has.
 */
const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));
function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(WIKI_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") out.push(...files(rel));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("knowledge search callers", () => {
  it("only searchForReader calls searchSpaces", () => {
    const callers = [...files("app"), ...files("workers")].filter((file) =>
      /\bsearchSpaces\(/.test(readFileSync(join(WIKI_ROOT, file), "utf8")),
    );
    expect(callers.sort()).toEqual([
      "app/features/knowledge/search.server.ts",
      "app/features/knowledge/viewer-search.server.ts",
    ]);
  });

  it("UI search never asks for raw material", () => {
    const source = readFileSync(
      join(WIKI_ROOT, "app/features/knowledge/wiki-search.server.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/layers:\s*\[[^\]]*"raw"/);
    const shared = readFileSync(join(WIKI_ROOT, "app/features/knowledge/shared.ts"), "utf8");
    expect(shared).toMatch(/DEFAULT_UI_LAYERS: readonly KnowledgeLayer\[\] = \["page", "acl"\]/);
  });
});
