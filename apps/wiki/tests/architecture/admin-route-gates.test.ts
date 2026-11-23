import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(WIKI_ROOT, rel), "utf8");

function adminRouteFiles(): string[] {
  const routes = read("app/routes.ts");
  const block = routes.match(/route\("admin", "routes\/admin\/layout\.tsx", \[([\s\S]*?)\]\)/);
  if (!block?.[1]) throw new Error("admin layout route not found in app/routes.ts");
  return [...block[1].matchAll(/"(routes\/admin\/[^"]+)"/g)].map((match) => `app/${match[1]}`);
}

function handlers(source: string): Array<{ name: string; params: string; body: string }> {
  const out: Array<{ name: string; params: string; body: string }> = [];
  const pattern = /export (?:async )?function (loader|action)\(([^)]*)\)[^{]*\{/g;
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = source.indexOf("\n}\n", start);
    out.push({
      name: match[1] ?? "",
      params: match[2] ?? "",
      body: source.slice(start, end === -1 ? undefined : end),
    });
  }
  return out;
}

describe("admin route gates", () => {
  it("the admin layout loader requires admin", () => {
    const [loader] = handlers(read("app/routes/admin/layout.tsx"));
    expect(loader?.name).toBe("loader");
    expect(loader?.body).toMatch(/await requireAdmin\(request, context\.cloudflare\.env\)/);
  });

  it("every child loader and action requires admin itself, since loaders run in parallel", () => {
    const files = adminRouteFiles();
    expect(files.length).toBeGreaterThan(1);
    const offenders: string[] = [];
    for (const file of files) {
      for (const handler of handlers(read(file))) {
        const touchesRequest = handler.params.trim() !== "";
        if (touchesRequest && !/await requireAdmin\(request, env\)/.test(handler.body)) {
          offenders.push(`${file}#${handler.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
