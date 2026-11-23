import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
