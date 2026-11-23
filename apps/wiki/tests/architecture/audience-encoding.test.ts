import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const AUDIENCE_MODULE = "app/features/sources/audience.ts";
const AUDIENCE_TEMPLATE = /`(?:private|member|organizer|chapter-member|chapter-organizer):\$\{/;
const NO_AUDIENCE_LITERAL = /audience[^\n]*["'`]none["'`]|["'`]none["'`][^\n]*audience/i;

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

describe("search audience encoding", () => {
  it("is built only in sources/audience.ts so it cannot disagree with the reader filter", () => {
    const offenders = [...files("app"), ...files("workers")].filter((file) => {
      if (file === AUDIENCE_MODULE) return false;
      const source = readFileSync(join(WIKI_ROOT, file), "utf8");
      return AUDIENCE_TEMPLATE.test(source) || NO_AUDIENCE_LITERAL.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("recognizes the encodings it guards against", () => {
    const source = readFileSync(join(WIKI_ROOT, AUDIENCE_MODULE), "utf8");
    expect(source).toMatch(AUDIENCE_TEMPLATE);
    expect('if (audience === "none") return null;').toMatch(NO_AUDIENCE_LITERAL);
  });
});
