import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Answer-job tokens (Stage 05) read the wiki as one asker for 10 minutes. They are accepted
 * only by the two read routes the runner's MCP tools call; never by /sync or any writer.
 */
const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));
function files(dir: string): string[] {
  return readdirSync(join(WIKI_ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );
}

describe("job token routes", () => {
  it("only knowledge-search and page opt in to job tokens", () => {
    const users = files("app").filter((file) =>
      /allowJobToken:\s*true/.test(readFileSync(join(WIKI_ROOT, file), "utf8")),
    );
    expect(users.sort()).toEqual([
      "app/routes/api/agent/knowledge-search.ts",
      "app/routes/api/agent/page.ts",
    ]);
  });
});
