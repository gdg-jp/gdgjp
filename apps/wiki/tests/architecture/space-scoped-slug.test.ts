import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(relRoot: string): string[] {
  const out: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(WIKI_ROOT, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(`${relDir}/${entry.name}`);
        }
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(`${relDir}/${entry.name}`);
      }
    }
  };
  walk(relRoot);
  return out;
}

const SLUG_EQ = /eq\(\s*(?:schema\.)?pages\.slug\s*,/;
const RAW_SLUG = /FROM\s+pages\s+WHERE\s+slug\s*=/i;
const ALLOWED = new Set(["app/features/pages/page-space.server.ts"]);

describe("space-scoped slug lookups", () => {
  it("never looks a page up by slug without its space", () => {
    const offenders = [...sourceFiles("app"), ...sourceFiles("workers")].filter((file) => {
      if (ALLOWED.has(file)) return false;
      const source = readFileSync(join(WIKI_ROOT, file), "utf8");
      return SLUG_EQ.test(source) || RAW_SLUG.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
